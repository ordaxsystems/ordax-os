# Surface runtime APK lock refresh request

This marker intentionally triggers the canonical `Surface Runtime Candidate`
workflow without modifying the previously reviewed APK lock evidence.

Reason: QEMU workflow run `36854018233` proved that the mutable Alpine v3.22
package index no longer satisfies the committed exact lock. The first observed
drift was Python `3.12.14-r0 -> 3.12.15-r0`.

The workflow must resolve the **full transitive package graph** with
`bootstrap/surface-runtime/discover_lock.py`, write its fail-closed drift
report, and upload metadata only. No package version is guessed here and no
physical artifact or USB write is authorized.
