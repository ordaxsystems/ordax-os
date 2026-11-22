# OrdaX Site — módulo canônico do monorepo

**Única fonte de código:** [`ordaxsystems/ordax-os/main/site/`](https://github.com/ordaxsystems/ordax-os/tree/main/site).

- `site/public/`: páginas, estilos, imagens, internacionalização e assets públicos.
- `site/api/`: entradas Vercel que reexportam as implementações compartilhadas e únicas de `api/` e `lib/` no próprio `ordax-os`.
- `site/scripts/`, `site/contracts/`, `site/tests/`: build, contratos e verificações do módulo. Dependências via workspace npm e **único `package-lock.json` na raiz**.

## Publicação e ambientes

**Domínio público `ordax.com.br`:** servido pelo projeto Vercel existente `ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`), já conectado a `ordax-os/main`. O deployment READY `0bf86219` foi conferido contra `/public-site-manifest.json` e a origem do bundle é o mesmo commit do OS. `/auth/session` funciona para sessão anônima (HTTP 200); login real e rollout de recursos continuam sujeitos a gates independentes.

**Staging `ordax-site`:** projeto Vercel existente `prj_rEZck0dLNrLlSX9UhjifUzGiFpts`, com SSO e domínios `vercel.app`, ainda conectado à origem histórica arquivada. O preview `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr` já construiu o módulo do monorepo. Caso esse staging continue necessário, conectar o Git a `ordax-os/main`, Root Directory `site`, incluindo arquivos fora da raiz. Não criar novo projeto, duplicar o backend ou copiar credenciais de produção para o staging.

O repositório `ordaxsystems/ordax-site` contém apenas um aviso de migração e permanece arquivado: história preservada, **nenhum código ativo**.

## Build e validação

Na raiz `site/`:

```sh
python3 scripts/build.py check
python3 -m unittest discover -s tests -q
node --test tests/*.mjs
```

`site/vercel.json` define o build verificável e as políticas de roteamento e segurança. `site/scripts/build_impact.py` ignora mudanças de outros módulos do OS, mas não ignora alterações nas APIs canônicas, contratos, dependências ou arquivos do Site; ausência de diff confiável força build. Não executar builds de kernel, QEMU, USB ou Creator por alterações do Site.

Para provas de produção, bloqueios e estados atuais, consultar [docs/HANDOFF.md](docs/HANDOFF.md). A política DEV única permanece em `ordax-os/docs/DEVELOPMENT-WORKFLOW.md`. Nunca habilitar recursos públicos ou grants apenas por existir um deployment READY.
