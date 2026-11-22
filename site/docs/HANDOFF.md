# Site — corte definitivo

Autoridade única: ordaxsystems/ordax-os/main, módulo site/.

Verificação necessária:
1. O código, rotas, i18n, Conta e testes estão no mesmo SHA do OS.
2. O builder site/scripts/build.py produz bundle verificado com artefatos autorizados, sem clonar ordax-site.
3. Os entrypoints em site/api reexportam somente os módulos canônicos em api/ do OS.
4. O projeto Vercel existente prj_rEZck0dLNrLlSX9UhjifUzGiFpts preserva aliases, SSO, variáveis, OAuth, headers e proteção de publicação.
5. Em preview do mesmo projeto, validar funções, CSS/assets, Conta/login fail-closed, integridade do bundle e ausência de permissões/cadastros ativados.
6. No deployment de produção, confirmar githubRepo=ordax-os e githubCommitSha igual à revisão publicada da main.
7. Repositório de origem já encerrado: ambas as branches ativas têm apenas README e o GitHub marca ordax-site como arquivado. A promoção Git/Vercel permanece um gate independente.

Se um gate estiver pendente, preservar o último deployment de produção já publicado, sem promover nova revisão, sem criar outro projeto/pipeline e sem alterar secrets ou domínios.

## Estado verificado — 21/11/2026

- Migração de código integrada por fast-forward à main do ordax-os em fe7538db6c4e6ac90ccb1a76cea8b1747b5a2b3d. Sem submódulo e sem checkout externo no builder.
- Projeto Vercel existente (não criar outro): ordax-site, ID prj_rEZck0dLNrLlSX9UhjifUzGiFpts, equipe team_E3bdE137ZG3fhCGMmYuGKJ8o. SSO de deploy habilitado.
- Publicação anterior em READY: dpl_G5T1k1fNZACT7wc23tee5mjofvFY, GitHub repo ordaxsystems/ordax-site, source SHA c6f215b25e1bfabf5763d65591208758ea5de44e. Ainda NÃO prova o novo source.
- Site build e verify, builder tools/vercel/build.py, smoke estático de 11 rotas, testes Python de Site/ownership/deploy e Node de Conta/MCP aprovados em checkout isolado. Browser end-to-end ainda não executado: ChromeDriver não instalado no host Windows.
- Limite de deploy: a tentativa inicial retornou HTTP 402 no plano Hobby, mas novo preview no MESMO projeto foi autorizado e concluiu READY mais tarde em 21/11/2026. Não criar projeto, pipeline nem origem paralela. A publicação de produção ainda não foi promovida.
- Bloqueio de browser remoto OrdaX: product_project_scope_not_found; exige binding do projeto e dispositivo via Owner. Não altera autorização nem cria projeto por força.
- O projeto Vercel ainda aponta para o Git histórico `ordax-site`, não para `ordax-os`; alteração de source NÃO realizada. Foi aplicada no projeto existente a configuração transitória `commandForIgnoringBuildStep="exit 0"` para impedir builds por commits de limpeza da origem. Reconectar o projeto a `ordaxsystems/ordax-os`, Root Directory `site`, Include source files outside Root Directory e **remover a supressão** ao validar o novo fluxo Git; só então promover produção preservando domínios, SSO, variáveis e OAuth.
- Repositório de origem **limpo e arquivado** em 21/11/2026 por decisão posterior do owner: árvore da main em `2369a0511bdcd7726db2a69150de8334755e183e`, árvore da branch documental em `f26f231b05b79b5c8d3edd0981c6e029f103fc58`, ambas contendo somente `README.md`. O commit histórico de produção `c6f215b` permanece recuperável via Git, mas não é HEAD editável nem SSOT.
- O contrato docs/contracts/public-site-source.json permanece com production_deployment_activated=false até existir prova real da revisão publicada do OS. Não marcar corte final antecipadamente.

- Dependências host: workspace npm site, único lock ordax-os/package-lock.json. Install Command exige cd .. && npm ci --workspace=site; manter a opção de incluir arquivos fora de Root Directory para api/ e lib/ do OS. Pré-flight de dependências reproduzido num workspace isolado no Windows.


## Validação CI do módulo consolidado — 21/11/2026

Na revisão b197477e7abc2b23925e5d2ddb1a2d4c900eed26 da main do ordax-os, a execução https://github.com/ordaxsystems/ordax-os/actions/runs/44956556125 terminou SUCCESS em ambos os jobs: public-gateway (Node 24, npm workspace, testes do Site e da Identity canônica) e independent-site-consumer (bundle real e 11 rotas estáticas). A execução anterior 44956412000 falhou apenas por uma asserção antiga de test_external_site_source no teste do OS, retirada por exigência de fonte única; ela foi corrigida, não recriada.

A ligação Git automática do projeto Vercel permanece ordaxsystems/ordax-site, e a produção READY aponta ao SHA c6f215b25e1bfabf5763d65591208758ea5de44e. O bloqueio da cota inicial foi superado por um preview do OS verificado posteriormente; isso não altera a origem Git nem comprova a promoção em produção.

O workflow de Site agora ignora alterações exclusivamente de site/docs/ e site/README.md, mantendo os testes ligados a alterações de código, configs, contratos e scripts. Não iniciar compilação do Site por documentação.

## Preview real do monorepo — 21/11/2026

