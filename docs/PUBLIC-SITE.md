# OrdaX Public Site

Status: PUBLIC SITE PREVIEW READY / PRODUCTION NOT DEPLOYED (2026-10-08)

The public OrdaX site is a separate delivery surface from the OrdaX Web product mode.

The public portal presents the **Stable/MVP** distribution only. Owner/Development may use Git-first workflows internally, but Git, branches, pull requests and repository mechanics are not part of the normal public product experience. See `MVP.md`.

`OrdaX Web` is the shared OrdaX Surface rendered for a Web-capable host. The public site is the product portal that presents OrdaX, exposes public release downloads, and provides entry points for account creation and sign-in.

## Repository boundary

The public portal stays in this repository while the product is still evolving quickly:

```text
sites/public/
  index.html
  download/index.html
  login/index.html
  cadastro/index.html
  licencas/index.html
  privacidade/index.html
  termos/index.html
  assets/
  config/public-site.json
```

It is built as the independent `public-site` artifact class. A site-only change must not rebuild the kernel, bootstrap, shared Surface or native release.

Keeping the portal in the monorepo does not make it part of the operating-system runtime. It has its own build recipe, candidate artifact and deployment boundary.

## Localization boundary

The public portal has its own localization owner under `sites/public/i18n/`; it does not import the OrdaX Surface localization runtime.

PT-BR is the source/default locale and en-US is a complete bundled locale for the public MVP. The two catalogs must have exact message-key parity and interpolation-placeholder parity. Locale resolution is deterministic: a valid persisted explicit choice wins, then a supported browser locale, then PT-BR. The explicit selector persists to `ordax.public.locale`; unsupported values fall back safely to PT-BR.

The same canonical routes serve both locales. Language selection changes presentation only: `<html lang>`, title/description metadata, visible copy, form labels/placeholders, status/empty/error messages, ARIA labels and the marketing playground follow the active locale. Identity availability, legal readiness, release authorization, same-origin policy and every fail-closed security decision are locale-independent.

No remote translation service, remote CSS or remote font is part of this boundary. The only remote JavaScript permitted is Cloudflare Turnstile, lazy-loaded exclusively for public login, registration and recovery abuse protection from the exact allowlisted `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` URL. Its browser token never grants access by itself: the same-origin server must validate it with Siteverify before forwarding the credential request. `tests/test_public_site_localization.mjs` is run by the Public Site Candidate workflow and rejects missing catalog coverage, key drift, placeholder drift, residual Portuguese in en-US and dynamic copy that escapes the locale owner.

The machine-readable invariant is recorded in `docs/contracts/public-site.json`.

## Route ownership

- `/`: public landing page. It must never become the authenticated OrdaX workspace.
- `/download/`: public release discovery and verified download links.
- `/login/`: sign-in entry point.
- `/cadastro/`: account-creation entry point.
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

The OrdaX Web Surface must not be mounted over `/`. The account area may expose profile, devices, session, synchronized preferences and product-entry actions only when their backing services are real. OrdaX Web remains a separate product mode from the marketing portal even when the account links to it.

Future routes such as support, docs and additional legal surfaces may be added here only when they have a real owner and service contract.

## Identity boundary

The browser pages do not implement an identity provider and must not store passwords, tokens or session secrets themselves.

The static site exposes a configurable same-origin handoff:

```text
public site
 -> configured identity route/service
 -> OrdaX identity/session owner
```

The real identity backend and gateway now exist, but public account activation remains gated. Login and registration forms are present only as disabled source UI: they stay hidden with disabled controls until the runtime config, legal-readiness contract and auth-hardening contract all authorize activation. When enabled, the browser performs a native POST to the same-origin OrdaX gateway; site JavaScript does not read credential values.

The identity service may use an external infrastructure provider behind an OrdaX-owned service/adapter, but the browser contract does not couple product UI directly to that provider. Do not ship a fake form or local-only account database.

