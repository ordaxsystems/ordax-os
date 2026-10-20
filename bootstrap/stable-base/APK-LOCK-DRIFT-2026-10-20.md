# Stable Base APK lock drift — 2026-10-20

## Observed failure

The `Portable v2 QEMU Boot Proof` run **39476365071**, job **118813346675**, on commit `73d6923ca2cb9e7c37fcc712f21dda9c20414c48`, stopped while resolving the exact Stable Base APK lock:

```text
ERROR: unable to select packages:
  ca-certificates-20261020-r0: breaks: world[ca-certificates=20260909-r0]
```

This is direct resolver evidence that the configured repository no longer offers the pinned `ca-certificates` version and currently resolves `20261020-r0`. The failure did not produce or boot a new Stable Base candidate.

## Source update and reproof gate

`source.json` now pins only `ca-certificates` to `20261020-r0`. The other 39 package pins and the 40-package lock scope are unchanged. The contract records the CI run, job, source commit and old/new versions in `apk_package_lock_refresh`.

This source update requires a fresh Stable Base Candidate run to verify the complete transitive lock and build provenance. Until that candidate succeeds and its evidence is reviewed, the prior discovery evidence remains historical, `candidate_artifact_recorded` stays `false`, and `physical_artifact_authorized` stays `false`. This change does not authorize promotion or physical installation.

## Acceptance

- [x] Exact-version resolver failure identified in canonical QEMU CI
- [x] Only the package version named by that failure refreshed in the source lock
- [ ] Stable Base Candidate re-resolves all 40 locked packages successfully
- [ ] Candidate artifact provenance is reviewed and recorded
- [ ] Physical-artifact authorization remains a separate gate
