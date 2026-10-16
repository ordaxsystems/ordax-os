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

## Local follow-up after f2e529a5

Remote English audit succeeds at `f2e529a5a9000c0cf63a549029633629a8cf2532`.
Public Site Candidate and Foundation Contract exposed a static-reader incompatibility:
the generated catalog exports were not literal tables. The local correction uses
the existing explicit `Object.freeze` table convention, preserving all 1,139 IDs
and both translations. Public source checks and 40 Python public/catalog/builder
tests now pass. All 101 Web/Meridian regressions and the 34-reference verifier pass.

Local UI corrections restore Central's manual sidebar mode through its existing
presentation owner, retain Settings appearance selector markers and label dock
restoration with the actual managed window title. No planned UI or mock was removed.
The existing browser regression now follows Meridian's global navigation and hero
while retaining window lifecycle, geometry, draft and service-gating checks.
Partial Chromium runs exposed the appearance marker and Aura restore-label defects
above. An automatic-review usage limit initially prevented the next run; it was
cleared on continuation. Visual review also caught the old absolute edge positioning
inherited by the collapse button; it now occupies its real auxiliary rail slot.

The final official Chromium run passes all seven viewports: 1440×900, 1024×768,
820×650, 760×650, 390×844, 320×568 and 844×390. Proof retains theme persistence,
stable app nodes/drafts, compact and desktop lifecycle/geometry, unavailable
notifications/AI and horizontal-fit assertions. Narrow screens explicitly verify
the global launcher replaces the hidden rail. The production Web build and
34-reference verifier pass after the CSS correction. Generated report/screenshots:
`out/meridian-web-current-browser/` (local output, not release provenance).

These follow-up corrections are saved with this evidence on the existing feature
branch, beyond the remote commit identified above. Main/public replacement and
production runtime packaging with strict-CSP proof remain pending. No physical USB
or authenticated E2E claim is made.

## Public-policy preparation

At `8ea37ae4abddf7143e659ba1234a34e39f1b34fc`, remote Surface Web Candidate,
Foundation Contract, Public Site Candidate and English localization all pass.
This does not prove the separately gated public Web runtime is available.

Store and Space examples now use constructed, root-scoped stylesheets with the
same bundled token/presentation CSS. This retains font asset processing and avoids
injecting inline style elements. The Store's five static spacing attributes were
moved to its existing stylesheet; runtime logo CSSOM and every mock/action remain.
20 targeted Store/Spaces tests, TypeScript, production build and reference
verification pass. Browser coverage now opens both presentations and checks their
adopted sheets and actual computed Meridian token under the active policy.

The official Web smoke accepts `--public-policy vercel.json` to read the real
global publication headers. It records policy violations and retained document
styles, and fails rather than accepting blocked resources. The strict run reaches
both styled examples and the complete first-viewport lifecycle, then fails on four
`style-src-elem`/`inline` violations. The retained document style is Sonner CSS
(14,916 characters; SHA-256
`4ad11a5feb1ee984bba6a8f3af330803429a5fdcc5ffccc086f4176407b97a96`).
Transient dependency styles also require investigation; the retained style alone
does not attribute every event. Local diagnostics live in
`out/meridian-web-public-policy/`. No policy/header was relaxed, no dependency
payload patched, and no public runtime enabled. This failing strict proof remains
an explicit publication blocker, separate from the normal Web regression.

After these changes the normal official Web regression passes again in all seven
viewports, including the new Store/Spaces scoped-style checks at 1440px. This normal
pass does not override the separate strict-policy failure above.

## Public-policy blocker closure

The previous strict-policy failure is superseded by the following verified change.
`tools/surface-web/dependency-styles.mjs` adapts only the delivery of CSS from the
locked Sonner 2.0.8 module and react-style-singleton 2.2.3 ES2015 singleton module
during production compilation. It does not modify node_modules, upstream component
APIs, toast contents, modal behavior or CSS. Sonner retains its exact stylesheet;
the modal singleton retains reference counting and removes only its own constructed
sheet. Existing document sheets are preserved. Unexpected input SHA-256 or missing
dependency coverage rejects the build and requires review, instead of silently
accepting changed upstream code. The adapter itself is in the canonical receipt's
source graph. Development/SSR transformations remain the normal Vite path.

