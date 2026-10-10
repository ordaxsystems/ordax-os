# Produção web OrdaX — correção da origem canônica e Git deploy (10/10/2026)

## Provas da causa raiz

O único projeto oficial da Vercel foi confirmado pelo conector:
`ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`),
time `ordaxsystems` (`team_E3bdE137ZG3fhCGMmYuGKJ8o`),
Git `ordaxsystems/ordax-os`, branch `main`. Antes da correção,
os aliases `ordax.com.br` e `ordax-os-public-tau.vercel.app`
apontavam ao **mesmo deployment**
`dpl_CKMYa4U1W6MPFMWQXiDYgK26q9tR`, produção no
commit `38d4d44ff9cb1cc2afb3c10ff8296b2deef85776`.

No computador autorizado, a consulta HTTP sem cookies comprovou:

| Requisição | ordax.com.br | Alias Vercel |
| --- | --- | --- |
| GET `/conta/` | 200, HTML SHA-256 prefixo `25731e44b38b085` | 200, mesmo SHA |
| GET `/assets/account-portal.js` | 200, SHA prefixo `b7d8e96ada47acc` | 200, mesmo SHA |
| GET `/auth/session` | 200, JSON `no-store` | 421 |
| Cookies/sessão | escopo canônico host-only | não transferíveis |

O proxy `api/account-proxy.mjs` em produção recusa hosts cuja
`new URL(request.url).origin` difira de
`ORDAX_PUBLIC_ORIGIN=https://ordax.com.br`, com código
`public-origin-mismatch`. Esse controle é correto: aceitar alias como
origem de autenticação quebraria a fronteira de cookies e OIDC.

A Cloudflare dedicada `ordax os` tem a zona
`ordax.com.br` ativa; o apex publica A
`64.29.17.1` e `216.198.79.1` com `proxied=false`,
www usa CNAME Vercel sem proxy, e não há Worker route ou
page rule da zona. **Não há dois backends públicos nem um
Cloudflare Worker interceptando o tráfego.**

### Motivo de não haver deploy automático

`vercel.json` vinha com `git.deploymentEnabled=false`,
o que desabilita **todos** os deploys automáticos da conexão
Git, embora o time/projeto e domínio já estivessem corretos.
A produção dependia de deploys explicitamente disparados,
enquanto novos commits da `main` eram publicados separadamente.

## Correção no owner único

1. `vercel.json`: `git.deploymentEnabled=true`.
   Sem segundo projeto, pipeline ou domínio de autenticação.
2. `tools/public-site/should_skip_vercel_build.sh`: quando há
   histórico Git verificável, **produção e preview** só constroem
   ao mudar Site, API, dependências e seus contratos diretos.
   Histórico ausente/ambíguo sempre constrói, em fail-safe.
3. `vercel.json`: aliases públicos estáveis
   `ordax-os-public-tau.vercel.app`,
   `ordax-os-public-ordaxsystems.vercel.app` e
   `ordax-os-public-git-main-ordaxsystems.vercel.app`
   redirecionam 308 para `https://ordax.com.br/:path*`,
   preservando caminho e a origem única de login.
   Endereços imutáveis de preview continuam sujeitos ao
   Vercel Authentication/SSO do time.
4. Contrato `docs/contracts/public-site-deployment.json`
   atualiza apenas fatos verificados: Git deixou de ficar
   congelado e as variáveis de ambiente de produção e
   `ORDAX_PUBLIC_ORIGIN` foram observadas pelo conector.
   Flags de aprovação de produção OIDC/conta que não foram
   individualmente comprovadas permanecem bloqueadas.

## Critérios de aceitação

- Os testes novos `test_public_canonical_host_redirects.py`
  exigem hosts exatos, um destino HTTPS, redirecionamento apenas
  de hosts Vercel e mesmos rewrites canônicos de Account.
- Os testes existentes `test_public_site_deployment.py`
  confirmam Git deploy habilitado, filtro por fontes públicas,
  build ao alterar Site e fail-safe por histórico não disponível.
- `public-site-candidate.yml` deve validar ambos.
- A última prova exigida é um deploy **READY em production**
  contendo este commit, 308 nos três aliases e acesso
  `/auth/session` no domínio canônico.
- O teste de login autenticado não usa credenciais privadas;
  preserva a sessão do usuário e não gera login fictício.

Até a verificação de produção e dos aliases, mudanças em arquivos
do repositório não significam por si só deploy concluído.
