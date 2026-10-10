#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

enum {
    EXIT_USAGE = 2,
    EXIT_ABSENT = 3,
    EXIT_INVALID = 4,
};

static void die_usage(void) {
    fputs(
        "usage:\n"
        "  ordax-portable-state <state-root> <current|known-good|candidate|rejected>\n"
        "  ordax-portable-state resolve <state-root> <portable-root> <current|known-good>\n"
        "  ordax-portable-state select <state-root> <portable-root>\n"
        "  ordax-portable-state prepare <state-root> <portable-root> <candidate-commit>\n"
        "  ordax-portable-state select-boot <state-root> <portable-root>\n"
        "  ordax-portable-state commit <state-root> <portable-root> <candidate-commit>\n"
        "  ordax-portable-state rollback <state-root> <portable-root> <candidate-commit>\n",
        stderr
    );
    exit(EXIT_USAGE);
}

static int safe_dir_at(int parent, const char *name) {
    int fd = openat(parent, name, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) {
        return -1;
    }
    struct stat st;
    if (fstat(fd, &st) != 0 || !S_ISDIR(st.st_mode)) {
        close(fd);
        errno = ENOTDIR;
        return -1;
    }
    return fd;
}

static int safe_root(const char *path) {
    int fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) {
        return -1;
    }
    struct stat st;
    if (fstat(fd, &st) != 0 || !S_ISDIR(st.st_mode)) {
        close(fd);
        errno = ENOTDIR;
        return -1;
    }
    return fd;
}

static int valid_slot(const char *slot) {
    return strcmp(slot, "current") == 0 ||
           strcmp(slot, "known-good") == 0 ||
           strcmp(slot, "candidate") == 0 ||
           strcmp(slot, "rejected") == 0;
}

static int valid_commit_value(const char *value) {
    if (value == NULL || strlen(value) != 40) {
        return 0;
    }
    for (int i = 0; i < 40; i++) {
        const char ch = value[i];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) {
            return 0;
        }
    }
    return 1;
}

static int read_commit(int parent, const char *slot, char out[41]) {
    int fd = openat(parent, slot, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) {
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }

    struct stat st;
    if (fstat(fd, &st) != 0 ||
        !S_ISREG(st.st_mode) ||
        st.st_nlink != 1 ||
        st.st_size < 40 ||
        st.st_size > 41) {
        close(fd);
        return EXIT_INVALID;
    }

    char buffer[42] = {0};
    ssize_t n = read(fd, buffer, sizeof(buffer));
    if (n < 0) {
        close(fd);
        return EXIT_INVALID;
    }
    char extra;
    ssize_t extra_n = read(fd, &extra, 1);
    close(fd);
    if (extra_n != 0) {
        return EXIT_INVALID;
    }
    if (n != 40 && n != 41) {
        return EXIT_INVALID;
    }
    if (n == 41 && buffer[40] != '\n') {
        return EXIT_INVALID;
    }
    for (int i = 0; i < 40; i++) {
        const char ch = buffer[i];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) {
            return EXIT_INVALID;
        }
        out[i] = ch;
    }
    out[40] = '\0';
    return 0;
}

