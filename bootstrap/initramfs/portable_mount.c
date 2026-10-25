#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/loop.h>
#include <linux/openat2.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

enum {
    EXIT_USAGE = 2,
    EXIT_UNSAFE = 3,
    EXIT_LOOP = 4,
    EXIT_MOUNT = 5,
};

struct loop_binding {
    int control_fd;
    int loop_fd;
    int backing_fd;
    char device[64];
    int attached;
};

static void usage(void) {
    fputs(
        "usage:\n"
        "  ordax-portable-mount mount-state <state.img> <state-mount>\n"
        "  ordax-portable-mount mount-capsule <bootstrap.erofs> <capsule-mount>\n"
        "  ordax-portable-mount mount-base <stable-base.erofs> <state-mount> <base-mount> <root-mount>\n"
        "  ordax-portable-mount mount-system <system.erofs> <release-mount> <system-mount>\n"
        "  ordax-portable-mount mount-surface-runtime <runtime.erofs> <runtime-lower> <runtime-upper> <runtime-work> <runtime-root>\n"
        "  ordax-portable-mount mount-ai-runtime <local-ai-runtime.erofs> <runtime-root>\n",
        stderr
    );
}

static int safe_absolute_path(const char *path) {
    if (path == NULL || path[0] != '/' || strlen(path) >= PATH_MAX) {
        return 0;
    }
    if (strchr(path, '\n') != NULL || strchr(path, '\r') != NULL) {
        return 0;
    }
    return 1;
}

static int safe_overlay_path(const char *path) {
    return safe_absolute_path(path) &&
           strchr(path, ',') == NULL &&
           strchr(path, ':') == NULL &&
           strchr(path, '\\') == NULL;
}

static int real_directory(const char *path) {
    struct stat st;
    if (!safe_absolute_path(path) || lstat(path, &st) != 0) {
        return 0;
    }
    return S_ISDIR(st.st_mode) && !S_ISLNK(st.st_mode);
}

static int open_regular(const char *path, int writable, off_t minimum_size) {
    if (!safe_absolute_path(path) || strncmp(path, "/dev/", 5) == 0) {
        errno = EINVAL;
        return -1;
    }
    int flags = (writable ? O_RDWR : O_RDONLY) | O_CLOEXEC | O_NOFOLLOW;
    int fd = open(path, flags);
    if (fd < 0) {
        return -1;
    }
    struct stat st;
    if (fstat(fd, &st) != 0 ||
        !S_ISREG(st.st_mode) ||
        st.st_nlink != 1 ||
        st.st_size < minimum_size) {
        close(fd);
        errno = EINVAL;
        return -1;
    }
    return fd;
}

static int ext4_superblock_magic_ok(int fd) {
    unsigned char magic[2];
    ssize_t n = pread(fd, magic, sizeof(magic), 1024 + 56);
    return n == 2 && magic[0] == 0x53 && magic[1] == 0xef;
}

static int erofs_superblock_magic_ok(int fd) {
    unsigned char magic[4];
    ssize_t n = pread(fd, magic, sizeof(magic), 1024);
    return n == 4 &&
           magic[0] == 0xe2 &&
           magic[1] == 0xe1 &&
           magic[2] == 0xf5 &&
           magic[3] == 0xe0;
}

static void loop_binding_init(struct loop_binding *binding) {
    memset(binding, 0, sizeof(*binding));
    binding->control_fd = -1;
    binding->loop_fd = -1;
    binding->backing_fd = -1;
}

static void loop_binding_cleanup(struct loop_binding *binding) {
    if (binding->attached && binding->loop_fd >= 0) {
        (void)ioctl(binding->loop_fd, LOOP_CLR_FD, 0);
    }
    if (binding->backing_fd >= 0) {
        close(binding->backing_fd);
    }
    if (binding->loop_fd >= 0) {
        close(binding->loop_fd);
    }
    if (binding->control_fd >= 0) {
        close(binding->control_fd);
    }
    loop_binding_init(binding);
}

