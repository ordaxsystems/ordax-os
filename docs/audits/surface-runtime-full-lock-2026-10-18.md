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


## Reproducibility result — exact full lock candidate

The [Surface Runtime Candidate #39140630053](https://github.com/ordaxsystems/ordax-os/actions/runs/39140630053) completed successfully on source \`2e001b75b6e5f25155e3ba735d8c56e34c58539b\`. The canonical build generated two full EROFS runtime candidates from the same reviewed 253-package lock and compared the source tree, normalized TAR and EROFS image bytes with no differences.

- Tree SHA-256: \`845cef22b42c87aecd174d40d26b0f5b96371125594d69b0c4af35d00b8da164\`
- TAR SHA-256: \`5ecdd243adfea369abe51ef842c592268268ffdabd512f536197fefd1a087a88\`
- EROFS SHA-256: \`b04b614033f802a00bb3edbb51b05fc69cb57e42947f5ffb2450f5b85c057799\`
- EROFS size: 1,052,028,928 bytes.
- Artifact proof metadata: \`surface-runtime-candidate-2e001b75b6e5f25155e3ba735d8c56e34c58539b\`, artifact ID \`12140789074\`, ZIP SHA-256 \`374f05ba5818f6abd5bdad2e5a2c0f85973a24ed0447558d6b52071757d0377c\`.

This closes the **candidate EROFS repeat-byte gate**, not first-boot hardware validation, USB flashing or Stable/MVP promotion. The discovery and repeated-build SHAs are intentionally different: package drift was discovered on the old source, then rebuilt on the new pinned source. The metadata-only completion commit must still pass its own CI. Separate Foundation/Surface presentation contract regressions are not overridden.
