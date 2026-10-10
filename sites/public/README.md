# Public site source

This directory owns the public OrdaX product portal. It is not the OrdaX Web product mode and it must not import the shared Surface runtime.

Routes:

- `/` — landing page;
- `/download/` — public release catalog;
- `/login/` — sign-in entry point;
- `/cadastro/` — account creation entry point;
- `/conta/` — account overview using verified identity/session, with availability of services and a Web entry.
- `/conta-2/` — permanent compatibility redirect to `/conta/`, configured once in `vercel.json`; no second page or controller.
- `/web/` — product-entry page; authenticated launch is gated by approved destination configuration. The hosted product runtime remains disabled.

The baseline is dependency-free HTML/CSS/JavaScript. Runtime integration is configured by `config/public-site.json` and fails closed when identity or public release services are not authorized for public activation. The real account forms remain hidden and disabled until those gates pass. The public login and registration entry pages present a neutral loading state while the live gateway is consulted, show credential fields only after server readiness (and legal policy for registration) is verified, and suppress gated-only guidance when available. Neither the home-page registration link nor this presentation state is authority to create an account.

## Localization

The portal owns localization independently from the OrdaX Surface runtime. Its source/default locale is `pt-BR`; `en-US` is bundled as a complete first-class locale. The owner lives under `i18n/`:

- `i18n/catalog.js` owns message parity for PT-BR and en-US;
- `i18n/runtime.js` resolves the locale, updates `<html lang>`, metadata, accessibility text and visible copy, and exposes the explicit language selector;
- explicit selection is stored locally under `ordax.public.locale`;
- an unsupported or invalid locale falls back deterministically to `pt-BR`;
- the portal does not import the Surface localization runtime and does not fetch remote language resources.

The public routes stay canonical and language-neutral; do not duplicate the site into `/en` copies. `tests/test_public_site_localization.mjs` enforces exact key/placeholder parity, complete route and playground-fixture coverage, dynamic message ownership, and the no-remote-runtime rule.

Do not place secrets, privileged storage URLs, private release objects or provider service-role credentials in this tree. See `docs/PUBLIC-SITE.md`.


## Product distribution

This portal represents the **Stable/MVP** product distribution described in `MVP.md`.

Owner/Development remains an internal engineering profile. Public pages must not teach or depend on Git operations, branch names, pull requests or repository access. Public updates are presented as official OrdaX releases/channels, and the Creator is the normal public media-preparation path.

The portal may describe a capability only when its real owner/service exists or clearly mark it as not yet available.

## Playground fixture

The landing playground is a marketing demonstration, separate from OrdaX Web.
Its app labels, order and Home spaces are generated from the shared product
source into `assets/playground-fixture.json` and an inline copy in
`index.html`:

```bash
python tools/public-site/playground_fixture.py --write
python tools/public-site/build.py check
```

The fixture contains no account or user data. Playground edits stay anonymous
and in memory; the browser mirrors them across the illustrated devices to show
the intended continuity. Production synchronization still requires a real
identity and sync owner.

The route `/` is always the public landing page. The authenticated OrdaX/account experience must never replace the public root. OrdaX Web remains a separate product mode and is reached from an appropriate authenticated/product entry point rather than being rendered as the marketing homepage.

## MVP scope: USB-only

The public MVP prepares and boots OrdaX from removable USB media. It does not advertise or expose installation to internal SSD/NVMe/HDD. Native installation remains a post-MVP foundation.

Web, Mobile, synchronization, backup and cross-device continuity may be presented only as **Em breve** while unavailable. No billing, pricing, commercial tier names or device-count limits are defined at this stage.
