# Public site source

This directory owns the public OrdaX product portal. It is not the OrdaX Web product mode and it must not import the shared Surface runtime.

Routes:

- `/` — landing page;
- `/download/` — public release catalog;
- `/login/` — sign-in entry point;
- `/cadastro/` — account creation entry point;
- `/conta/` — account overview using verified identity/session, with availability of services and a Web entry.
- `https://web.ordax.com.br/` — canonical hosted product entry; the Web runtime owns its session and login. The legacy portal `/web/` redirects there in production; its presentation source is retained for local reference only.

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

## Fonte do playground após a extração

Este diretório é um **baseline histórico estático de desenvolvimento**; o código e a CI do Site foram integrados em [`ordax-site/main`](https://github.com/ordaxsystems/ordax-site), e a composição visual original pertence a [`ordax-surface/main`](https://github.com/ordaxsystems/ordax-surface). O contrato canônico de apps/atalhos continua no OS; `tools/public-site/playground_fixture.py --project-catalog <arquivo externo>` exporta seus dados sem modificar nenhum Site.

A renderização pública independente foi aprovada em [Surface #12](https://github.com/ordaxsystems/ordax-surface/pull/12) e o consumo de desenvolvimento em [Site #2](https://github.com/ordaxsystems/ordax-site/pull/2). O workflow antigo de **refresh/escrita de artefatos** foi removido para impedir que o OS gere novos arquivos concorrentes. Os scripts históricos `surface_snapshot.mjs` e `surface-snapshot-entry.tsx` permanecem congelados exclusivamente enquanto o bundle legado do OS verificar seus hashes; não constituem autoridade para novas builds do Site. Os assets estáticos históricos deste diretório não são SSOT nem devem ser regenerados ou distribuídos como uma release oficial da Surface.

**Não executar `surface_snapshot.mjs` nem `playground_fixture.py --write` para atualizar este Site legado.** Sua compatibilidade histórica será retirada no cutover restante do owner do Site; a UI pública nova não depende dela. Nenhuma mudança aqui autoriza deploy, DNS, Identity, USB ou Stable.

