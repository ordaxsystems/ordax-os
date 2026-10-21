#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/mount.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/*
 * Kernel-owned filesystem flags for Owner USB power transitions.
 * No mtab, shell mount emulation, fallback, persistence or power authority.
 * Guardian alone validates removable USB identity, quiesces services and
 * proves every bind alias via /proc/self/mountinfo.
 */
static int safe_path(const char *path) {
    return path && path[0] == '/' && strlen(path) < PATH_MAX &&
        strchr(path, '\n') == NULL && strchr(path, '\r') == NULL;
}

static int vfs_readonly(const char *path, int readonly) {
    struct stat st;
    if (!safe_path(path) || lstat(path, &st) != 0 ||
        !S_ISDIR(st.st_mode) || S_ISLNK(st.st_mode)) {
        errno = EINVAL;
        return -1;
    }
    int fd = open(path, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) {
        return -1;
    }
    struct mount_attr attr = {0};
    if (readonly) {
        attr.attr_set = MOUNT_ATTR_RDONLY;
    } else {
        attr.attr_clr = MOUNT_ATTR_RDONLY;
    }
    int result = (int)syscall(SYS_mount_setattr, fd, "", AT_EMPTY_PATH,
                              &attr, sizeof(attr));
    int saved_errno = errno;
    close(fd);
    errno = saved_errno;
    return result;
}

static int superblock_readonly(const char *source, const char *target,
                               int readonly) {
    struct stat block, mounted;
    if (!safe_path(source) || !safe_path(target) ||
        strncmp(source, "/dev/", 5) != 0 ||
        lstat(source, &block) != 0 ||
        !S_ISBLK(block.st_mode) ||
        lstat(target, &mounted) != 0 ||
        !S_ISDIR(mounted.st_mode) || S_ISLNK(mounted.st_mode) ||
        mounted.st_dev != block.st_rdev) {
        errno = EINVAL;
        return -1;
    }
    /* MS_BIND intentionally absent: this is a superblock transition. */
    return mount(source, target, NULL,
                 MS_REMOUNT | (readonly ? MS_RDONLY : 0), NULL);
}

int main(int argc, char **argv) {
    if (geteuid() != 0 || (argc != 3 && argc != 4)) {
        fputs("ordax-usb-mountattr: invalid privilege or arguments\n", stderr);
        return 2;
    }
    int result;
    if (argc == 3 && strcmp(argv[1], "alias-ro") == 0) {
        result = vfs_readonly(argv[2], 1);
    } else if (argc == 3 && strcmp(argv[1], "alias-rw") == 0) {
        result = vfs_readonly(argv[2], 0);
    } else if (argc == 4 && strcmp(argv[1], "superblock-ro") == 0) {
        result = superblock_readonly(argv[2], argv[3], 1);
    } else if (argc == 4 && strcmp(argv[1], "superblock-rw") == 0) {
        result = superblock_readonly(argv[2], argv[3], 0);
    } else {
        fputs("ordax-usb-mountattr: unknown operation\n", stderr);
        return 2;
    }
    if (result != 0) {
        fprintf(stderr, "ordax-usb-mountattr: %s target=%s: %s\n",
                argv[1], argv[argc - 1], strerror(errno));
        return 1;
    }
    return 0;
}
