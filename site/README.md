# OrdaX Site — módulo canônico do monorepo

**Única fonte de código:** [`ordaxsystems/ordax-os/main/site/`](https://github.com/ordaxsystems/ordax-os/tree/main/site).

- `site/public/`: páginas, estilos, imagens, internacionalização e assets públicos.
- `site/api/`: entradas Vercel que reexportam as implementações compartilhadas e únicas de `api/` e `lib/` no próprio `ordax-os`.
- `site/scripts/`, `site/contracts/`, `site/tests/`: build, contratos e verificações do módulo. Dependências via workspace npm e **único `package-lock.json` na raiz**.

## Publicação e ambientes

**Domínio público `ordax.com.br`:** servido pelo projeto Vercel existente `ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`), já conectado a `ordax-os/main`. O deployment READY `0bf86219` foi conferido contra `/public-site-manifest.json` e a origem do bundle é o mesmo commit do OS. `/auth/session` funciona para sessão anônima (HTTP 200); login real e rollout de recursos continuam sujeitos a gates independentes.

**Staging histórico `ordax-site`:** o projeto Vercel existente (`prj_rEZck0dLNrLlSX9UhjifUzGiFpts`) foi **pausado em 2026-11-22**; seus domínios `vercel.app` respondem `DEPLOYMENT_PAUSED`. O Git arquivado permanece apenas como vínculo histórico, sem ambiente ativo. Caso surja necessidade de homologação, reconectar o projeto existente a `ordax-os/main` (Root Directory na raiz do monorepo e origem/Identity próprias) **antes** de despausar. Não criar projeto adicional nem copiar credenciais de produção.

O repositório `ordaxsystems/ordax-site` contém apenas um aviso de migração e permanece arquivado: história preservada, **nenhum código ativo**.

## Build e validação

Na raiz `site/`:

```sh
python3 scripts/build.py check
python3 -m unittest discover -s tests -q
node --test tests/*.mjs
```

A configuração Vercel executável é exclusivamente `vercel.json` na raiz do OS; `tools/vercel/build.py` compõe o Site verificável e `tools/vercel/should_skip_build.sh` aplica o impacto canônico de `site/scripts/build_impact.py`. O `site/vercel.json` foi excluído junto ao encerramento do staging legado. Os artefatos DEV assinados de Marca e Surface são fixados exclusivamente por `contracts/dev-artifact-lock.json` (relativo a `site/`), sem cópias ou contratos antigos. `site/scripts/build_impact.py` ignora mudanças de outros módulos do OS, mas não ignora alterações nas APIs canônicas, contratos, dependências ou arquivos do Site; ausência de diff confiável força build. Não executar builds de kernel, QEMU, USB ou Creator por alterações do Site.

Para provas de produção, bloqueios e estados atuais, consultar [docs/HANDOFF.md](docs/HANDOFF.md). A política DEV única permanece em `ordax-os/docs/DEVELOPMENT-WORKFLOW.md`. Nunca habilitar recursos públicos ou grants apenas por existir um deployment READY.
