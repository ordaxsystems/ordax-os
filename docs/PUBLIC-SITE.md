# OrdaX Public Site

Status: FOUNDATION / NOT DEPLOYED / ACCOUNT-CLOUD MVP GATED

The public OrdaX site is a separate delivery surface from the OrdaX Web product mode.

The public portal presents the **Stable/MVP** distribution only. Owner/Development may use Git-first workflows internally, but Git, branches, pull requests and repository mechanics are not part of the normal public product experience. See `MVP.md`.

`OrdaX Web` is the shared OrdaX Surface rendered for a Web-capable host. The public site is the product portal that presents OrdaX, exposes public release downloads, and provides entry points for account creation, sign-in and account lifecycle.

## Repository boundary

The public portal stays in this repository while the product is still evolving quickly:

```text
sites/public/
  index.html
  download/index.html
  login/index.html
  cadastro/index.html
  recuperar/index.html
  recuperar/nova-senha/index.html
  conta/index.html
  licencas/index.html
  privacidade/index.html
  termos/index.html
  assets/
  config/public-site.json
```

It is built as the independent `public-site` artifact class. A site-only change must not rebuild the kernel, bootstrap, shared Surface or native release.

Keeping the portal in the monorepo does not make it part of the operating-system runtime. It has its own build recipe, candidate artifact and deployment boundary.

## Route ownership

- `/`: public landing page. It must never become the authenticated OrdaX workspace.
- `/download/`: public release discovery and verified download links.
- `/login/`: sign-in entry point.
- `/cadastro/`: account-creation entry point.
- `/recuperar/` and `/recuperar/nova-senha/`: recovery entry/completion surfaces; tokens remain server-owned and must not enter site JavaScript.
- `/conta/`: authenticated user area. Until real identity/session integration is enabled, it remains fail-closed and must not simulate user data.
- `/licencas/`: release-specific license, SBOM and source-compliance entry point.
- `/privacidade/`: privacy-readiness page; not a final policy while account activation is blocked.
- `/termos/`: terms-readiness page; not final terms while account activation is blocked.

The public landing and the authenticated product experience are deliberately separate:

```text
/               -> public product landing
/login/         -> authentication entry
/conta/         -> authenticated account area
OrdaX Web       -> product runtime reached from an appropriate authenticated/product entry point
```

The OrdaX Web Surface must not be mounted over `/`. The account area may expose profile, devices, session, synchronized preferences, export/close controls and product-entry actions only when their backing services are real. OrdaX Web remains a separate product mode from the marketing portal even when the account links to it.

Future routes such as support, docs and additional legal surfaces may be added here only when they have a real owner and service contract.

## Identity and account-cloud boundary

The browser pages do not implement an identity provider and must not store passwords, provider tokens or session secrets themselves.

The static site exposes a configurable same-origin handoff:

```text
public site
 -> /auth/* | /sync/* | /account/*
 -> OrdaX account gateway
 -> provider adapters / OrdaX domain services
```

The real identity backend and gateway exist, but public account activation remains gated. Login, registration and recovery forms are present only as gated source UI: controls remain unavailable until runtime config, legal-readiness, auth-hardening and the aggregate MVP account-cloud contract authorize activation. When enabled, the browser performs native same-origin requests; site JavaScript does not read credential values or provider tokens.

The identity service may use external infrastructure behind an OrdaX-owned service/adapter, but the browser contract does not couple product UI directly to that provider. Do not ship a fake form or local-only account database.

The machine-readable entry boundary is `docs/contracts/public-identity.json`. The aggregate MVP online gate is `docs/contracts/mvp-account-cloud.json`. They require one account model across product modes, forbid browser/service secrets and keep public account capabilities unavailable until their real owners and proofs are ready.

The server-side responsibility is under `services/public-identity/`. The dedicated Supabase project `ordax-control-plane` is the current backend adapter and the canonical product-domain schema under `infra/supabase/product/` is applied there. This prepares account/Spaces/entitlements/Profile Packs/Memory while public switches stay fail-closed. Supabase is an adapter, not the product-domain contract.

**Account/cloud is required to close the public MVP, but account is not required for download, boot or local/offline OrdaX use.** The required online slice includes account lifecycle, bounded sync, Cloud Memory account/Space and private user-selected cloud objects. It must not be advertised as available until its activation gates and real E2E proofs pass.

## Download boundary

The site never hard-codes a "latest" image or fabricates release availability.

The download page consumes the same-origin catalog at `/releases/catalog.json`. The public-site build generates that file deterministically from `platform/releases/publications.json`; the page does not manufacture release metadata.

The publication source is intentionally empty while `PRODUCTION_RELEASE_PUBLISHED=NO`. A release can enter it only with explicit per-release and per-target public authorization, exact source commit, artifact size and SHA-256. The generator rejects unknown fields, duplicate identities and non-same-origin download paths. See `docs/contracts/public-release-catalog.json`.

