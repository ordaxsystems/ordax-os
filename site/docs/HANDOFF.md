# Site — corte definitivo

Autoridade única: ordaxsystems/ordax-os/main, módulo site/.

Verificação necessária:
1. O código, rotas, i18n, Conta e testes estão no mesmo SHA do OS.
2. O builder site/scripts/build.py produz bundle verificado com artefatos autorizados, sem clonar ordax-site.
3. Os entrypoints em site/api reexportam somente os módulos canônicos em api/ do OS.
4. O projeto Vercel existente prj_rEZck0dLNrLlSX9UhjifUzGiFpts preserva aliases, SSO, variáveis, OAuth, headers e proteção de publicação.
5. Em preview do mesmo projeto, validar funções, CSS/assets, Conta/login fail-closed, integridade do bundle e ausência de permissões/cadastros ativados.
6. No deployment de produção, confirmar githubRepo=ordax-os e githubCommitSha igual à revisão publicada da main.
7. Conferir branches, PRs, trabalho local e commits divergentes da origem antes de arquivar.

Se um gate estiver pendente, manter a publicação da origem antiga e registrar o impedimento sem criar segundo pipeline ou mudar secrets/domínios.

## Estado verificado — 21/11/2026

- Migração de código integrada por fast-forward à main do ordax-os em fe7538db6c4e6ac90ccb1a76cea8b1747b5a2b3d. Sem submódulo e sem checkout externo no builder.
- Projeto Vercel existente (não criar outro): ordax-site, ID prj_rEZck0dLNrLlSX9UhjifUzGiFpts, equipe team_E3bdE137ZG3fhCGMmYuGKJ8o. SSO de deploy habilitado.
- Publicação anterior em READY: dpl_G5T1k1fNZACT7wc23tee5mjofvFY, GitHub repo ordaxsystems/ordax-site, source SHA c6f215b25e1bfabf5763d65591208758ea5de44e. Ainda NÃO prova o novo source.
- Site build e verify, builder tools/vercel/build.py, smoke estático de 11 rotas, testes Python de Site/ownership/deploy e Node de Conta/MCP aprovados em checkout isolado. Browser end-to-end ainda não executado: ChromeDriver não instalado no host Windows.
- Bloqueio EXTERNO de preview/cutover: tentativa de deployment na API Vercel retornou HTTP 402 payment_required, code api-deployments-free-per-day, mais de 100 deployments do plano Hobby no dia, retryAfter 86400. Não tentar contornar cota criando projeto, pipeline ou produção paralela. CLI Vercel não está instalado/autenticado no host.
- Bloqueio de browser remoto OrdaX: product_project_scope_not_found; exige binding do projeto e dispositivo via Owner. Não altera autorização nem cria projeto por força.
- O projeto Vercel ainda aponta para o Git ordax-site, não para ordax-os; alteração de source NÃO realizada. Reapontar o mesmo projeto para ordaxsystems/ordax-os, Root Directory site e Include source files outside Root Directory, primeiro com preview validado, só então promover produção preservando domínios, SSO, variáveis e OAuth.
- Repositório antigo não arquivado: a publicação ainda está ligada a ele e foi detectada branch remota docs/site-close-dev-migration-and-clean-active-guidance-20261024 fora da main, além do commit local e1198e1 no checkout antigo (sua correção CSS de mobile já foi portada ao novo site/public/assets/landing.css). Nenhuma PR aberta na origem, conforme consulta GitHub.
- O contrato docs/contracts/public-site-source.json permanece com production_deployment_activated=false até existir prova real da revisão publicada do OS. Não marcar corte final antecipadamente.

- Dependências host: workspace npm site, único lock ordax-os/package-lock.json. Install Command exige cd .. && npm ci --workspace=site; manter a opção de incluir arquivos fora de Root Directory para api/ e lib/ do OS. Pré-flight de dependências reproduzido num workspace isolado no Windows.
