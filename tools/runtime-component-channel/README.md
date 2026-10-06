# OrdaX Runtime Component Channel

This tool owns the host-neutral signed boundary used to stage independently packaged OrdaX runtime components.

It is deliberately separate from the whole-OS release trust domain. Runtime component trust uses:

```text
prototype-ordax.runtime-component-trust/1
prototype-ordax.runtime-component-release/1
prototype-ordax.runtime-component-envelope/1
```

The package payload remains `prototype-ordax.runtime-component-package/1`.

## Security boundary

- Ed25519 and PKCS#8 use only the Go standard library.
- Private keys must live outside the repository and are never printed or packaged.
- CI may generate an ephemeral key only to prove the protocol.
- A signed envelope does not activate a component directly.
- Staging verifies the envelope, package SHA-256/size, embedded package-manifest digest, component identity/version/source commit, ZIP entry safety and every packaged file hash.
- Slots are materialized as read-only immutable directories.
- Staging does not change the active component, Component Manager state, or the Surface.
- Promotion remains blocked until the Native runtime can load a pending slot, observe runtime health, and atomically promote `current/previous`.
- Uninstall is an explicit activation-state transition. It requires the exact current identity and revision, rejects a pending candidate, re-verifies the signed current slot, then removes all installed activation references.
- Uninstall never deletes App Data, documents, Memory, Projects or other user state. User-data deletion is a separate product action owned by the relevant data owner.
- An immutable verified slot may remain as a local package cache after uninstall. Cache garbage collection is separate from installation state and must never make an app appear installed.

## Commands

```text
ordax-runtime-component-channel generate-key \
  --private-key <external>/runtime-component-private.pem \
  --trust <review>/runtime-component-trust.json \
  --key-id runtime-components-prototype-1

ordax-runtime-component-channel derive-trust \
  --private-key <external>/runtime-component-private.pem \
  --out <review>/runtime-component-trust.json \
  --key-id runtime-components-prototype-1

ordax-runtime-component-channel sign \
  --release runtime-component-release.json \
  --private-key <external>/runtime-component-private.pem \
  --trust runtime-component-trust.json \
  --key-id runtime-components-prototype-1 \
  --out runtime-component-envelope.json

ordax-runtime-component-channel verify-envelope \
  --envelope runtime-component-envelope.json \
  --trust runtime-component-trust.json

ordax-runtime-component-channel stage \
  --envelope runtime-component-envelope.json \
  --trust runtime-component-trust.json \
  --package internet.zip \
  --root /var/lib/ordax/components
```

The canonical component trust anchor is still unresolved until the explicit operator ceremony in `docs/COMPONENT-TRUST-CEREMONY.md` completes. The machine-readable policy is `docs/contracts/runtime-component-trust-policy.json`.

The fixed first key id is `ordax-runtime-components-v1`. Only the reviewed public anchor may eventually be pinned at `system/trust/runtime-components-ed25519.json`; the matching private key stays outside Git and outside the device.

Do not reuse or silently alias the whole-OS release key as component trust. Public-anchor pinning alone does not authorize publication or production activation.
