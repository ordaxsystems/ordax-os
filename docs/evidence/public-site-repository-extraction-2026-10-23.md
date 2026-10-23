# Registro transversal — extração do Site público (2026-10-23)

**Natureza:** evidência e handoff de migração; não substitui `docs/contracts/public-site.json`, `docs/PUBLIC-SITE.md` ou contratos de ownership do OrdaX OS.

## Autoridade e estado observado
- Origem atual: `sites/public/` + `tools/public-site/` em `ordaxsystems/ordax-os/main`; implementação **continua vigente até cutover atômico**.
- Destino candidato: [`ordaxsystems/ordax-site`](https://github.com/ordaxsystems/ordax-site) com [PR de extração #1](https://github.com/ordaxsystems/ordax-site/pull/1) em rascunho e branch `feat/site-independent-extraction`.
- Baseline original da extração: OS `70b0f7eb5d5085be0d4f176f5232def37c7a2a24`. Todo HTML/CSS/JS/i18n, 11 rotas e seis imagens transferidos. Os dois PNGs grandes tiveram a mesma blob SHA confirmada pelo workflow temporário [aqui](https://github.com/ordaxsystems/ordax-site/actions/runs/40038857924).
- Build do Site sem compilar kernel ou Surface; usa marca de um snapshot de migração OS imutável `artifacts/brand/os-migration-70b0f7eb/` com SHA256. Isso **não é** ainda pacote de marca oficial gerido pelo owner Surface; publicação/cutover seguem bloqueados.
- Independência do artefato candidato verificada em [CI Site](https://github.com/ordaxsystems/ordax-site/actions/runs/40039062149): compilação, testes de fonte/i18n e verificação de hashes. O CI não publica produção.
- Handoff e dependências vivos ficam em [`ordax-site/docs/HANDOFF.md`](https://github.com/ordaxsystems/ordax-site/blob/feat/site-independent-extraction/docs/HANDOFF.md) e [`docs/AUDIT.md`](https://github.com/ordaxsystems/ordax-site/blob/feat/site-independent-extraction/docs/AUDIT.md).

## Requisitos para um futuro cutover (NÃO executado nesta PR)
1. Exigir publicação do artefato versionado de identidade visual e do snapshot Meridian pelo owner `ordax-surface`; proibir import runtime de `system/surface` ou cópia de outra Surface.
2. Receber projeção oficial de catálogo comercial do owner de `entitlements` em vez de copiar contratos do OS; nunca ativar cobrança pela apresentação.
3. Provar paridade de rotas, SEO, acessibilidade/responsividade, sessão, login/cadastro/recuperação fail-closed, release catalog público autorizado e ausência de caminhos falsos de produto.
4. Inventariar todos os consumidores do portal antigo: workflows `public-site-*`, `tools/vercel/build.py`, `tools/public-site/deployment.py`, deploy proxy, Vercel, docs/contracts e testes. Repoint atômico: refs para o artifact SHA do Site, não checkout dinâmico da `main`; no mesmo cutover retirar só arquivos plenamente substituídos, com prova de paridade.
5. Reconciliar PRs de Surface, especialmente `#2195` (Supervisor staging) e patches Meridian `#2010`/`#1983`; não sobrescrever trabalho concorrente.
6. Adoção futura em produção, domínio e credenciais dependem de autorização explícita independente. Nenhuma mudança dessas foi feita.

Esta PR documental registra a fronteira para outros agentes. **Não** promove status de produto, reconfigura CI de OS, altera boot/Surface/USB nem remove `sites/public/` e `tools/public-site/`. Até a integração aprovada, o OS mantém o portal antigo como fonte efetiva.
