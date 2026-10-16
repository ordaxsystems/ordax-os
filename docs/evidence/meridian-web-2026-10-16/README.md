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


## Main reconciliation and release preparation

The user authorized promotion to main/public replacement when validated. Reconciled
with `0d9832ed38bba21ac0c99a509c7a5464776aeaeb`, keeping current boot, CI,
Space composition and emulator basepath corrections. No experimental Meridian host
was merged. Historical reference hashes remain unchanged; the Web composition
adaptation records both its Meridian imports and the current emulator correction.

Local checks after reconciliation:

- Web regression: 96 passed, no failures or skips.
- Public Account/localization/session/legal regression: 42 Node tests passed.
- Public source, account entry UX, brand, hosting and Web builder: 52 Python tests passed.
- Web TypeScript and Vite production build passed (initial JS chunk 798.90 kB,
  226.09 kB gzip; size warning remains a performance follow-up).
- Canonical 34-reference verifier passed.
- Public site source/build/integrity verification passed as a local rehearsal;
  final deployment provenance must name the committed source, not this working-tree rehearsal.

The public UI tests were reconciled with the user-approved layout without relaxing
session, legal, native-form, no-fake-account or unsupported-action gates. The compact
More menu now excludes primary navigation routes. Added missing product-name locale
entries; unsupported account actions remain disabled and all planned sections remain.
The plan catalog tolerates an absent template without inventing plan availability.

Publishing limits: the canonical Vercel connector returned 403 for the configured
team/project; local GitHub CLI has no authenticated session and Vercel CLI is not
installed. Git remote access and the connected GitHub account remain usable. Public
product runtime launch is still disabled by its existing contract. The public site
builder packages the portal only, whereas the canonical Web bundle remains separate.
Enabling `/web/` requires composing that verified artifact at a separate same-origin
product path and proving the current strict CSP, including the shared mock styles.
No auth/recovery, payment, native device or physical release gate was enabled.


### CI review of PR #1859

The first remote run passed the public source/unit/build checks, Intelligence,
release-bundle tooling, native app-data binding and legal hash integrity. It exposed
these additional issues before main promotion:

- Native boot tests matched the exact opening HTML tag and rejected its additive
  Meridian attribute. Assertions now parse the language attribute while preserving
  neutral pre-JavaScript copy and boot readiness checks.
- Baseline policy tests still demanded dated physical-proof snapshots inside MVP.md,
  which current main has already replaced with the Launch Baseline policy. Exact
  release/physical values remain checked against CURRENT-STATE and their contracts;
  MVP policy and public USB availability are verified separately. These four suites
  pass locally: 36 tests.
- Public browser proof still expected the prior hero, three cards and management
  grid. It now verifies the current profile hero, four cards, aligned columns and
  all management destinations, retaining overflow, focus, keyboard, session and
  no-invented-data checks.
- The optional Lovable-source workflow referenced an absent sites/account-ui export
  whenever the unrelated public locale catalog changed. It now triggers only on
  its own export; Public Site Candidate continues to test the real shared catalog.

The English Surface audit still fails: 767 direct PT-BR literals in the newly shared
Meridian journeys/Space examples bypass the existing locale owner. This is an open
implementation issue, not an exemption to the audit. No mock was removed, no gate
was relaxed, and main/public replacement was not performed.

The canonical Web build recipe produced and verified the bundle for exact commit
`5bd4e9dad7f907348f183e6d213b5131c3c72b18`. Manual browser review of the public
bundle on local port 64615 confirmed its current hierarchy and unavailable-session
state under the real CSP. Automated local Chromium/Edge proof could not complete
because the disposable browser process failed on this Windows host; remote Linux
browser proof remains required. The public portal bundle does not contain the Web
application, and that independent packaging/strict-CSP gate remains open.


Manual responsive follow-up: the 390px public Account More menu contains exactly
its remaining destinations, with no primary navigation duplicates. Opening
Integrations closes the menu, focuses its H1 and produces no horizontal overflow.
The 1440px review also confirms the second overview column is a semantic aside,
and profile decoration is the source-pinned local image. Browser proof selectors
now reflect those actual elements while retaining alignment and decorative-alt checks.


## Shared Meridian localization closure

The previously reported direct PT-BR literals are now registered as 1,139 stable
message IDs in `system/services/i18n/catalog/meridian.mjs`, composed by the existing
Surface language owner. Localized factories keep one renderer/scenario definition
for Web and Native. Defaults remain pt-BR for the design reference. Web consumes
`regional.locale`; Native supplies its existing localization port's `getLocale`.
No global language cache, backend/provider, credential flow or new product was added.
Technical identities (Space/step/field/option IDs, volume names and time-zone values)
remain language independent. All planned scenarios and examples remain present.

Validation after the change:

- 101 Web/Meridian regressions pass, including five new localization regressions.
- 28 Surface/English/interpolation regressions pass, including the prior failing audit.
- New proof checks every scenario's steps, transitions, option IDs and confirmation
  gates in both languages, English rendering of more than 100 screens, escaped
  hostile Space names and locale/listener disposal without resurrection.
- TypeScript, production Web build and 34-reference provenance verification pass.
- Production initial JS is 902.37 kB (254.46 kB gzip); chunk-size warning retained.

The source audit was not exempted or weakened. The candidate workflows now run the
new regression. This closes the shared text-owner defect; it does not assert a public
Web runtime, live authenticated E2E or physical USB readiness. The earlier Web browser
proof also still expects pre-Meridian chrome and must be reconciled while retaining
its window, geometry, keyboard, service-gating and notification checks.
