# Surface Runtime — full Alpine lock refresh, 2026-10-18

**Scope:** shared immutable EROFS runtime package lock, not a USB flash or product promotion.

The prior full 253-package APK lock no longer resolves from the pinned Alpine
v3.22 repositories. The real Owner Creator runtime build in
[workflow #39139622997](https://github.com/ordaxsystems/ordax-os/actions/runs/39139622997)
failed closed, rather than proceeding to QEMU, because the Alpine repository
now offers libexpat 2.9.0-r0 while the committed lock demands 2.8.5-r0.

The canonical
[Surface Runtime Candidate discovery #39140052603](https://github.com/ordaxsystems/ordax-os/actions/runs/39140052603)
ran on exact source 8befe3a67a5521dc3f96ade89d511da1ef333731 and retained
artifact 12141830076 (ZIP SHA-256
\`9159bb79aa4e593054319304d31db19f4fd4268e4808e410b2e30164640ae212\`).
It resolved exactly 253 packages, no missing or extra packages, and reported
exactly the following two version differences:

| Package | Previously pinned | Currently resolved |
| --- | --- | --- |
| libcurl | 8.14.1-r3 | 8.14.1-r4 |
| libexpat | 2.8.5-r0 | 2.9.0-r0 |

This update changes the existing **single full transitive lock** and associates
its discovery evidence. It does not introduce a second lock, remove pins or
permit any download during first boot. A successful revalidation against the
current repositories, two byte-reproducible EROFS builds, tests and USB QEMU
proof are required on the exact new source commit. Historical digests remain
historical only; the new candidate is **not yet byte-reproducibility-proven**.

There is no authorization for physical USB writes, internal disk changes,
production release, or Stable/MVP promotion here. The unrelated Owner USB
PR #1949 should integrate this fix only after its independent gates pass.