The machine-readable entry boundary is `docs/contracts/public-identity.json`. It requires one account model across product modes, forbids browser/service secrets and keeps login/cadastro unavailable until a real same-origin identity route is configured.

Public credential entry points also use a dedicated Cloudflare Turnstile widget bound to the canonical production hostname. The sitekey is public configuration; the secret key is never stored in this repository or exposed to browser JavaScript. Login, registration and recovery requests are accepted by the server boundary only after Siteverify returns success for the exact hostname and action. Missing configuration, invalid/expired/replayed tokens, hostname/action mismatch or verification outage fail closed; the Turnstile token is removed before the request reaches the inner identity gateway.

The account service source remains owned by `services/public-identity/` and `infra/supabase/`. The destination Supabase project is `ordax-platform` (`jhfphsjptrpmtnzkpwud`), not the former `ordax-control-plane` destination. The internal `ordax-account-gateway` is deployed, but the new public Vercel-to-Supabase transport, named bridge credential, signed production OIDC, and end-to-end behavior remain unverified. Public login and registration stay disabled until same-origin deployment, legal-readiness and auth-hardening gates are proven. See `docs/contracts/public-auth-hardening.json` for the account owner's deployment observations.

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

`/login/` and `/cadastro/` remain optional entry points; they do not gate public downloads or first use. This follows the MVP's offline and no-account path. The Creator must not offer internal-disk installation or writing. The page must distinguish the Creator download from the OS release selected by the Creator, and must state that there is no public download while the catalog is empty.

A public release must also pass the release-compliance gate in `docs/RELEASE-COMPLIANCE.md` and `docs/contracts/release-compliance.json`. Each listed release must expose an integrity-bound SBOM, third-party notices and release-specific source-compliance bundle before the Download or Licenças page can render it.

The Download presentation uses `assets/download.css` and the local conceptual
hero artwork `assets/download-hero.png`. All headings, steps, warnings and release
links remain semantic HTML. Availability is rendered exclusively through the
existing catalog consumer; the illustration does not assert artifact signing,
OS compatibility or publication. The layout includes USB erasure confirmation,
optional account access and a link to release compliance.

The Login presentation uses `assets/login.css` and reuses the local titanium
artwork only as atmosphere. The native POST form, same-origin identity owner and
fail-closed availability remain controlled by the existing runtime configuration;
the presentation must never expose a credential field while that owner is gated.

The remaining account, recovery, compliance and legal routes share
`assets/portal.css` for the graphite and titanium presentation. Their existing
fail-closed states, catalog consumer and legal wording remain the source of
truth.

The registration presentation follows the same fail-closed rule with
`assets/cadastro.css`; its password guidance remains visible only as part of the
native form contract and does not create a browser-only account.

## Security invariants

- no private keys, service-role keys, passwords or bearer tokens in `sites/public/`;
- no direct browser access to privileged release storage;
- identity and download targets are same-origin by default;
- no remote CSS or font runtime dependencies; remote JavaScript is restricted to the exact Cloudflare Turnstile allowlist for account abuse protection;
- client code never treats telemetry as an account/control API;
- release SHA-256/provenance data is displayed from the release owner, not generated by the page;
- account and download availability fail closed.

## Visual direction

### Interactive landing demonstration

The landing includes an explicitly labeled, disposable marketing playground in
`assets/playground.js` and `assets/playground.css`. It is not OrdaX Web and does
not import or fork the product Surface. The default notebook and phone view is a conceptual Aurora project workspace.
Visitors can explore its overview, three fixed context documents and a clearly
labeled, predefined Intelligence response, then add its suggestion to the
fictional project plan. This is not inference, an actual project-management
capability claim or a second product runtime. Surface Home remains explorable.

The playground's labels, app order and Home spaces come from the generated
`assets/playground-fixture.json`. Run
`python tools/public-site/playground_fixture.py --write` after changing the
Surface app catalog or Home shell. `python tools/public-site/build.py check`
validates that the committed JSON and the inline browser fixture are current;
this keeps the public demonstration aligned with the product source without
mounting the product runtime on the public site.