static int loop_attach(
    struct loop_binding *binding,
    const char *backing_path,
    int writable,
    int verify_ext4,
    int verify_erofs
) {
    loop_binding_init(binding);
    binding->backing_fd = open_regular(
        backing_path,
        writable,
        verify_ext4 ? (off_t)(4 * 1024 * 1024) : (off_t)4096
    );
    if (binding->backing_fd < 0) {
        return -1;
    }
    if (verify_ext4 && !ext4_superblock_magic_ok(binding->backing_fd)) {
        errno = EINVAL;
        loop_binding_cleanup(binding);
        return -1;
    }
    if (verify_erofs && !erofs_superblock_magic_ok(binding->backing_fd)) {
        errno = EINVAL;
        loop_binding_cleanup(binding);
        return -1;
    }

    binding->control_fd = open("/dev/loop-control", O_RDWR | O_CLOEXEC | O_NOFOLLOW);
    if (binding->control_fd < 0) {
        loop_binding_cleanup(binding);
        return -1;
    }
    int number = ioctl(binding->control_fd, LOOP_CTL_GET_FREE);
    if (number < 0) {
        loop_binding_cleanup(binding);
        return -1;
    }
    int written = snprintf(binding->device, sizeof(binding->device), "/dev/loop%d", number);
    if (written <= 0 || (size_t)written >= sizeof(binding->device)) {
        errno = EOVERFLOW;
        loop_binding_cleanup(binding);
        return -1;
    }
    binding->loop_fd = open(
        binding->device,
        (writable ? O_RDWR : O_RDONLY) | O_CLOEXEC | O_NOFOLLOW
    );
    if (binding->loop_fd < 0) {
        loop_binding_cleanup(binding);
        return -1;
    }
    if (ioctl(binding->loop_fd, LOOP_SET_FD, binding->backing_fd) != 0) {
        loop_binding_cleanup(binding);
        return -1;
    }
    binding->attached = 1;

    struct loop_info64 info;
    memset(&info, 0, sizeof(info));
    info.lo_flags = LO_FLAGS_AUTOCLEAR;
    if (!writable) {
        info.lo_flags |= LO_FLAGS_READ_ONLY;
    }
    size_t name_len = strlen(backing_path);
    if (name_len >= sizeof(info.lo_file_name)) {
        name_len = sizeof(info.lo_file_name) - 1;
    }
    memcpy(info.lo_file_name, backing_path, name_len);
    info.lo_file_name[name_len] = '\0';

    if (ioctl(binding->loop_fd, LOOP_SET_STATUS64, &info) != 0) {
        loop_binding_cleanup(binding);
        return -1;
    }
    return 0;
}

static int mount_state(const char *state_image, const char *state_mount) {
    if (!real_directory(state_mount)) {
        fputs("ordax-portable-mount: state mountpoint is unsafe\n", stderr);
        return EXIT_UNSAFE;
    }

    struct loop_binding state;
    if (loop_attach(&state, state_image, 1, 1, 0) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot attach ext4 state image: %s\n", strerror(errno));
        return EXIT_LOOP;
    }

    unsigned long flags = MS_NODEV | MS_NOSUID;
    if (mount(state.device, state_mount, "ext4", flags, "errors=remount-ro") != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount ext4 state: %s\n", strerror(errno));
        loop_binding_cleanup(&state);
        return EXIT_MOUNT;
    }

    state.attached = 0;
    close(state.backing_fd);
    close(state.loop_fd);
    close(state.control_fd);
    printf("ORDAX_PORTABLE_STATE_LOOP=%s\n", state.device);
    return 0;
}

static int safe_nested_directory(
    const char *root,
    const char *relative,
    char output[PATH_MAX]
) {
    if (!safe_overlay_path(root) ||
        relative == NULL ||
        relative[0] == '\0' ||
        relative[0] == '/' ||
        strstr(relative, "..") != NULL ||
        strchr(relative, ',') != NULL ||
        strchr(relative, ':') != NULL ||
        strchr(relative, '\\') != NULL) {
        return 0;
    }
    int written = snprintf(output, PATH_MAX, "%s/%s", root, relative);
    if (written <= 0 || written >= PATH_MAX) {
        return 0;
    }
    return real_directory(output);
}

