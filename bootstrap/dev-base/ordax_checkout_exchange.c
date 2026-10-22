#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/fs.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Single-owner kernel primitive for ordax-pull.
 * The Pull continues to own trust, transactions, policy, rollback and state.
 * This statically built helper only synchronizes verified filesystem paths
 * and exchanges two live/stage directories in one kernel operation.
 */
static int parts(const char *path, char parent[PATH_MAX], const char **name) {
    if (!path || path[0] != '/' || strlen(path) >= PATH_MAX ||
        strstr(path, "//") || strstr(path, "/../") || strstr(path, "/./"))
        return -1;
    const char *slash = strrchr(path, '/');
    if (!slash || !slash[1] || strcmp(slash + 1, ".") == 0 ||
        strcmp(slash + 1, "..") == 0) return -1;
    size_t length = (size_t)(slash - path);
    if (length == 0) length = 1;
    memcpy(parent, path, length);
    parent[length] = '\0';
    *name = slash + 1;
    return 0;
}

static int open_dir(const char *path) {
    if (!path || path[0] != '/' || strlen(path) >= PATH_MAX)
        return -1;
    return open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
}

static int seal_state(const char *directory) {
    int fd = open_dir(directory);
    if (fd < 0) {
        perror("ordax-checkout-exchange: state directory");
        return 1;
    }
    /* syncfs reports writeback errors; plain sync() cannot report them.
     * State files and rename-created receipts live on this exact filesystem.
     */
    int result = syncfs(fd);
    if (result != 0)
        perror("ordax-checkout-exchange: state syncfs");
    close(fd);
    return result == 0 ? 0 : 1;
}

static int seal_receipt(const char *path) {
    char directory[PATH_MAX];
    const char *name = NULL;
    if (parts(path, directory, &name) != 0) return -1;
    int parent = open_dir(directory);
    if (parent < 0) return -1;
    int fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    struct stat file_stat, observed;
    int ok = fd >= 0 && fstat(fd, &file_stat) == 0 &&
        S_ISREG(file_stat.st_mode) && file_stat.st_size > 0 &&
        file_stat.st_size <= 512 &&
        fstatat(parent, name, &observed, AT_SYMLINK_NOFOLLOW) == 0 &&
        observed.st_dev == file_stat.st_dev &&
        observed.st_ino == file_stat.st_ino;
    if (ok) ok = fsync(fd) == 0 && fsync(parent) == 0;
    if (fd >= 0) close(fd);
    close(parent);
    return ok ? 0 : -1;
}

static int exchange(const char *first, const char *second, const char *receipt) {
    char p1[PATH_MAX], p2[PATH_MAX];
    const char *a = NULL, *b = NULL;
    if (parts(first, p1, &a) != 0 || parts(second, p2, &b) != 0 ||
        strcmp(p1, p2) != 0 || strcmp(a, b) == 0) {
        fputs("ordax-checkout-exchange: invalid paths\n", stderr);
        return 2;
    }
    int parent = open_dir(p1);
    if (parent < 0) {
        perror("ordax-checkout-exchange: open parent");
        return 1;
    }
    struct stat sa, sb;
    if (fstatat(parent, a, &sa, AT_SYMLINK_NOFOLLOW) != 0 ||
        fstatat(parent, b, &sb, AT_SYMLINK_NOFOLLOW) != 0 ||
        !S_ISDIR(sa.st_mode) || !S_ISDIR(sb.st_mode) ||
        sa.st_dev != sb.st_dev || sa.st_ino == sb.st_ino) {
        fputs("ordax-checkout-exchange: unsafe or cross-device entries\n", stderr);
        close(parent);
        return 2;
    }

    /* No live swap before both the Git candidate and prepared journal are
     * durably persisted. They may occupy separate filesystems.
     */
    if (seal_receipt(receipt) != 0 || syncfs(parent) != 0) {
        perror("ordax-checkout-exchange: pre-exchange durability");
        close(parent);
        return 1;
    }
    if (syscall(SYS_renameat2, parent, a, parent, b, RENAME_EXCHANGE) != 0) {
        perror("ordax-checkout-exchange: renameat2");
        close(parent);
        return 1;
    }
    if (fsync(parent) != 0) {
        perror("ordax-checkout-exchange: post-exchange fsync (state uncertain)");
        close(parent);
        return 3;
    }
    close(parent);
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 3 && strcmp(argv[1], "--seal-state") == 0)
        return seal_state(argv[2]);
    if (argc == 5 && strcmp(argv[1], "--exchange") == 0)
        return exchange(argv[2], argv[3], argv[4]);
    fputs("ordax-checkout-exchange: invalid operation\n", stderr);
    return 2;
}