The fixture is used only to render a disposable, anonymous example. Note edits,
a checklist and appearance changes are mirrored locally in either direction;
file browsing reads fixed examples only. This demonstrates intended continuity,
not production cloud sync.

There are no requests, account credentials, user-file access, persistence,
analytics or external dependencies in this demonstration. Reload/reset discards
edits. Device navigation remains independent. The notebook uses a fixed 1120 × 700
virtual desktop, scaled by its container with ResizeObserver; the phone uses its
own 340 × 690 layout. Page breakpoints never turn the notebook into a phone.
A native modal provides a larger notebook, with horizontal scrolling on narrow
screens, Escape dismissal and focus restoration. Device entrance motion respects
prefers-reduced-motion. Recipe buttons open Home, Projects, Intelligence or Context in
both devices while retaining the explicitly simulated continuity notice.
Login, registration and
download continue through the existing fail-closed routes and owners.

Handoff: the marketing demonstration is not evidence of product runtime or public account readiness. The protected Vercel preview proves the static public-site build, but a production HTTPS origin, configured identity route and authorized release publication remain separate requirements. Do not promote the demonstration into a second
product runtime or treat its fixtures as real user data.

The portal shares OrdaX brand language, not the desktop shell implementation:

- midnight graphite landing canvas with pearl text;
- titanium device frames, keyboard deck and trackpad;
- ice-blue landing accents; existing supporting pages keep their own palette;
- editorial display type with restrained sans-serif controls;
- architectural rules and negative space;
- responsive layout.

It must not copy the Surface desktop markup or make the marketing site look like a fake operating-system screenshot.

Public copy should explain user-facing product behavior: Creator, **USB execution**, apps, official updates, rollback/recovery and account availability. The MVP must not advertise internal-disk installation as available. Native installation may be described only as a future/post-MVP direction. Web, Mobile, synchronization, backup and cross-device continuity may appear only as **Em breve** while unavailable. Do not use the landing page to explain Owner/Development Git operations.

No public page may invent prices, billing, commercial tier names or device-count limits before those policies exist. The provisional two-private-Space architecture default is an internal capacity foundation, not a public commercial offer and must not be advertised as a finalized free-plan quota.

The approved titanium landing concept uses a local generated project artwork at
`sites/public/assets/aurora-titanium.png`. Device frames and screens remain live
HTML/CSS, with desktop project overview and adjacent illustrative Intelligence
panel; the phone has a separate compact composition. No real inference is
performed by the public demo.

## Build

```bash
python tools/public-site/build.py check
python tools/public-site/build.py build --source-commit <40-hex-sha> --out-dir out/public-site
python tools/public-site/build.py verify --out-dir out/public-site
```

The candidate workflow builds the site twice and compares outputs to protect deterministic packaging.


## Runtime preview and deployment boundary

### Canonical Vercel project and DNS cutover (2026-10-08)

The Vercel team is `ordaxsystems` (`team_E3bdE137ZG3fhCGMmYuGKJ8o`), with the **single** public-site project `ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`) linked to `ordaxsystems/ordax-os` on `main`. The project has a verified Vercel-assigned hostname (`ordax-os-public-tau.vercel.app`), **no production environment variables** and **no READY production deployment**. The protected preview `dpl_DiaSnV3d9tVCNoY5JkojYwpdRjRK` completed the `tools/public-site/build.py` check/build/verify sequence successfully; its artifact is `out/public-site`, including the generated release catalog. This is preview/build proof, not public OIDC runtime proof.

The historical `ordax-os-public.vercel.app` hostname is associated with a different Vercel team (verification returned 409). Never adopt that old team's OIDC identity, attempt an implicit transfer, or substitute the Vercel-assigned `-tau` hostname as production origin. The intended public domain is `ordax.com.br`, subject to an approved origin/identity cutover. At this observation date, the authoritative DNS zone for `ordax.com.br` is **active in the earlier Cloudflare account**, not in the new OrdaX Cloudflare account. Its apex, `www` and Vercel ownership TXT records already exist, as does the independent `catalogo-media` CNAME. Do not overwrite those records or swap nameservers from this site project.