static int safe_executable_below(const char *root, const char *relative) {
    /* Both verified read-only EROFS and standard musl/Buildroot use symlinked
     * executable names (for example python3 -> python3.X). lstat-only checks
     * reject valid, already verified images. Resolve entirely inside the
     * runtime mount without following /proc magic links or escaping it.
     * No fallback to ordinary open(): unavailable openat2 fails closed.
     */
    if (!safe_overlay_path(root) || relative == NULL ||
        relative[0] == '\0' || relative[0] == '/' ||
        strstr(relative, "..") != NULL) {
        return 0;
    }

    int directory_fd = open(root, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (directory_fd < 0) {
        return 0;
    }
    struct open_how how = {
        .flags = O_PATH | O_CLOEXEC,
        .resolve = RESOLVE_IN_ROOT | RESOLVE_NO_MAGICLINKS,
    };
    int fd = (int)syscall(SYS_openat2, directory_fd, relative, &how, sizeof(how));
    close(directory_fd);
    if (fd < 0) {
        return 0;
    }
    struct stat st;
    int valid = fstat(fd, &st) == 0 && S_ISREG(st.st_mode) &&
                (st.st_mode & 0111) != 0;
    close(fd);
    return valid;
}

static int safe_regular_below(const char *root, const char *relative) {
    char path[PATH_MAX];
    if (!safe_overlay_path(root) ||
        relative == NULL ||
        relative[0] == '\0' ||
        relative[0] == '/' ||
        strstr(relative, "..") != NULL) {
        return 0;
    }
    int written = snprintf(path, sizeof(path), "%s/%s", root, relative);
    if (written <= 0 || written >= (int)sizeof(path)) {
        return 0;
    }
    struct stat st;
    if (lstat(path, &st) != 0 ||
        !S_ISREG(st.st_mode) ||
        S_ISLNK(st.st_mode) ||
        st.st_nlink != 1 ||
        st.st_size <= 0) {
        return 0;
    }
    return 1;
}

static int mount_capsule(const char *capsule_image, const char *capsule_mount) {
    if (!safe_overlay_path(capsule_mount) || !real_directory(capsule_mount)) {
        fputs("ordax-portable-mount: capsule mount path is unsafe\n", stderr);
        return EXIT_UNSAFE;
    }

    struct loop_binding capsule;
    if (loop_attach(&capsule, capsule_image, 0, 0, 1) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot attach bootstrap capsule EROFS: %s\n", strerror(errno));
        return EXIT_LOOP;
    }

    unsigned long flags = MS_RDONLY | MS_NODEV | MS_NOSUID;
    if (mount(capsule.device, capsule_mount, "erofs", flags, NULL) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount bootstrap capsule EROFS: %s\n", strerror(errno));
        loop_binding_cleanup(&capsule);
        return EXIT_MOUNT;
    }

    if (!safe_executable_below(
            capsule_mount,
            "bootstrap/release-acquisition/ordax-release-agent"
        ) ||
        !safe_executable_below(
            capsule_mount,
            "bootstrap/recovery/entrypoint"
        ) ||
        !safe_regular_below(
            capsule_mount,
            "bootstrap/config/release-envelope-url"
        )) {
        fputs("ordax-portable-mount: bootstrap capsule payload is incomplete or unsafe\n", stderr);
        (void)umount2(capsule_mount, MNT_DETACH);
        loop_binding_cleanup(&capsule);
        return EXIT_UNSAFE;
    }

    capsule.attached = 0;
    close(capsule.backing_fd);
    close(capsule.loop_fd);
    close(capsule.control_fd);
    printf("ORDAX_PORTABLE_CAPSULE_LOOP=%s\n", capsule.device);
    printf("ORDAX_PORTABLE_CAPSULE_ROOT=%s\n", capsule_mount);
    return 0;
}

static int state_base_overlay_dirs(
    const char *state_mount,
    char upper[PATH_MAX],
    char work[PATH_MAX]
) {
    return safe_nested_directory(state_mount, "ordax/base/upper", upper) &&
           safe_nested_directory(state_mount, "ordax/base/work", work);
}

static int mount_base(
    const char *base_image,
    const char *state_mount,
    const char *base_mount,
    const char *root_mount
) {
    if (!safe_overlay_path(state_mount) ||
        !safe_overlay_path(base_mount) ||
        !safe_overlay_path(root_mount) ||
        !real_directory(state_mount) ||
        !real_directory(base_mount) ||
        !real_directory(root_mount) ||
        strcmp(base_mount, root_mount) == 0) {
        fputs("ordax-portable-mount: base mount path is unsafe\n", stderr);
        return EXIT_UNSAFE;
    }

    char upper[PATH_MAX];
    char work[PATH_MAX];
    if (!state_base_overlay_dirs(state_mount, upper, work)) {
        fputs("ordax-portable-mount: ext4 state lacks safe ordax/base upper/work directories\n", stderr);
        return EXIT_UNSAFE;
    }

    struct loop_binding base;
    if (loop_attach(&base, base_image, 0, 0, 1) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot attach Stable Base EROFS: %s\n", strerror(errno));
        return EXIT_LOOP;
    }

    unsigned long ro_flags = MS_RDONLY | MS_NODEV | MS_NOSUID;
    if (mount(base.device, base_mount, "erofs", ro_flags, NULL) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount Stable Base EROFS: %s\n", strerror(errno));
        loop_binding_cleanup(&base);
        return EXIT_MOUNT;
    }
    if (!safe_executable_below(base_mount, "sbin/ordax-stable-init")) {
        fputs("ordax-portable-mount: Stable Base lacks safe sbin/ordax-stable-init\n", stderr);
        (void)umount2(base_mount, MNT_DETACH);
        loop_binding_cleanup(&base);
        return EXIT_UNSAFE;
    }

    char options[PATH_MAX * 3];
    int written = snprintf(
        options,
        sizeof(options),
        "lowerdir=%s,upperdir=%s,workdir=%s",
        base_mount,
        upper,
        work
    );
    if (written <= 0 || written >= (int)sizeof(options)) {
        fputs("ordax-portable-mount: Stable Base overlay option path is too long\n", stderr);
        (void)umount2(base_mount, MNT_DETACH);
        loop_binding_cleanup(&base);
        return EXIT_UNSAFE;
    }
    if (mount("overlay", root_mount, "overlay", MS_NODEV | MS_NOSUID, options) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount Stable Base overlay: %s\n", strerror(errno));
        (void)umount2(base_mount, MNT_DETACH);
        loop_binding_cleanup(&base);
        return EXIT_MOUNT;
    }

    base.attached = 0;
    close(base.backing_fd);
    close(base.loop_fd);
    close(base.control_fd);
    printf("ORDAX_PORTABLE_BASE_LOOP=%s\n", base.device);
    printf("ORDAX_PORTABLE_BASE_ROOT=%s\n", root_mount);
    return 0;
}

static int mount_system(
    const char *release_image,
    const char *release_mount,
    const char *system_mount
) {
    if (!safe_overlay_path(release_mount) ||
        !safe_overlay_path(system_mount) ||
        !real_directory(release_mount) ||
        !real_directory(system_mount) ||
        strcmp(release_mount, system_mount) == 0) {
        fputs("ordax-portable-mount: system mount path is unsafe\n", stderr);
        return EXIT_UNSAFE;
    }

    struct loop_binding release;
    if (loop_attach(&release, release_image, 0, 0, 1) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot attach EROFS release image: %s\n", strerror(errno));
        return EXIT_LOOP;
    }

    unsigned long release_flags = MS_RDONLY | MS_NODEV | MS_NOSUID;
    if (mount(release.device, release_mount, "erofs", release_flags, NULL) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount EROFS release: %s\n", strerror(errno));
        loop_binding_cleanup(&release);
        return EXIT_MOUNT;
    }

    char lower[PATH_MAX];
    if (!safe_nested_directory(release_mount, "system", lower) ||
        !safe_executable_below(lower, "entrypoint")) {
        fputs("ordax-portable-mount: EROFS release lacks a safe executable system/entrypoint\n", stderr);
        (void)umount2(release_mount, MNT_DETACH);
        loop_binding_cleanup(&release);
        return EXIT_UNSAFE;
    }

    if (mount(lower, system_mount, NULL, MS_BIND, NULL) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot bind immutable system tree: %s\n", strerror(errno));
        (void)umount2(release_mount, MNT_DETACH);
        loop_binding_cleanup(&release);
        return EXIT_MOUNT;
    }
    if (mount(
            NULL,
            system_mount,
            NULL,
            MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NODEV | MS_NOSUID,
            NULL
        ) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot remount system tree read-only: %s\n", strerror(errno));
        (void)umount2(system_mount, MNT_DETACH);
        (void)umount2(release_mount, MNT_DETACH);
        loop_binding_cleanup(&release);
        return EXIT_MOUNT;
    }

    release.attached = 0;
    close(release.backing_fd);
    close(release.loop_fd);
    close(release.control_fd);
    printf("ORDAX_PORTABLE_RELEASE_LOOP=%s\n", release.device);
    printf("ORDAX_PORTABLE_SYSTEM_ROOT=%s\n", system_mount);
    return 0;
}


static int mount_surface_runtime(
    const char *runtime_image,
    const char *runtime_lower,
    const char *runtime_upper,
    const char *runtime_work,
    const char *runtime_root
) {
    if (!safe_overlay_path(runtime_lower) ||
        !safe_overlay_path(runtime_upper) ||
        !safe_overlay_path(runtime_work) ||
        !safe_overlay_path(runtime_root) ||
        !real_directory(runtime_lower) ||
        !real_directory(runtime_upper) ||
        !real_directory(runtime_work) ||
        !real_directory(runtime_root) ||
        strcmp(runtime_lower, runtime_upper) == 0 ||
        strcmp(runtime_lower, runtime_work) == 0 ||
        strcmp(runtime_lower, runtime_root) == 0 ||
        strcmp(runtime_upper, runtime_work) == 0 ||
        strcmp(runtime_upper, runtime_root) == 0 ||
        strcmp(runtime_work, runtime_root) == 0) {
        fputs("ordax-portable-mount: Surface runtime mount path is unsafe\n", stderr);
        return EXIT_UNSAFE;
    }

    struct loop_binding runtime;
    if (loop_attach(&runtime, runtime_image, 0, 0, 1) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot attach Surface runtime EROFS: %s\n", strerror(errno));
        return EXIT_LOOP;
    }

    unsigned long ro_flags = MS_RDONLY | MS_NODEV | MS_NOSUID;
    if (mount(runtime.device, runtime_lower, "erofs", ro_flags, NULL) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount Surface runtime EROFS: %s\n", strerror(errno));
        loop_binding_cleanup(&runtime);
        return EXIT_MOUNT;
    }

    static const char *required_exec[] = {
        "usr/bin/cage",
        "usr/bin/python3",
        "usr/bin/Xwayland",
        "usr/bin/seatd-launch",
        "sbin/udevd",
        "bin/udevadm",
        "bin/busybox",
    };
    for (size_t i = 0; i < sizeof(required_exec) / sizeof(required_exec[0]); i++) {
        if (!safe_executable_below(runtime_lower, required_exec[i])) {
            fprintf(stderr, "ordax-portable-mount: Surface runtime lacks executable %s\n", required_exec[i]);
            (void)umount2(runtime_lower, MNT_DETACH);
            loop_binding_cleanup(&runtime);
            return EXIT_UNSAFE;
        }
    }

    static const char *required_files[] = {
        "usr/lib/girepository-1.0/Gtk-3.0.typelib",
        "usr/lib/girepository-1.0/WebKit2-4.1.typelib",
        "usr/lib/udev/rules.d/60-input-id.rules",
    };
    for (size_t i = 0; i < sizeof(required_files) / sizeof(required_files[0]); i++) {
        if (!safe_regular_below(runtime_lower, required_files[i])) {
            fprintf(stderr, "ordax-portable-mount: Surface runtime lacks required file %s\n", required_files[i]);
            (void)umount2(runtime_lower, MNT_DETACH);
            loop_binding_cleanup(&runtime);
            return EXIT_UNSAFE;
        }
    }

    char options[PATH_MAX * 3];
    int written = snprintf(
        options,
        sizeof(options),
        "lowerdir=%s,upperdir=%s,workdir=%s",
        runtime_lower,
        runtime_upper,
        runtime_work
    );
    if (written <= 0 || written >= (int)sizeof(options)) {
        fputs("ordax-portable-mount: Surface runtime overlay paths are too long\n", stderr);
        (void)umount2(runtime_lower, MNT_DETACH);
        loop_binding_cleanup(&runtime);
        return EXIT_UNSAFE;
    }
    if (mount("overlay", runtime_root, "overlay", MS_NODEV | MS_NOSUID, options) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot compose ephemeral Surface runtime overlay: %s\n", strerror(errno));
        (void)umount2(runtime_lower, MNT_DETACH);
        loop_binding_cleanup(&runtime);
        return EXIT_MOUNT;
    }

    runtime.attached = 0;
    close(runtime.backing_fd);
    close(runtime.loop_fd);
    close(runtime.control_fd);
    printf("ORDAX_SURFACE_RUNTIME_LOOP=%s\n", runtime.device);
    printf("ORDAX_SURFACE_RUNTIME_ROOT=%s\n", runtime_root);
    return 0;
}

static int mount_ai_runtime(
    const char *runtime_image,
    const char *runtime_root
) {
    if (!safe_overlay_path(runtime_root) || !real_directory(runtime_root)) {
        fputs("ordax-portable-mount: local AI runtime mount path is unsafe\n", stderr);
        return EXIT_UNSAFE;
    }

    struct loop_binding runtime;
    if (loop_attach(&runtime, runtime_image, 0, 0, 1) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot attach local AI runtime EROFS: %s\n", strerror(errno));
        return EXIT_LOOP;
    }

    unsigned long ro_flags = MS_RDONLY | MS_NODEV | MS_NOSUID;
    if (mount(runtime.device, runtime_root, "erofs", ro_flags, NULL) != 0) {
        fprintf(stderr, "ordax-portable-mount: cannot mount local AI runtime EROFS: %s\n", strerror(errno));
        loop_binding_cleanup(&runtime);
        return EXIT_MOUNT;
    }

    static const char *required_exec[] = {
        "bin/llama-server",
        "bin/ordax-local-ai",
    };
    for (size_t i = 0; i < sizeof(required_exec) / sizeof(required_exec[0]); i++) {
        if (!safe_executable_below(runtime_root, required_exec[i])) {
            fprintf(stderr, "ordax-portable-mount: local AI runtime lacks executable %s\n", required_exec[i]);
            (void)umount2(runtime_root, MNT_DETACH);
            loop_binding_cleanup(&runtime);
            return EXIT_UNSAFE;
        }
    }

    static const char *required_files[] = {
        "metadata/source-lock.json",
        "metadata/runtime-policy.json",
    };
    for (size_t i = 0; i < sizeof(required_files) / sizeof(required_files[0]); i++) {
        if (!safe_regular_below(runtime_root, required_files[i])) {
            fprintf(stderr, "ordax-portable-mount: local AI runtime lacks required file %s\n", required_files[i]);
            (void)umount2(runtime_root, MNT_DETACH);
            loop_binding_cleanup(&runtime);
            return EXIT_UNSAFE;
        }
    }

    char model_dir[PATH_MAX];
    if (!safe_nested_directory(runtime_root, "models", model_dir)) {
        fputs("ordax-portable-mount: local AI runtime lacks safe models directory\n", stderr);
        (void)umount2(runtime_root, MNT_DETACH);
        loop_binding_cleanup(&runtime);
        return EXIT_UNSAFE;
    }

    runtime.attached = 0;
    close(runtime.backing_fd);
    close(runtime.loop_fd);
    close(runtime.control_fd);
    printf("ORDAX_LOCAL_AI_RUNTIME_LOOP=%s\n", runtime.device);
    printf("ORDAX_LOCAL_AI_RUNTIME_ROOT=%s\n", runtime_root);
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 4 && strcmp(argv[1], "mount-state") == 0) {
        return mount_state(argv[2], argv[3]);
    }
    if (argc == 4 && strcmp(argv[1], "mount-capsule") == 0) {
        return mount_capsule(argv[2], argv[3]);
    }
    if (argc == 6 && strcmp(argv[1], "mount-base") == 0) {
        return mount_base(argv[2], argv[3], argv[4], argv[5]);
    }
    if (argc == 5 && strcmp(argv[1], "mount-system") == 0) {
        return mount_system(argv[2], argv[3], argv[4]);
    }
    if (argc == 7 && strcmp(argv[1], "mount-surface-runtime") == 0) {
        return mount_surface_runtime(argv[2], argv[3], argv[4], argv[5], argv[6]);
    }
    if (argc == 4 && strcmp(argv[1], "mount-ai-runtime") == 0) {
        return mount_ai_runtime(argv[2], argv[3]);
    }
    usage();
    return EXIT_USAGE;
}
