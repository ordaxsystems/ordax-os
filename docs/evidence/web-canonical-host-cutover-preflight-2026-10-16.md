# OrdaX Web canonical host cutover preflight — 2026-10-16

## Scope

This evidence records the last safe state before moving the canonical OrdaX Web hostname from the public-site Vercel project to the dedicated OrdaX Web project.

It is intentionally a **preflight**, not a cutover receipt. The hostname must not be declared migrated until the project-domain move and the post-cutover HTTP/auth proofs succeed.

## Source state

Repository: `ordaxsystems/ordax-os`

Observed `main` HEAD during this preflight:

```text
5454b021730a62761c551b88c2281f23cac33b48
```

The split-project deployment implementation was introduced by:

```text
825dd9f1fdd85388e4a04e2b75af975ce0279861
refactor(web): deploy canonical Web at project root
```

The machine-readable owner is `docs/contracts/public-site-deployment.json`. At the observed HEAD it already records the old `/ordax/` single-origin composition as historical/superseded and declares the current Web topology with:

```text
project: ordax-web
project_id: prj_ftACluUqk6i9DoD9GPIwmgURwckP
canonical_origin: https://web.ordax.com.br
mount_path: /
domain_project_move_pending: true
domain_current_project: ordax-os-public
domain_target_project: ordax-web
```

## Canonical Vercel projects

Public site:

```text
team: ordaxsystems
project: ordax-os-public
project_id: prj_mA9ew6hOfjdqlBr1cC757iMLPQJC
canonical origin: https://ordax.com.br
```

OrdaX Web:

```text
team: ordaxsystems
project: ordax-web
project_id: prj_ftACluUqk6i9DoD9GPIwmgURwckP
canonical origin: https://web.ordax.com.br
```

No parallel replacement project is authorized for this cutover.

## Web artifact proof

The last production deployment that actually rebuilt the Web artifact after the split-project change is:

```text
deployment_id: dpl_6WmamtsjGUANiKciYXAtY23FdBFX
source_commit: 825dd9f1fdd85388e4a04e2b75af975ce0279861
state: READY
target: production
url: https://ordax-9b2kqkuh5-ordaxsystems.vercel.app
```

An authenticated Vercel fetch of `/` returned HTTP 200 and the root document contains:

```html
<title>OrdaX Web</title>
<script type="module" crossorigin src="/assets/index-aQgcWXtb.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-D_3SlxuV.css">
<div id="ordax-root"></div>
```

The document does not contain `/ordax/`. This proves the dedicated project artifact is built for the canonical root mount `/` rather than the superseded same-origin `/ordax/` mount.

Observed response protections included:

```text
Content-Security-Policy: default-src 'self'; ... frame-ancestors 'none'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cache-Control: no-cache, must-revalidate
```

## Ignored builds are not failures

Later `ordax-web` production records for commits `719153a1...` and `5454b021...` appear as `CANCELED` because `tools/vercel/should_skip_build.sh` returned exit code `0` for commits that do not change the Web deployment artifact.

The Vercel build event for deployment `dpl_4z5dyAtTNLzg75tBz53bydgxvXNX` explicitly reports:

```text
The deployment was canceled because the Ignored Build Step command returned exit code 0.
```

The GitHub combined status for `5454b021730a62761c551b88c2281f23cac33b48` reports both canonical Vercel checks as successful. The last applicable READY Web artifact therefore remains the production artifact above; the skipped builds are not treated as failed releases.

## Domain ownership before cutover

Vercel project-domain inspection confirms `web.ordax.com.br` is still a verified production domain of the **public-site** project:

```text
domain: web.ordax.com.br
project_id: prj_mA9ew6hOfjdqlBr1cC757iMLPQJC
verified: true
redirect: null
git_branch: null
```

The same domain is not yet present on `prj_ftACluUqk6i9DoD9GPIwmgURwckP`; querying it there returns `PROJECT_DOMAIN_NOT_FOUND`.

The current Vercel alias also resolves to the public project and deployment:

```text
alias: web.ordax.com.br
project_id: prj_mA9ew6hOfjdqlBr1cC757iMLPQJC
deployment_id: dpl_DjEKif72T7M61n6n8xP6wGPDDgZQ
deployment_url: ordax-os-public-r66a0wgwj-ordaxsystems.vercel.app
```

Cloudflare DNS already points `web.ordax.com.br` at Vercel. This cutover is therefore a Vercel **project-domain ownership move**, not a DNS migration.

## Independent public HTTP observation

A read-only probe from the authorized Windows device returned:

```text
https://ordax.com.br/
  status: 200
  title: OrdaX - ideias organizam realidades
  server: Vercel

https://ordax.com.br/web/
  status: 200
  title: OrdaX Web - acessar
  server: Vercel

https://web.ordax.com.br/
  status: 200
  title: OrdaX - ideias organizam realidades
  server: Vercel
```

The third result is the expected pre-cutover mismatch: the canonical Web hostname is live at the network layer but still serves the public portal because its Vercel project-domain binding has not yet moved.

## Required atomic operation

The supported Vercel REST operation for this topology is:

```http
POST /v1/projects/prj_mA9ew6hOfjdqlBr1cC757iMLPQJC/domains/web.ordax.com.br/move?teamId=team_E3bdE137ZG3fhCGMmYuGKJ8o
Content-Type: application/json

{"projectId":"prj_ftACluUqk6i9DoD9GPIwmgURwckP"}
```

This operation moves the **project-domain** inside the same canonical Vercel team. It is not equivalent to assigning a one-off deployment alias.

The connected Vercel MCP surface available during this preflight exposes project-domain reads and adds, but not the documented `/move` endpoint or project-domain removal. The PC has no authenticated Vercel CLI session, and no `VERCEL_TOKEN`-based administrative channel exists in the repository. No token, temporary proxy, disposable workflow, alternate domain, parallel project, DNS bypass, or broad cookie workaround was created.

## Post-cutover gates

After the atomic project-domain move, all of the following must be proven before clearing `domain_project_move_pending` or enabling the public Web entry contract:

1. `web.ordax.com.br` is absent from `ordax-os-public` and verified on `ordax-web`.
2. The Vercel alias/project-domain points to the current `ordax-web` production deployment.
3. `https://web.ordax.com.br/` returns the OrdaX Web root, not the public portal.
4. No `/ordax/` mount leaks into the Web document or its asset URLs.
5. TLS and the expected security headers remain valid on the canonical hostname.
6. `/auth/*`, `/sync/*` and authorized `/account/*` requests use the Web account-proxy boundary on the Web host.
7. Login bootstrap, refresh, logout/revocation and unauthenticated handling pass without tokens in long-lived URLs or browser storage.
8. `https://ordax.com.br/`, `https://ordax.com.br/web/` and the public Account/Identity surface remain unaffected.
9. Only after these proofs should `sites/public/config/public-site.json` move from fail-closed Web entry state to the authorized canonical Web origin.

Until then, the safe state remains fail-closed and the cutover is **not complete**.