Before any production deployment or DNS change:

1. Coordinate with the Cloudflare/DNS owner to inventory and migrate all required zone records and DNS verification **without changing public routing early**.
2. Resolve Vercel domain ownership with the existing owner and attach the approved final HTTPS domain to this exact project; validate certificates and routing. Do not modify another team's Vercel project.
3. Coordinate with the Account/Supabase owner to provision the **named** internal service credential and public gateway in the canonical destination, with fail-closed transport tests. Do not use a legacy `service_role` fallback.
4. Bind `ORDAX_PUBLIC_ORIGIN`, `ORDAX_ACCOUNT_GATEWAY_URL` and production-only OIDC issuer/audience/subject to the deployed project and exact origin; prove signed tokens, cookies, session/recovery boundaries and rate limits in runtime.
5. Rebind Cloudflare Turnstile to the verified production hostname and validate Siteverify; require final legal/provider gates before enabling account controls.
6. Run `tools/public-site/prove_deployment.py` against the **real** final HTTPS origin. Only after runtime evidence is recorded should the owner consider lifting the versioned `git.deploymentEnabled=false` freeze.

The authoritative machine-readable deployment and Account state live in `docs/contracts/public-site-deployment.json` and `docs/contracts/public-auth-hardening.json`. This paragraph is an operational explanation, not an independent SSOT.

`tools/public-site/preview_server.py` is a loopback-only development/test adapter for the built artifact. It serves the static portal and mounts the fail-closed public identity gateway under the same `/auth/*` origin so CI can exercise the complete route boundary without deploying a provider.

It refuses non-loopback binds and is **not** the production server.

Production hosting remains provider-neutral. A production-shaped Nginx adapter now exists at `deploy/public-site/nginx.conf`: it serves the deterministic static artifact from loopback and forwards only `/auth/*` and `/sync/*` to the deployed OrdaX account gateway. A public HTTPS terminator must sit in front of that loopback listener, so browser requests remain same-origin and provider-specific CORS is not part of the product contract.

The required route shape, cache policy and security headers are machine-readable in `docs/contracts/public-site-deployment.json`. The adapter preserves account status codes and `Set-Cookie`, applies the declared CSP, anti-framing, MIME-sniffing, referrer and permissions policies, and keeps account/sync responses `no-store`. Source readiness is not deployment evidence: public login remains disabled until this adapter (or an equivalent conforming host adapter) is actually deployed over HTTPS.


## Legal readiness before live accounts

The public account entry points are also gated by `docs/contracts/public-legal-readiness.json`. While that contract is not ready, `sites/public/config/public-site.json` must keep both login and registration targets null. The build fails if someone tries to enable them early.

The readiness pages under `/privacidade/` and `/termos/` intentionally describe only the current prototype state. Final legal documents, versions and effective dates must be reviewed and published before this gate can move to ready.


### Production deployment proof

After a conforming HTTPS origin is deployed, validate it without account
credentials:

```bash
python tools/public-site/prove_deployment.py --origin https://example.invalid
```

The proof checks the public landing/cache/security headers, runtime config,
anonymous `/auth/session`, fail-closed anonymous `/sync/snapshot`, and real
404 behavior. A passing local build is not accepted as production deployment
evidence.


### Public account activation preflight

Public identity is intentionally fail-closed. CI runs:

```bash
python tools/public-site/auth_activation_preflight.py check
```

The normal check accepts a coherently disabled account surface and prints every
remaining blocker. It rejects partial activation immediately. Before a real
public rollout, operators must also run:

```bash
python tools/public-site/auth_activation_preflight.py require-ready
```

That stricter mode requires legal readiness, provider hardening evidence,
same-origin deployment, real-IP rate limiting, recovery configuration and
end-to-end proofs before the public account controls may be enabled together.