Validation: four adapter integrity/lifecycle regressions and eight canonical builder
regressions pass; TypeScript, production build and 34-reference verification pass.
The official Chromium smoke passes all seven viewports with
`--public-policy vercel.json`, zero policy violations, and the original security
headers unchanged. This includes Store/Spaces computed styles, menus, focus,
window lifecycle, theme persistence, compact geometry and unavailable backends.
Current local report: `out/meridian-web-public-policy/report.json`; older blocked
style diagnostics in that directory are historical and do not describe this run.
The Surface Web Candidate workflow now requires the strict-policy smoke and
adapter regressions. Initial JS remains over the existing chunk-size warning
threshold (924.42 kB / 257.93 kB gzip); the warning was not suppressed.

This closes the source CSS/CSP defect, not public runtime hosting, authenticated
E2E or physical USB readiness. The portal remains a separate artifact, and no
runtime/config/provider gate has been activated by this change.

## Public deployment composition

The public deployment recipe now composes the two existing independently verified
artifacts at one origin: portal at `/`, Web at `/ordax/`. Web's builder accepts an
explicit same-origin mount path and records it in its manifest. The aggregate
requires both component commits to match, preserves their bytes/manifests, hashes
the complete output and records its recipe/config input hashes. Verification uses
the existing component verifiers; the portal verifier's accepted file set is not
widened. Corruption, unowned files, mismatched commits/mounts and reconstruction
path traversal have targeted regressions.

Local candidate `out/public-deployment-candidate-1` builds/verifies successfully.
Its local source stamp references parent `371df54b`; it contains working-tree
changes and is not an exact-commit release artifact. The mounted browser smoke
uses that real output at `/ordax/`, with the original global publication headers,
and passes all seven viewports without CSP violations. 44 targeted portal,
deployment, composition and Web-builder tests pass; the 34-reference verifier
passes. CI builds fresh exact-commit candidates, repeats the composition and
requires the mounted public-policy browser proof.

Vercel source configuration now selects `out/public-deployment`, installs the
locked dependencies with scripts disabled, and calls the composition recipe.
Existing account/API rewrites and security headers are retained; hashed Web assets
receive immutable caching and its entry document requires revalidation. The build
change filter now includes shared Web source. This is one app source, not a new
Web fork or another hosting project. `/web/`'s authenticated launch gate remains
unchanged. No production deployment has been observed or asserted; the contract's
`runtime_deployment_verified` remains false until remote verification.

Final packaging follow-up: candidates 4 and 5 reproduce all 57 output files byte
for byte, including the aggregate receipt. Their Web file records match the exact
runtime bytes exercised by the mounted candidate-1 browser run. Five composition
regressions pass after adding Windows drive/backslash, absolute, traversal and
reserved-component path rejection; the targeted builder/change-filter run also
passes (14 tests). GitHub Actions supply-chain verification passes. All workflows
for prior head `371df54b`, including strict-policy Surface Web Candidate and QEMU,
are green. These results do not assert the new composition's remote CI/deployment
has completed; fresh exact-commit evidence is required before promotion.

## Verified production deployment

PR #1859 was merged into main as `16d3fc2ed40abb417027a5b8731a7e2e59491f4d`
after Web, public deployment/portal and Foundation CI passed. The independent
QEMU workflow was still running at promotion; no physical USB readiness was inferred.
Vercel's GitHub commit status reports `Deployment has completed` for the canonical
ordaxsystems/ordax-os-public deployment. At 2026-10-16 14:25 UTC, anonymous HTTPS
reads confirmed the exact merge commit in the public aggregate manifest, HTTP 200
for `/` and `/ordax/`, all 56 component files' lengths/SHA-256, and the original
public CSP. The aggregate manifest is the 57th file; its own SHA-256 is recorded
in `production-proof.json`. This supersedes earlier pending-hosting observations.

The Vercel MCP connection returned 403 for the ordaxsystems scope and no Vercel CLI
was installed. Deployment completion was therefore checked through the official
Vercel GitHub status plus the actual public origin; no alternate project, scope,
proxy, credential or hosting was used. Account/provider gates and authenticated
`/web/` launch activation remain unchanged. Public runtime availability does not
prove authenticated E2E or hardware/USB behavior.