Minimum intended flow:

```text
source commit
 -> canonical build
 -> tests + provenance + SHA-256
 -> authorized public release
 -> public release catalog
 -> download page
```

When there is no authorized release, the generated catalog is valid but empty; the page says so and exposes no download button. A missing or malformed catalog still fails closed.

The user-facing MVP path is USB-only and does not require an online account:

```text
public landing
 -> /download/ (authorized OrdaX Creator download)
 -> Creator selects an authorized Stable/MVP release
 -> Creator verifies release trust and integrity
 -> user confirms the identified USB target, knowing its contents will be erased
 -> Creator prepares and verifies the USB
 -> user boots and runs OrdaX from USB
```

`/login/` and `/cadastro/` remain optional entry points for the user; they do not gate public downloads or first use. They are nevertheless required to work securely before the **public MVP is declared complete**. The Creator must not offer internal-disk installation or writing.

A public release must also pass the release-compliance gate in `docs/RELEASE-COMPLIANCE.md` and `docs/contracts/release-compliance.json`. Each listed release must expose an integrity-bound SBOM, third-party notices and release-specific source-compliance bundle before the Download or Licenças page can render it.

The Download presentation uses `assets/download.css` and the local conceptual hero artwork `assets/download-hero.png`. All headings, steps, warnings and release links remain semantic HTML. Availability is rendered exclusively through the existing catalog consumer; the illustration does not assert artifact signing, OS compatibility or publication. The layout includes USB erasure confirmation, optional account access and a link to release compliance.

The Login presentation uses `assets/login.css` and reuses the local titanium artwork only as atmosphere. The native POST form, same-origin identity owner and fail-closed availability remain controlled by runtime configuration; the presentation must never expose a credential field while that owner is gated.

The remaining account, recovery, compliance and legal routes share `assets/portal.css` for the graphite and titanium presentation. Their existing fail-closed states, catalog consumer and legal wording remain the source of truth.

The registration presentation follows the same fail-closed rule with `assets/cadastro.css`; password/legal guidance is part of the native form contract and does not create a browser-only account. **The server must independently validate the legal acceptance carried by the registration request; UI validation is never authority.**

## Security invariants

- no private keys, service-role keys, passwords or provider bearer tokens in `sites/public/`;
- no direct browser access to privileged release or user storage;
- identity, sync and account API routes are same-origin;
- state-changing routes require server CSRF/same-origin validation and rate limiting;
- session cookies are Secure/HttpOnly/SameSite and provider tokens do not enter page JavaScript;
- no remote JavaScript, CSS or font runtime dependencies in the baseline;
- client code never treats telemetry, plan claims, quota claims or local UI state as authorization;
- release SHA-256/provenance data is displayed from the release owner, not generated by the page;
- account, cloud and download availability fail closed.

## Visual direction

### Interactive landing demonstration

The landing includes an explicitly labeled, disposable marketing playground in `assets/playground.js` and `assets/playground.css`. It is not OrdaX Web and does not import or fork the product Surface. The default notebook and phone view is a conceptual Aurora project workspace.
Visitors can explore its overview, three fixed context documents and a clearly labeled, predefined Intelligence response, then add its suggestion to the fictional project plan. This is not inference, an actual project-management capability claim or a second product runtime. Surface Home remains explorable.

The playground's labels, app order and Home spaces come from the generated `assets/playground-fixture.json`. Run `python tools/public-site/playground_fixture.py --write` after changing the Surface app catalog or Home shell. `python tools/public-site/build.py check` validates that the committed JSON and the inline browser fixture are current; this keeps the public demonstration aligned with the product source without mounting the product runtime on the public site.

The fixture is used only to render a disposable, anonymous example. Note edits, a checklist and appearance changes are mirrored locally in either direction; file browsing reads fixed examples only. This demonstrates intended continuity, not production cloud sync.

There are no requests, account credentials, user-file access, persistence, analytics or external dependencies in this demonstration. Reload/reset discards edits. Device navigation remains independent. The notebook uses a fixed 1120 × 700 virtual desktop, scaled by its container with ResizeObserver; the phone uses its own 340 × 690 layout. Page breakpoints never turn the notebook into a phone.
A native modal provides a larger notebook, with horizontal scrolling on narrow screens, Escape dismissal and focus restoration. Device entrance motion respects prefers-reduced-motion. Recipe buttons open Home, Projects, Intelligence or Context in both devices while retaining the explicitly simulated continuity notice. Login, registration and download continue through existing fail-closed routes and owners.

Handoff: this is source implementation only, not deployment evidence. The dependency-free fixture, public-site check and public-site smoke tests validate the local artifact; production hosting and configured identity/release owners remain separate requirements. Do not promote the demonstration into a second product runtime or treat its fixtures as real user data.

