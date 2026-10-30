# Bootstrap Release Channel Configuration

Status: CANONICAL PROTOTYPE INPUT — PHYSICAL USE STILL NOT AUTHORIZED

This owner contains the minimum bootstrap configuration needed to locate the first signed OrdaX release envelope.

Canonical source file:

```text
bootstrap/config/release-envelope-url
```

Canonical runtime path:

```text
/ordax/bootstrap/config/release-envelope-url
```

The file contains exactly one HTTPS URL:

```text
https://github.com/ordaxsystems/ordax-os/releases/latest/download/release-envelope.json
```

GitHub documents `/releases/latest/download/<asset>` as the direct download form for an asset on the latest release. This pointer selects the candidate delivery object only; it is **not** an authenticity authority. The downloaded envelope must still pass the local Ed25519 trust anchor, strict schema checks, repository pin, exact source-commit identity, artifact size checks and SHA-256 verification.

## Security boundary

- HTTPS is mandatory transport;
- the `latest` pointer may move only by publishing another GitHub Release;
- moving that pointer cannot make an unsigned or wrongly signed envelope acceptable;
- the release trust anchor remains independently pinned in `/ordax/bootstrap/trust/release-ed25519.json`;
- changing this URL is a source-controlled bootstrap policy change;
- no access token, credential or private signing material belongs in this file;
- physical write remains blocked while the release trust owner is unresolved and until the remaining promotion gates pass.


## Account gateway authority — single signed OrdaX OS source

Stable/MVP and Owner/Development use the same Native account transport. The
canonical endpoint is `system/services/account/gateway-base-url` in the
**exact verified OrdaX OS system tree**, selected by the release trust
mechanism in Stable or by the verified Git checkout in Dev.

The bootstrap does **not** accept
`/ordax/bootstrap/config/account-gateway-origin` as an identity authority.
An old copy of this optional bootstrap file, if present on the USB, is ignored
rather than being deleted or migrated: a removable-media configuration outside
the signed release must not override where account credentials are sent.
`ORDAX_ACCOUNT_GATEWAY_ORIGIN` is cleared before the Stable verified-release
handoff; the shared Surface entrypoint reads the source-controlled endpoint
from `ORDAX_SYSTEM_ROOT/services/account/gateway-base-url`.

A missing or invalid signed gateway disables online-account capability only.
It cannot block offline boot, the optional account choice in First Run, local
files, settings, notes, recovery or Intelligence. A live anonymous gateway
health check is **not** proof of an authenticated user. Registration, public
Auth cutover and recovery retain their independent legal/security gates.
Provider cookies remain in Native process memory only; writing them to a
removable USB is prohibited until the versioned encrypted-vault policy is met.
