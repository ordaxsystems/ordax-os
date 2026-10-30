#define _GNU_SOURCE
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/mount.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
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


/* Best-effort diagnostics only. Never closes another process's descriptors,
 * remounts an alternate device, or changes the fail-closed power decision.
 * Report bounded PID/FD/comm/mount-ID metadata, never descriptor paths/data.
 */
static unsigned long mount_id_for_target(const char *target) {
    FILE *file = fopen("/proc/self/mountinfo", "re");
    if (!file) return 0;
    char *line = NULL;
    size_t capacity = 0;
    unsigned long found = 0;
    while (getline(&line, &capacity, file) != -1) {
        unsigned long id = 0, parent = 0;
        char device[40], root[PATH_MAX], mountpoint[PATH_MAX];
        if (sscanf(line, "%lu %lu %39s %4095s %4095s",
                   &id, &parent, device, root, mountpoint) == 5 &&
            strcmp(mountpoint, target) == 0) {
            found = id;
            break;
        }
    }
    free(line);
    fclose(file);
    return found;
}

static int decimal_filename(const char *value) {
    if (!value || !*value) return 0;
    for (const unsigned char *p = (const unsigned char *)value; *p; ++p) {
        if (!isdigit(*p)) return 0;
    }
    return 1;
}

static void report_busy_writers(const char *target) {
    unsigned long mount_id = mount_id_for_target(target);
    if (!mount_id) return;
    DIR *processes = opendir("/proc");
    if (!processes) return;
    struct dirent *process;
    unsigned int reported = 0;
    while ((process = readdir(processes)) != NULL && reported < 24) {
        if (!decimal_filename(process->d_name)) continue;
        char base[PATH_MAX];
        int length = snprintf(base, sizeof(base), "/proc/%s/fdinfo",
                              process->d_name);
        if (length < 0 || (size_t)length >= sizeof(base)) continue;
        DIR *fds = opendir(base);
        if (!fds) continue;
        struct dirent *fd;
        while ((fd = readdir(fds)) != NULL && reported < 24) {
            if (!decimal_filename(fd->d_name)) continue;
            char filename[PATH_MAX];
            length = snprintf(filename, sizeof(filename), "%s/%s",
                              base, fd->d_name);
            if (length < 0 || (size_t)length >= sizeof(filename)) continue;
            FILE *detail = fopen(filename, "re");
            if (!detail) continue;
            char line[256];
            unsigned long fd_mount = 0;
            unsigned int flags = 0;
            int have_flags = 0, have_id = 0;
            while (fgets(line, sizeof(line), detail)) {
                if (sscanf(line, "mnt_id:%lu", &fd_mount) == 1) have_id = 1;
                if (sscanf(line, "flags:%o", &flags) == 1) have_flags = 1;
            }
            fclose(detail);
            if (!have_id || !have_flags || fd_mount != mount_id ||
                (flags & O_ACCMODE) == O_RDONLY) continue;
            char command_path[PATH_MAX];
            char comm[64] = "unknown";
            length = snprintf(command_path, sizeof(command_path),
                              "/proc/%s/comm", process->d_name);
            if (length > 0 && (size_t)length < sizeof(command_path)) {
                FILE *name = fopen(command_path, "re");
                if (name) {
                    if (fgets(comm, sizeof(comm), name)) {
                        comm[strcspn(comm, "\r\n")] = '\0';
                        for (char *p = comm; *p; ++p) {
                            if ((unsigned char)*p < 32 || (unsigned char)*p > 126)
                                *p = '_';
                        }
                    }
                    fclose(name);
                }
            }
            /* The image uses BusyBox for most runtime commands. A bounded
             * applet witness identifies the real lifecycle owner without
             * reading file contents or logging arbitrary command arguments.
             */
            char command[80] = "unknown";
            char cmdline_path[PATH_MAX];
            length = snprintf(cmdline_path, sizeof(cmdline_path),
                              "/proc/%s/cmdline", process->d_name);
            if (length > 0 && (size_t)length < sizeof(cmdline_path)) {
                FILE *cmdline = fopen(cmdline_path, "re");
                if (cmdline) {
                    char raw[200] = {0};
                    size_t n = fread(raw, 1, sizeof(raw) - 1, cmdline);
                    fclose(cmdline);
                    if (n > 0) {
                        const char *start = raw;
                        const char *second = raw + strlen(raw) + 1;
                        if (strstr(raw, "busybox") && second < raw + n &&
                            *second) {
                            start = second;
                        }
                        size_t i = 0;
                        while (start[i] && i < sizeof(command) - 1) {
                            unsigned char ch = (unsigned char)start[i];
                            command[i] = (ch >= 32 && ch <= 126) ? ch : '_';
                            ++i;
                        }
                        command[i] = 0;
                    }
                }
            }
            fprintf(stderr,
                    "ordax-usb-mountattr: possible writer pid=%s fd=%s mount_id=%lu comm=%s applet=%s\n",
                    process->d_name, fd->d_name, fd_mount, comm, command);
            ++reported;
        }
        closedir(fds);
    }
    closedir(processes);
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
        int failure_errno = errno;
        fprintf(stderr, "ordax-usb-mountattr: %s target=%s: %s errno=%d\n",
                argv[1], argv[argc - 1], strerror(failure_errno), failure_errno);
        if (failure_errno == EBUSY && argc == 3 &&
            strcmp(argv[1], "alias-ro") == 0) {
            report_busy_writers(argv[2]);
        }
        return 1;
    }
    return 0;
}