The portal shares OrdaX brand language, not the desktop shell implementation:

- midnight graphite landing canvas with pearl text;
- titanium device frames, keyboard deck and trackpad;
- ice-blue landing accents; existing supporting pages keep their own palette;
- editorial display type with restrained sans-serif controls;
- architectural rules and negative space;
- responsive layout.

It must not copy the Surface desktop markup or make the marketing site look like a fake operating-system screenshot.

Public copy should explain user-facing product behavior: Creator, **USB execution**, apps, official updates, rollback/recovery and account availability. The MVP must not advertise internal-disk installation as available. Native installation may be described only as a future/post-MVP direction. Full Web/Mobile clients, sync outside the bounded MVP classes and advanced backup remain future work. The bounded account-cloud capability itself stays **indisponível** in public copy until all real gates pass; once promoted it is part of the MVP, not a post-MVP promise. Do not use the landing page to explain Owner/Development Git operations.

No public page may invent prices, billing values or commercial quotas before policy and unit economics exist. Structural plan IDs may exist internally for entitlement architecture but are not a public paid offer by themselves. The provisional two-private-Space default is an internal capacity foundation, not a finalized public cloud quota.

The approved titanium landing concept uses a local generated project artwork at `sites/public/assets/aurora-titanium.png`. Device frames and screens remain live HTML/CSS, with desktop project overview and adjacent illustrative Intelligence panel; the phone has a separate compact composition. No real inference is performed by the public demo.

## Build

```bash
python tools/public-site/build.py check
python tools/public-site/build.py build --source-commit <40-hex-sha> --out-dir out/public-site
python tools/public-site/build.py verify --out-dir out/public-site
```

The candidate workflow builds the site twice and compares outputs to protect deterministic packaging.

## Runtime preview and deployment boundary

`tools/public-site/preview_server.py` is a loopback-only development/test adapter for the built artifact. It serves the static portal and mounts the fail-closed public identity gateway under the same account origin so CI can exercise route boundaries without deploying provider credentials.

It refuses non-loopback binds and is **not** the production server.

Production hosting remains provider-neutral. A production-shaped Nginx adapter exists at `deploy/public-site/nginx.conf`: it serves the deterministic static artifact from loopback and forwards `/auth/*`, `/sync/*` and `/account/*` to the deployed OrdaX account gateway. A public HTTPS terminator must sit in front of that loopback listener, so browser requests remain same-origin and provider-specific CORS is not part of the product contract.

The adapter trusts real-IP forwarding only from its loopback TLS terminator, applies rate limits to credential/recovery/sensitive account mutations, keeps account/sync responses `no-store`, preserves account status codes and `Set-Cookie`, and applies the declared CSP, anti-framing, MIME-sniffing, referrer and permissions policies. The exact route/cache/header requirements are machine-readable in `docs/contracts/public-site-deployment.json`.

Source readiness is not deployment evidence: public account access remains disabled until this adapter (or an equivalent conforming host adapter) is actually deployed over HTTPS and every applicable activation gate passes.

## Legal readiness before live accounts

The public account entry points are gated by `docs/contracts/public-legal-readiness.json`, `docs/contracts/public-auth-hardening.json` and `docs/contracts/mvp-account-cloud.json`. While those contracts are not ready, `sites/public/config/public-site.json` must keep account activation unavailable. The build/gates fail on partial activation.

The readiness pages under `/privacidade/` and `/termos/` intentionally describe only the current prototype state. Final legal documents, immutable versions/hashes, HTTPS URLs and effective dates must be reviewed/published before this gate can move to ready. Registration also requires a server-authoritative immutable acceptance receipt bound to that active policy.

### Production deployment proof

After a conforming HTTPS origin is deployed, validate it without account credentials:

```bash
python tools/public-site/prove_deployment.py --origin https://example.invalid
```

The proof checks the public landing/cache/security headers, runtime config, anonymous `/auth/session`, fail-closed anonymous `/sync/snapshot`, fail-closed anonymous `/account/export`, recovery gate and real 404 behavior. A passing local build is not accepted as production deployment evidence.

### Public account activation preflight

Public identity is intentionally fail-closed. CI runs:

```bash
python tools/public-site/auth_activation_preflight.py check
```

The normal check accepts a coherently disabled account surface and prints every remaining blocker. It rejects partial activation immediately. The repository also carries an activation guard that forbids enabling Edge registration while request-bound legal acceptance validation is missing.

Before a real public rollout, operators must also run:

```bash
python tools/public-site/auth_activation_preflight.py require-ready
```

That stricter mode requires legal readiness, provider hardening evidence, same-origin deployment, real-IP rate limiting, recovery configuration, session-revocation/account lifecycle proofs, bounded sync/Memory proofs and the aggregate MVP online gates before the public account controls may be enabled together.