static int safe_regular_at(int parent, const char *name, off_t minimum_size) {
    int fd = openat(parent, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
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

static int erofs_magic_ok(int fd) {
    unsigned char magic[4];
    ssize_t n = pread(fd, magic, sizeof(magic), 1024);
    return n == 4 &&
           magic[0] == 0xe2 &&
           magic[1] == 0xe1 &&
           magic[2] == 0xf5 &&
           magic[3] == 0xe0;
}

static int release_materialized_safely(int releases, const char *commit) {
    int release = safe_dir_at(releases, commit);
    if (release < 0) {
        return 0;
    }

    int image = safe_regular_at(release, "system.erofs", 4096);
    int manifest = safe_regular_at(release, "release-manifest.json", 2);
    int envelope = safe_regular_at(release, "release-envelope.json", 2);
    int ok = image >= 0 &&
             manifest >= 0 &&
             envelope >= 0 &&
             erofs_magic_ok(image);

    if (image >= 0) {
        close(image);
    }
    if (manifest >= 0) {
        close(manifest);
    }
    if (envelope >= 0) {
        close(envelope);
    }
    close(release);
    return ok;
}

static int open_release_state_root(const char *state_root) {
    int root = safe_root(state_root);
    if (root < 0) {
        return -1;
    }
    int ordax = safe_dir_at(root, "ordax");
    close(root);
    if (ordax < 0) {
        return -1;
    }
    int release = safe_dir_at(ordax, "portable-release");
    close(ordax);
    return release;
}

static int open_materialized_releases(const char *portable_root) {
    int root = safe_root(portable_root);
    if (root < 0) {
        return -1;
    }
    int releases = safe_dir_at(root, "releases");
    close(root);
    return releases;
}


#define TRANSACTION_FILE "activation-transaction.json"
#define TRANSACTION_SCHEMA "ordax.portable-activation/1"

struct activation_transaction {
    char previous[41];
    char candidate[41];
    int attempt;
};

static int write_fd_all(int fd, const char *value, size_t length) {
    while (length > 0) {
        ssize_t n = write(fd, value, length);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        value += (size_t)n;
        length -= (size_t)n;
    }
    return 0;
}

static int atomic_write_at(
    int parent,
    const char *name,
    const char *value,
    size_t length
) {
    char temporary[128];
    int written = snprintf(
        temporary,
        sizeof(temporary),
        ".%s.tmp.%ld",
        name,
        (long)getpid()
    );
    if (written <= 0 || (size_t)written >= sizeof(temporary)) {
        errno = ENAMETOOLONG;
        return -1;
    }

    int fd = openat(
        parent,
        temporary,
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW,
        0600
    );
    if (fd < 0) {
        return -1;
    }

    int ok = 0;
    if (write_fd_all(fd, value, length) != 0 || fsync(fd) != 0) {
        ok = -1;
    }
    if (close(fd) != 0) {
        ok = -1;
    }
    if (ok == 0 && renameat(parent, temporary, parent, name) != 0) {
        ok = -1;
    }
    if (ok == 0 && fsync(parent) != 0) {
        ok = -1;
    }
    if (ok != 0) {
        int saved = errno;
        unlinkat(parent, temporary, 0);
        errno = saved;
        return -1;
    }
    return 0;
}

static int remove_file_at_sync(int parent, const char *name) {
    if (unlinkat(parent, name, 0) != 0 && errno != ENOENT) {
        return -1;
    }
    return fsync(parent);
}

static int write_commit_at(int parent, const char *name, const char *commit) {
    if (!valid_commit_value(commit)) {
        errno = EINVAL;
        return -1;
    }
    char payload[42];
    int written = snprintf(payload, sizeof(payload), "%s\n", commit);
    if (written != 41) {
        errno = EINVAL;
        return -1;
    }
    return atomic_write_at(parent, name, payload, (size_t)written);
}

static int transaction_payload(
    const struct activation_transaction *transaction,
    char out[256]
) {
    if (!valid_commit_value(transaction->previous) ||
        !valid_commit_value(transaction->candidate) ||
        (transaction->attempt != 0 && transaction->attempt != 1)) {
        return -1;
    }
    int written = snprintf(
        out,
        256,
        "{\"schema\":\"" TRANSACTION_SCHEMA "\","
        "\"previous\":\"%s\","
        "\"candidate\":\"%s\","
        "\"attempt\":%d}",
        transaction->previous,
        transaction->candidate,
        transaction->attempt
    );
    return written > 0 && written < 256 ? written : -1;
}

static int read_transaction(
    int parent,
    struct activation_transaction *transaction
) {
    int fd = openat(
        parent,
        TRANSACTION_FILE,
        O_RDONLY | O_CLOEXEC | O_NOFOLLOW
    );
    if (fd < 0) {
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }

    struct stat st;
    if (fstat(fd, &st) != 0 ||
        !S_ISREG(st.st_mode) ||
        st.st_nlink != 1 ||
        st.st_size <= 0 ||
        st.st_size >= 256) {
        close(fd);
        return EXIT_INVALID;
    }

    char buffer[256] = {0};
    ssize_t n = read(fd, buffer, sizeof(buffer) - 1);
    if (n <= 0) {
        close(fd);
        return EXIT_INVALID;
    }
    char extra;
    ssize_t extra_n = read(fd, &extra, 1);
    close(fd);
    if (extra_n != 0) {
        return EXIT_INVALID;
    }
    if (buffer[n - 1] == '\n') {
        buffer[n - 1] = '\0';
    } else {
        buffer[n] = '\0';
    }

    char previous[41] = {0};
    char candidate[41] = {0};
    int attempt = -1;
    int consumed = 0;
    if (sscanf(
            buffer,
            "{\"schema\":\"" TRANSACTION_SCHEMA "\","
            "\"previous\":\"%40[0-9a-f]\","
            "\"candidate\":\"%40[0-9a-f]\","
            "\"attempt\":%d}%n",
            previous,
            candidate,
            &attempt,
            &consumed
        ) != 3 ||
        buffer[consumed] != '\0' ||
        !valid_commit_value(previous) ||
        !valid_commit_value(candidate) ||
        (attempt != 0 && attempt != 1)) {
        return EXIT_INVALID;
    }

    struct activation_transaction parsed = {0};
    memcpy(parsed.previous, previous, 41);
    memcpy(parsed.candidate, candidate, 41);
    parsed.attempt = attempt;

    char canonical[256];
    int canonical_length = transaction_payload(&parsed, canonical);
    if (canonical_length < 0 || strcmp(buffer, canonical) != 0) {
        return EXIT_INVALID;
    }

    *transaction = parsed;
    return 0;
}

static int write_transaction_at(
    int parent,
    const struct activation_transaction *transaction
) {
    char payload[256];
    int length = transaction_payload(transaction, payload);
    if (length < 0) {
        errno = EINVAL;
        return -1;
    }
    payload[length++] = '\n';
    return atomic_write_at(parent, TRANSACTION_FILE, payload, (size_t)length);
}

static int cleanup_transaction(int parent) {
    /*
     * Revoke boot authority before removing the advisory candidate identity.
     * If power is lost between these durable unlinks, an orphan candidate is
     * harmless because select/select-boot never grants it authority without
     * activation-transaction.json. prepare() removes that orphan before
     * arming a later transaction.
     */
    if (remove_file_at_sync(parent, TRANSACTION_FILE) != 0) {
        return -1;
    }
    return remove_file_at_sync(parent, "candidate");
}

static int write_all(const char *value, size_t length) {
    while (length > 0) {
        ssize_t n = write(STDOUT_FILENO, value, length);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        value += (size_t)n;
        length -= (size_t)n;
    }
    return 0;
}

static int print_commit(const char *commit) {
    return write_all(commit, 40) == 0 && write_all("\n", 1) == 0 ? 0 : -1;
}

static int read_slot_command(const char *state_root, const char *slot) {
    if (!valid_slot(slot)) {
        return EXIT_USAGE;
    }
    int release = open_release_state_root(state_root);
    if (release < 0) {
        if (errno == ENOENT) {
            return EXIT_ABSENT;
        }
        fputs("ordax-portable-state: unsafe portable release state root\n", stderr);
        return EXIT_INVALID;
    }

    char commit[41];
    int rc = read_commit(release, slot, commit);
    close(release);
    if (rc != 0) {
        if (rc == EXIT_INVALID) {
            fprintf(stderr, "ordax-portable-state: invalid %s identity\n", slot);
        }
        return rc;
    }
    if (print_commit(commit) != 0) {
        fputs("ordax-portable-state: cannot write result\n", stderr);
        return EXIT_INVALID;
    }
    return 0;
}

static int boot_slot(const char *slot) {
    return strcmp(slot, "current") == 0 || strcmp(slot, "known-good") == 0;
}

static int resolve_command(
    const char *state_root,
    const char *portable_root,
    const char *slot
) {
    if (!boot_slot(slot)) {
        return EXIT_USAGE;
    }

    int release_state = open_release_state_root(state_root);
    if (release_state < 0) {
        if (errno == ENOENT) {
            return EXIT_ABSENT;
        }
        fputs("ordax-portable-state: unsafe portable release state root\n", stderr);
        return EXIT_INVALID;
    }
    int releases = open_materialized_releases(portable_root);
    if (releases < 0) {
        close(release_state);
        if (errno == ENOENT) {
            return EXIT_ABSENT;
        }
        fputs("ordax-portable-state: unsafe materialized releases root\n", stderr);
        return EXIT_INVALID;
    }

    char commit[41];
    int rc = read_commit(release_state, slot, commit);
    if (rc == 0 && !release_materialized_safely(releases, commit)) {
        rc = EXIT_INVALID;
    }
    close(releases);
    close(release_state);

    if (rc != 0) {
        if (rc == EXIT_INVALID) {
            fprintf(stderr, "ordax-portable-state: %s is not safely materialized\n", slot);
        }
        return rc;
    }
    if (print_commit(commit) != 0) {
        fputs("ordax-portable-state: cannot write resolved identity\n", stderr);
        return EXIT_INVALID;
    }
    return 0;
}

static int select_command(const char *state_root, const char *portable_root) {
    int release_state = open_release_state_root(state_root);
    if (release_state < 0) {
        if (errno == ENOENT) {
            return EXIT_ABSENT;
        }
        fputs("ordax-portable-state: unsafe portable release state root\n", stderr);
        return EXIT_INVALID;
    }

    int releases = open_materialized_releases(portable_root);
    if (releases < 0) {
        close(release_state);
        if (errno == ENOENT) {
            return EXIT_ABSENT;
        }
        fputs("ordax-portable-state: unsafe materialized releases root\n", stderr);
        return EXIT_INVALID;
    }

    const char *slots[] = {"current", "known-good"};
    char commit[41];
    for (size_t index = 0; index < sizeof(slots) / sizeof(slots[0]); index++) {
        const char *slot = slots[index];
        int rc = read_commit(release_state, slot, commit);
        if (rc != 0) {
            continue;
        }
        if (!release_materialized_safely(releases, commit)) {
            continue;
        }

        if (write_all(slot, strlen(slot)) != 0 ||
            write_all(" ", 1) != 0 ||
            print_commit(commit) != 0) {
            close(releases);
            close(release_state);
            fputs("ordax-portable-state: cannot write selection\n", stderr);
            return EXIT_INVALID;
        }
        close(releases);
        close(release_state);
        return 0;
    }

    close(releases);
    close(release_state);
    fputs("ordax-portable-state: no safely materialized current or known-good release\n", stderr);
    return EXIT_ABSENT;
}


static int prepare_command(
    const char *state_root,
    const char *portable_root,
    const char *candidate
) {
    if (!valid_commit_value(candidate)) {
        return EXIT_USAGE;
    }

    int release_state = open_release_state_root(state_root);
    if (release_state < 0) {
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }
    int releases = open_materialized_releases(portable_root);
    if (releases < 0) {
        close(release_state);
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }

    struct activation_transaction existing;
    int tx_rc = read_transaction(release_state, &existing);
    if (tx_rc == 0 || tx_rc == EXIT_INVALID) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation transaction already exists or is invalid\n", stderr);
        return EXIT_INVALID;
    }

    char current[41];
    char known_good[41];
    int current_rc = read_commit(release_state, "current", current);
    int known_good_rc = read_commit(release_state, "known-good", known_good);
    if (current_rc != 0 ||
        known_good_rc != 0 ||
        !release_materialized_safely(releases, current) ||
        !release_materialized_safely(releases, known_good) ||
        !release_materialized_safely(releases, candidate) ||
        strcmp(current, candidate) == 0) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation identities are not safely materialized\n", stderr);
        return EXIT_INVALID;
    }

    int orphan_rc = read_commit(release_state, "candidate", known_good);
    if (orphan_rc == 0) {
        if (remove_file_at_sync(release_state, "candidate") != 0) {
            close(releases);
            close(release_state);
            return EXIT_INVALID;
        }
    } else if (orphan_rc == EXIT_INVALID) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: orphan candidate identity is invalid\n", stderr);
        return EXIT_INVALID;
    }

    char rejected[41];
    int rejected_rc = read_commit(release_state, "rejected", rejected);
    if (rejected_rc == 0) {
        if (strcmp(rejected, candidate) == 0) {
            close(releases);
            close(release_state);
            fputs("ordax-portable-state: candidate was already rejected\n", stderr);
            return EXIT_INVALID;
        }
        if (remove_file_at_sync(release_state, "rejected") != 0) {
            close(releases);
            close(release_state);
            return EXIT_INVALID;
        }
    } else if (rejected_rc == EXIT_INVALID) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: rejected identity is invalid\n", stderr);
        return EXIT_INVALID;
    }

    struct activation_transaction transaction = {0};
    memcpy(transaction.previous, current, 41);
    memcpy(transaction.candidate, candidate, 41);
    transaction.attempt = 0;

    if (write_commit_at(release_state, "candidate", candidate) != 0 ||
        write_transaction_at(release_state, &transaction) != 0) {
        remove_file_at_sync(release_state, "candidate");
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: cannot arm activation transaction\n", stderr);
        return EXIT_INVALID;
    }

    close(releases);
    close(release_state);
    return print_commit(candidate) == 0 ? 0 : EXIT_INVALID;
}