Projeto Vercel existente `prj_rEZck0dLNrLlSX9UhjifUzGiFpts` aceitou deployment PREVIEW `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr`, `READY`, fonte `ordaxsystems/ordax-os/main` no SHA `bcd355bab778edfb2d5583030c41420b0f2bd205`, Root Directory `site`, inclusão de código fora da raiz e Node 24, sem trocar os aliases ou promover a produção antiga. URL imutável protegida: https://ordax-site-fgap89ovh-ordaxsystems.vercel.app/ .

Provas de build no log Vercel: clone de `ordax-os`, `npm ci --workspace=site` a partir da raiz (`25 packages`), `SITE_BUNDLE_VERIFY=PASS`, `Build Completed`, `Deployment completed`. O workflow canônico no GitHub seguiu aprovado no commit `ada911165e27dd68ccfe7eaad1b2248d1529b73c`, execução 44956684232, jobs `public-gateway` e `independent-site-consumer` SUCCESS. Não foram executados kernel, USB, Creator ou QEMU.

HTTP real via integração Vercel autenticada: 11/11 rotas públicas do contrato (`/`, `/download/`, `/login/`, `/cadastro/`, `/recuperar/`, `/recuperar/nova-senha/`, `/conta/`, `/licencas/`, `/privacidade/`, `/termos/`, `/web/`) retornaram 200. `/assets/landing.css` retornou 200; `/oauth/consent` sem ID retornou 400 e com ID de teste retornou 200 sem concessão de grant; `/releases/catalog.json` retornou 200, status `empty`. Headers CSP e `X-Robots-Tag: noindex` foram confirmados. O acesso compartilhável temporário usado pelo leitor autenticado foi revogado após os testes, sem regeneração; SSO permanece habilitado no projeto.

**Gate de Conta pendente:** GET `/auth/session` e `/auth/login` no preview retornaram `503 public-origin-unconfigured` como fail-closed. O Vercel lista somente variáveis públicas de OAuth nos alvos preview/production, enquanto o proxy canônico exige `ORDAX_PUBLIC_ORIGIN` e `ORDAX_ACCOUNT_GATEWAY_URL` válidos, com OIDC e proteção anti-bot. Não ativar/copiá-las nem simular E2E sem origem e autorização comprovadas. Não declarar login homologado.

**Gate de corte final pendente:** trocar a ligação Git do MESMO projeto em **Vercel → ordax-site → Settings → Git → Connected Git Repository** de `ordaxsystems/ordax-site` para `ordaxsystems/ordax-os`, mantendo Settings → Build and Deployment → Root Directory `site` com **Include source files outside Root Directory**. A API conectada permite deploys do SHA, mas não fornece operação de reconexão Git; não criar outro projeto. Após a reconexão, remover `commandForIgnoringBuildStep="exit 0"`, conferir deployment da main do OS, variáveis/segredos no ambiente autorizado, identidade/OAuth, rota `/auth/session`, proteção SSO e aliases antes de promover produção. A branch documental da origem já foi esvaziada e o repositório já foi arquivado; não restaurar source. Enquanto isso, `production_deployment_activated=false` permanece correto.

## Paridade com produção anterior — 21/11/2026

Comparação HTTP real, somente leitura, entre o preview `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr` (OS) e o deployment de produção anterior `dpl_G5T1k1fNZACT7wc23tee5mjofvFY` (`ordax-site`): ambos retornaram HTTP 200 em `/` e `/login/`, HTTP 200 em `/oauth/consent?authorization_id=preview-check` (sem grant) e HTTP 200 com `status=empty` em `/releases/catalog.json`. Ambos retornaram HTTP 503 com a mesma resposta JSON `public-origin-unconfigured` em `/auth/session` e `/auth/login`. Esse 503 é limitação **preexistente** das configurações públicas de Conta; não representa regressão introduzida pela migração. Não inferir login operacional nem alterar grants, secrets, SSO ou políticas de cadastro. Os compartilhamentos temporários usados para consultar os dois deployments foram revogados sem regeneração.

A alteração restante é administrativa no mesmo projeto Vercel: vínculo Git `ordax-site` → `ordax-os`, Root Directory `site`, arquivos externos à raiz habilitados e desativação do Ignore Build Step transitório (`exit 0`). Como o conector não disponibiliza reconexão Git, realizar em Settings → Git sem criar novo projeto. **A origem está arquivada; manter a produção existente e não promover revisão nova** até o deployment automático da main do OS e os gates de Conta estarem aprovados.

## Encerramento real da origem histórica — 21/11/2026

Por instrução expressa do owner, `ordaxsystems/ordax-site` foi reduzido a uma árvore de **um único `README.md`**. A migração retirou 88 arquivos da `main` em commit fast-forward `2369a0511bdcd7726db2a69150de8334755e183e` (sem force-push); a branch documental divergente recebeu o mesmo tree em `f26f231b05b79b5c8d3edd0981c6e029f103fc58`. A API GitHub confirmou `archived=true`. Histórico de commits e blobs anteriores continua navegável, mas não existe fonte ativa naquele repositório. Não importar/rematerializar a árvore antiga.

O projeto Vercel permaneceu o mesmo `prj_rEZck0dLNrLlSX9UhjifUzGiFpts`; o último deployment de produção observado após a limpeza seguiu `dpl_G5T1k1fNZACT7wc23tee5mjofvFY`, `READY`, commit histórico `c6f215b`, e o preview do monorepo `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr` manteve `READY`. O Ignore Build Step transitório `exit 0` evita a criação de um build vazio a partir da conexão Git antiga; **não pode permanecer habilitado** no projeto após a mudança da conexão para `ordax-os` se a publicação automática deve funcionar. O gate de autenticação (503 preexistente) e a promoção de produção continuam pendentes.
