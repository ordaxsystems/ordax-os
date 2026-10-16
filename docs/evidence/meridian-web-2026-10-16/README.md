# Web Meridian: account-backed Spaces and validation

Date: 2026-10-16 (America/Sao_Paulo)
Branch: `feat/store-meridian-layout`; base commit `b75dfddc32104163839ee0ad2595a17a88cfa946`.
Scope: the working-tree changes saved with this evidence; not main or a release.

## Validation executed

- `npm.cmd run typecheck --workspace tools/surface-web`: exit 0.
- `node --experimental-strip-types tools/surface-web/checks/verify.mjs`: exit 0,
  34 reference files/assets plus lifecycle/geometry/canonical AI boundary checks.
- The following targeted command: 72 passed, 0 failed, 0 skipped. Final run has no
  HMR port conflict or unresolved-alias scanning warning.

```sh
node --test --experimental-strip-types tests/test_web_account_session.mjs tests/test_web_identity_capability_refresh.mjs tests/test_web_json_read.mjs tests/test_space_selection.mjs tests/test_web_store_catalog.mjs tests/test_meridian_navigation.mjs tests/test_web_central_windows.mjs tests/test_web_profile_catalog.mjs tests/test_web_meridian_spaces.mjs tests/test_store_preview.mjs
```

The initial reference verification detected stale adaptation digests for the current
desktop and Web composition. After reviewing those existing changes, their adapted
digests/descriptions were reconciled without changing historical source hashes,
assertions or gates. Four SSR test servers disable HMR/WebSocket binding; Profile
catalog tests also disable unrelated frontend dependency discovery.

## New regression coverage

Real-account default while complete examples remain reachable; validated and escaped
Space fields; disabled archived Spaces; selected-banner ownership; sign-out clearing;
failed reads distinct from successful empty catalogs; offline invalidation. Tests
exercise actual account/session and selection services with an isolated mock HTTP
transport. They do not authenticate a real account or authorize device operations.

## Existing-browser review

Port 4201: real Spaces reports the actual unavailable account state, offers account
navigation, and toggles to/from complete fictional examples (Achegue-se, Bella Napoli,
and other preserved cards). The Central ecosystem entry opens the canonical Profile
catalog, showing Impressão 3D and Pizzaria. Intelligence and integration notes display
explicit pending text. Browser screenshot review confirmed the desktop layout.

## Integration boundaries

| Feature | Implemented presentation/connection | Still pending |
| --- | --- | --- |
| Account | Existing same-origin session and sign-in/out ports | Configured live gateway on this preview origin |
| Spaces | Existing authorized account catalog, real cards and session selection | Live gateway E2E; rich metrics/covers/activity/templates/creation parity |
| Profiles | Existing validated bundled catalog, now reachable from Central ecosystem | Activation/provisioning in Web |
| Preferences | Existing browser preference owner retained | Account/device synchronization |
| Intelligence | Canonical client snapshot drives availability | Supported Web inference transport/provider composition |
| Store | Existing official catalog boundary and full examples retained | Web transport and authorized operations |
| Projects/files/devices/activity/continuity | Complete planned UI and pending explanations retained | Authorized compatible Web transports and relevant owners |

No production build, installation, deployment, main merge, USB image generation,
physical device operation or successful authenticated-gateway E2E is claimed.