static int select_boot_command(
    const char *state_root,
    const char *portable_root
) {
    int release_state = open_release_state_root(state_root);
    if (release_state < 0) {
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }
    int releases = open_materialized_releases(portable_root);
    if (releases < 0) {
        close(release_state);
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }

    struct activation_transaction transaction;
    int tx_rc = read_transaction(release_state, &transaction);
    if (tx_rc == EXIT_ABSENT) {
        close(releases);
        close(release_state);
        return select_command(state_root, portable_root);
    }
    if (tx_rc != 0) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation transaction is invalid\n", stderr);
        return EXIT_INVALID;
    }

    char current[41];
    char known_good[41];
    char candidate[41];
    if (read_commit(release_state, "current", current) != 0 ||
        read_commit(release_state, "known-good", known_good) != 0 ||
        read_commit(release_state, "candidate", candidate) != 0 ||
        strcmp(candidate, transaction.candidate) != 0 ||
        !release_materialized_safely(releases, current) ||
        !release_materialized_safely(releases, known_good)) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation transaction references unsafe release state\n", stderr);
        return EXIT_INVALID;
    }

    if (strcmp(current, transaction.candidate) == 0) {
        if (strcmp(known_good, transaction.previous) != 0 ||
            cleanup_transaction(release_state) != 0) {
            close(releases);
            close(release_state);
            return EXIT_INVALID;
        }
        close(releases);
        close(release_state);
        if (write_all("current ", 8) != 0 || print_commit(current) != 0) {
            return EXIT_INVALID;
        }
        return 0;
    }

    if (strcmp(current, transaction.previous) != 0) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation transaction previous release changed\n", stderr);
        return EXIT_INVALID;
    }

    /* An interrupted or corrupted candidate must not strand a verified
     * previous release. Transaction and slot identities above still match. */
    if (transaction.attempt == 0 && release_materialized_safely(releases, candidate)) {
        transaction.attempt = 1;
        if (write_transaction_at(release_state, &transaction) != 0) {
            close(releases);
            close(release_state);
            return EXIT_INVALID;
        }
        close(releases);
        close(release_state);
        if (write_all("candidate ", 10) != 0 || print_commit(candidate) != 0) {
            return EXIT_INVALID;
        }
        return 0;
    }

    if (write_commit_at(release_state, "rejected", candidate) != 0 ||
        cleanup_transaction(release_state) != 0) {
        close(releases);
        close(release_state);
        return EXIT_INVALID;
    }
    close(releases);
    close(release_state);
    if (write_all("current ", 8) != 0 || print_commit(current) != 0) {
        return EXIT_INVALID;
    }
    return 0;
}

