# Native Release Assembly

Status: CANONICAL BUILD RECIPE FOR THE NATIVE SYSTEM RELEASE — PUBLIC RELEASE STILL GATED

`tools/native-release-assembly/build.py` prepares the source tree consumed by the existing deterministic `tools/release-bundle` tool.

It does not replace the shared `system/` source and does not introduce a second release format.

```text
repository system/
 + immutable Creator source from docs/contracts/native-release-assembly.json#creator_source
 -> Native release assembly
 -> staged system/
      ├─ shared product source
      ├─ bin/ordax-native-install-targets
      ├─ bin/ordax-runtime-component-channel
      └─ .ordax/native-release-tools.json
 -> tools/release-bundle
 -> system.tar
 -> existing release manifest/signing/acquisition pipeline
```

## Security boundary

The injected helpers have separate responsibilities:

- `ordax-native-install-targets` is the **read-only target discovery and exact target-plan helper** required by the OrdaX USB installer. It has no Native physical APPLY implementation and no authorization to mutate a block device.
- `ordax-runtime-component-channel` verifies signed component releases/slots and owns the fail-closed component activation-state machine. It has no private signing key, no component publishing authority, and source presence alone does not enable slot serving.

The assembly recipe:

- cross-compiles the helper as `linux/amd64` with `CGO_ENABLED=0`;
- uses a clean exact-SHA, Git-tree-verified checkout of `ordaxsystems/ordax-creator` for the read-only Native targets helper and the OS-owned module `tools/runtime-component-channel`;
- emits the helpers at `system/bin/ordax-native-install-targets` and `system/bin/ordax-runtime-component-channel`;
- binds each helper's SHA-256, size, mode, role, source package and source commit into release-local provenance;
- refuses an output tree inside repository source;
- leaves final archive determinism to `tools/release-bundle`;
- leaves release identity and signature authority to the existing release manifest/signing pipeline.

No compiler or source checkout is required on the end-user OrdaX USB.

The OS Native assembler now requires `--creator-source <verified-checkout>` and rejects missing, mutable, dirty or mismatched Git source revisions. The exact repository, commit and tree are pinned **once** in the OS canonical `native-release-assembly.json` contract; the signed `system.tar` publisher remains OS-owned. The OS release CI obtains the exact Creator checkout read-only before both reproducibility assemblies. This change does not authorize physical media writes or remove remaining OS Creator publisher-source dependencies.
