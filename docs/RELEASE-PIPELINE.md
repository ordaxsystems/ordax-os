# Release Pipeline Contract

Status: CI PROOF ONLY — NOT A PRODUCTION RELEASE OR PHYSICAL AUTHORIZATION

The release pipeline is intentionally split into small owners with independent validation. The Native assembly step is a build-time composition owner, not a new runtime channel:

```text
shared system source + pinned Native/Surface/AI inputs
 -> deterministic system.erofs
 -> deterministic native-surface-runtime.erofs
 -> deterministic local-ai-runtime.erofs
 -> tools/release-manifest (release-manifest/4)
 -> tools/release-signing + canonical public trust + external canonical private key
 -> release-envelope/1
 -> bootstrap/release-acquisition materialize-portable-v4
 -> verify-portable-v4-exact
 -> Stable boot handoff with read-only Surface + AI runtime mounts
 -> disposable boot proof
 -> separate physical-write authorization gate
```

The v1 `system.tar` pipeline remains supported as a legacy compatibility path and
is not silently reinterpreted as v4.

## Native release assembly

The OS owns the Native services and execution source under `system/`; the shared **visual** source is versioned solely by `ordaxsystems/ordax-surface`. The source assembly step `tools/surface-source/assemble.py` creates a disposable `system/` tree by preserving OS-owned files and materializing the exact externally pinned visual revision (see `docs/contracts/surface-source.json`). Native-only prebuilt executables required by the USB/Native capability boundary are then injected into this **same staged tree** by `tools/native-release-assembly/build.py --system-source .../system` before bundling. The Native assembler rechecks the two repository commit identities and every visual source byte against the assembly receipt.

The Native release assembly currently adds exactly two contracted binaries:

```text
system/bin/ordax-native-install-targets
system/bin/ordax-runtime-component-channel
```

The first remains the read-only Native install target/plan helper. The second is the runtime-component signature verifier and activation-state owner used by the future `component-slot` path; it has no component publishing authority and receives no private signing key.

CI cross-compiles both as static `linux/amd64` binaries, records SHA-256/size/mode/source package/source commit in `system/.ordax/native-release-tools.json`, proves repeat-byte identity across two independent assemblies, and then the ordinary deterministic bundler includes those bytes in the same signed `system.tar`.

There is no separate helper download channel and no compilation on the user's device. Because both helpers are inside `system.tar`, their executable bytes are covered by the same whole-system release manifest hash and Ed25519 envelope. Runtime-component package authenticity remains a separate component-trust domain; the whole-OS signature does not authorize a component package. Native physical APPLY and component publication remain unauthorized.

## CI integration proof

`.github/workflows/release-pipeline.yml` composes the real tools against an isolated temporary system fixture. It proves:

```text
SOURCE_TO_BUNDLE=PASS
BUNDLE_TO_MANIFEST=PASS
MANIFEST_TO_SIGNED_ENVELOPE=PASS
SIGNED_ENVELOPE_TO_AGENT=PASS
```

The workflow uses a CI-only ephemeral Ed25519 key. The private key exists only under the runner temporary directory, is removed before completion and is never uploaded. A separate Local AI candidate gate also proves release-manifest/4 signing, loopback-HTTPS acquisition, exact materialization and byte identity of the real AI EROFS without using the canonical private key.

The proof deliberately does **not**:

- create or rotate the canonical release key;
- satisfy `bootstrap-release-trust`;
- publish a GitHub Release;
- move the canonical `latest` release pointer;
- authorize Creator APPLY;
- write or repartition physical media.

## Production boundary

Production release publication remains blocked until all of these are true:

```text
CANONICAL_SYSTEM_RUNTIME_COMPLETE=YES
CANONICAL_RELEASE_TRUST_RESOLVED=YES
SIGNER_PRIVATE_TRUST_MATCH=PASS
RELEASE_ARTIFACT_IDENTITY=PASS
RELEASE_ENVELOPE_VERIFY=PASS
PUBLICATION_POLICY=PASS
```

The temporary CI system fixture is only a protocol fixture. It is not the OrdaX product runtime and must never be promoted as a user release.

## Intelligence SSOT in the Native release CI

The canonical release workflow now composes the pinned external Surface source and then the pinned external Intelligence source (eight exact Git blobs, including the technical inference builder) before Native assembly. The OS-owned reusable action `.github/actions/assemble-intelligence` invokes the existing source materializer and candidate composer, not a second package manager or updater. Both Native assemblies and their later verifications **require** `--require-external-intelligence`.

The ordinary deterministic `system.tar` test asserts full byte identity between independent builds; the tar contains the pinned Intelligence blobs, exactly five OS public-contract wrappers in place of their previous implementation bodies, and both source and Native provenance with inactive authorization. OS remains canonical for Identity, Account, Memory, Space, signatures, model selection, Supervisor and rollback.

**Not a physical product release:** this is release CI, while the source lock is still `integration-candidate`; the Owner/Dev Supervisor stage, Stable v4 image input and hardware/UEFI first boot are not yet switched over. The CI-only signing tests are not user-release signing authorization. No duplicated engine, updater, runtime grants, package publisher or Alpine dependencies are introduced.

## Portable EROFS candidate — same Intelligence source

The portable-v2 candidate pipeline now reuses the OS-owned Intelligence materializer **after** the Surface materializer. Its normalized `system.tar` includes the same eight source blobs pinned in `docs/contracts/intelligence-source.json`, replacing five old implementation bodies with public-contract wrappers only. CI verifies the lock, provenance, bytes and wrapper size before building and independently validating two bit-identical read-only `system.erofs` images. The Intelligence receipt is included in the metadata artifact.

This remains a **candidate-only** v2 image: activation and physical media authorization stay disabled. Stable v4 signed acquisition, Creator Owner/Dev Supervisor source staging, QEMU boot and physical USB tests require separate verification; a successful image build cannot imply those are complete.