static int commit_command(
    const char *state_root,
    const char *portable_root,
    const char *candidate
) {
    if (!valid_commit_value(candidate)) {
        return EXIT_USAGE;
    }

    int release_state = open_release_state_root(state_root);
    if (release_state < 0) {
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }
    int releases = open_materialized_releases(portable_root);
    if (releases < 0) {
        close(release_state);
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }

    struct activation_transaction transaction;
    char current[41];
    char candidate_file[41];
    if (read_transaction(release_state, &transaction) != 0 ||
        transaction.attempt != 1 ||
        strcmp(transaction.candidate, candidate) != 0 ||
        read_commit(release_state, "current", current) != 0 ||
        read_commit(release_state, "candidate", candidate_file) != 0 ||
        strcmp(candidate_file, candidate) != 0 ||
        strcmp(current, transaction.previous) != 0 ||
        !release_materialized_safely(releases, current) ||
        !release_materialized_safely(releases, candidate)) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation transaction cannot be committed\n", stderr);
        return EXIT_INVALID;
    }

    if (write_commit_at(release_state, "known-good", transaction.previous) != 0 ||
        write_commit_at(release_state, "current", candidate) != 0 ||
        cleanup_transaction(release_state) != 0) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation commit was incomplete\n", stderr);
        return EXIT_INVALID;
    }

    close(releases);
    close(release_state);
    return print_commit(candidate) == 0 ? 0 : EXIT_INVALID;
}

