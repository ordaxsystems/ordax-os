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

/* Single-kernel-operation directory swap. The existing ordax-pull owns
 * transaction receipts, version trust, recovery and rollback; this helper
 * only exchanges two same-parent directories and never runs a shell.
 */
static int parts(const char *path, char parent[PATH_MAX], const char **name) {
    if (!path || path[0] != '/' || strlen(path) >= PATH_MAX ||
        strstr(path, "//") || strstr(path, "/../") || strstr(path, "/./"))
        return -1;
    const char *slash = strrchr(path, '/');
    if (!slash || !slash[1] || strcmp(slash + 1, ".") == 0 ||
        strcmp(slash + 1, "..") == 0) return -1;
    size_t n = (size_t)(slash - path);
    if (n == 0) n = 1;
    memcpy(parent, path, n);
    parent[n] = '\0';
    *name = slash + 1;
    return 0;
}

int main(int argc, char **argv) {
    char p1[PATH_MAX], p2[PATH_MAX];
    const char *a = NULL, *b = NULL;
    if (argc != 3 || parts(argv[1], p1, &a) != 0 ||
        parts(argv[2], p2, &b) != 0 || strcmp(p1, p2) != 0 ||
        strcmp(a, b) == 0) {
        fputs("ordax-checkout-exchange: invalid paths\n", stderr);
        return 2;
    }
    int parent = open(p1, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
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
