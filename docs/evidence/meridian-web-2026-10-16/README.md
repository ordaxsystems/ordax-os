# Web Meridian: account-backed Spaces and validation

Date: 2026-10-16 (America/Sao_Paulo)
Branch: `feat/store-meridian-layout`; base commit `b75dfddc32104163839ee0ad2595a17a88cfa946`.
Scope: the working-tree changes saved with this evidence; not main or a release.

## Initial Spaces increment validation

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


## Registration-policy follow-up

Base: `33115542c17facbdcf76c56899c308d5c91dcb23` on the same feature branch.
The regression command above additionally includes `tests/test_identity_actions.mjs`
and `tests/test_identity_credentials.mjs`. Result: 96 passed, 0 failed, 0 skipped.
TypeScript and the 34-reference verifier also pass. The existing historical source
hashes remain intact; reviewed adaptations cover Account presentation and composition.

New behavior: confirmed anonymous Web sessions read the existing canonical signup
policy with the bounded/cancellable same-origin reader. Already signed-in and
unconfigured sessions do not query it. The real Account window keeps signup visible,
with an explanatory disabled state until permitted. Registration navigation performs
a fresh policy check; it does not create an account or accept legal terms.

New tests cover enabled/revoked/invalid/unavailable policies, sign-in remaining usable,
request scope, offline/account-change/disposal cancellation and SSR button gating.
The same tests are registered in the existing candidate workflow. In the existing
4201 browser, sign-in/signup remain disabled with the actual unavailable gateway
state and red explanation. No actual signup, credential entry, live authentication,
production gateway configuration, deployment, build or main merge was performed.