static int rollback_command(
    const char *state_root,
    const char *portable_root,
    const char *candidate
) {
    if (!valid_commit_value(candidate)) {
        return EXIT_USAGE;
    }

    int release_state = open_release_state_root(state_root);
    if (release_state < 0) {
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }
    int releases = open_materialized_releases(portable_root);
    if (releases < 0) {
        close(release_state);
        return errno == ENOENT ? EXIT_ABSENT : EXIT_INVALID;
    }

    struct activation_transaction transaction;
    char current[41];
    char candidate_file[41];
    if (read_transaction(release_state, &transaction) != 0 ||
        strcmp(transaction.candidate, candidate) != 0 ||
        read_commit(release_state, "current", current) != 0 ||
        read_commit(release_state, "candidate", candidate_file) != 0 ||
        strcmp(candidate_file, candidate) != 0 ||
        strcmp(current, transaction.previous) != 0 ||
        !release_materialized_safely(releases, current)) {
        close(releases);
        close(release_state);
        fputs("ordax-portable-state: activation transaction cannot be rolled back\n", stderr);
        return EXIT_INVALID;
    }

    if (write_commit_at(release_state, "rejected", candidate) != 0 ||
        cleanup_transaction(release_state) != 0) {
        close(releases);
        close(release_state);
        return EXIT_INVALID;
    }

    close(releases);
    close(release_state);
    return print_commit(current) == 0 ? 0 : EXIT_INVALID;
}

int main(int argc, char **argv) {
    if (argc == 5 && strcmp(argv[1], "resolve") == 0) {
        return resolve_command(argv[2], argv[3], argv[4]);
    }
    if (argc == 4 && strcmp(argv[1], "select") == 0) {
        return select_command(argv[2], argv[3]);
    }
    if (argc == 5 && strcmp(argv[1], "prepare") == 0) {
        return prepare_command(argv[2], argv[3], argv[4]);
    }
    if (argc == 4 && strcmp(argv[1], "select-boot") == 0) {
        return select_boot_command(argv[2], argv[3]);
    }
    if (argc == 5 && strcmp(argv[1], "commit") == 0) {
        return commit_command(argv[2], argv[3], argv[4]);
    }
    if (argc == 5 && strcmp(argv[1], "rollback") == 0) {
        return rollback_command(argv[2], argv[3], argv[4]);
    }
    if (argc == 3 && valid_slot(argv[2])) {
        return read_slot_command(argv[1], argv[2]);
    }
    die_usage();
    return EXIT_USAGE;
}
