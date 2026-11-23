# Site — estado canônico de produção e staging

**Fonte única:** `ordaxsystems/ordax-os/main`, módulo `site/`. Os arquivos públicos estão em `site/public/`; os adaptadores `site/api/` reexportam somente `api/` e `lib/` do mesmo commit. Não clonar, copiar ou reconstruir `ordax-site`.

## Produção pública — evidência real

- **Projeto Vercel de produção:** `ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`), conectado diretamente a `ordaxsystems/ordax-os`, branch `main`.
- **Domínios:** `ordax.com.br` verificado; `www.ordax.com.br` redireciona para o domínio principal. Esse projeto é diferente do staging `ordax-site`.
- **Autoridade de produção em tempo real:** consultar a versão `READY` associada ao domínio `ordax.com.br` no projeto Vercel existente e confirmar por HTTP 200 o `source_commit` e a classe `public-site` de [`/public-site-manifest.json`](https://ordax.com.br/public-site-manifest.json). Não registrar um SHA histórico como se fosse permanentemente a revisão atual da produção. O primeiro cutover foi comprovado em `dpl_GT8hoGeM7X2gzP56gG1zDHMwNXdR` (`0bf86219`); outra prova posterior ocorreu em `dpl_28Yj3saZ42WUUCVpB63tEnfFCNf9` (`ed7ad0c`). Estes são **recibos históricos**, não ponteiros mutáveis de produção.
- **HTTP público conferido:** `/` e `/login/` = 200; `/auth/session` = 200 com `authenticated:false`, `status:anonymous`, `provider:supabase`; `/releases/catalog.json` = 200, catálogo vazio. A sessão anônima valida a rota e a configuração pública, **não** comprova E2E de login real, cadastro ou publicação de releases.
- Deployments com estado `CANCELED` podem ser o resultado **esperado** de `tools/vercel/should_skip_build.sh` quando o Site não mudou. Conferir os eventos de build e o manifesto público antes de classificar um cancelamento como falha; alterações reais do Site devem continuar invalidando o cache.

**Conclusão:** a origem Git e o bundle realmente servidos pelo domínio público **já são do monorepo**. Não é necessário reconectar o projeto de staging para afirmar essa origem em produção. Não criar novo projeto nem deslocar os domínios existentes.

## Staging histórico — desativado

- **Projeto de staging histórico:** `ordax-site` (`prj_rEZck0dLNrLlSX9UhjifUzGiFpts`) foi **pausado em 2026-11-22**, preservando histórico, configurações e proteção SSO. Os endereços `ordax-site.vercel.app` e `ordax-site-dev.vercel.app` responderam HTTP 503 `DEPLOYMENT_PAUSED`. A origem Git antiga continua vinculada apenas como registro histórico; o projeto não serve a produção.
- **Origem histórica:** `ordaxsystems/ordax-site` está arquivado e somente leitura. `main@2369a051` e a branch documental `f26f231b` possuem apenas `README.md`; os commits antigos permanecem no Git, mas não há código ativo.
- **Prova histórica de preview:** `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr` (READY antes da pausa), `ordax-os@bcd355bab778edfb2d5583030c41420b0f2bd205`, com 11 rotas públicas e assets validados. Esse recibo não representa mais um ambiente acessível.
- Antes da pausa, as rotas `/auth/*` do preview devolviam `public-origin-unconfigured` por ausência de configuração própria, corretamente fail-closed; após a pausa, os endereços antigos devolvem `DEPLOYMENT_PAUSED`. Não copiar secrets/origem da produção nem enfraquecer validações de OIDC.
- A configuração histórica do projeto staging tinha `rootDirectory=site` e `sourceFilesOutsideRootDirectory=true`. **A pausa é reversível, mas não reativa o Git arquivado.** Se nova homologação exigir esse projeto, primeiro reconectá-lo a `ordax-os/main` no painel oficial com Root Directory na raiz do monorepo e configurar sua origem/Identity; somente depois despausar. Não criar projeto paralelo, remover domínios de produção ou apagar o histórico sem necessidade.

## Fluxo técnico mantido

- Um único lock npm na raiz do OS; workspace `site`. A versão de Node é fixada em `24.x` no manifesto raiz e no lock, alinhada aos projetos Vercel e aos testes do Site. A configuração canônica de build/rewrite fica apenas em `vercel.json` na raiz do OS; `site/vercel.json` foi removido após a pausa do staging; as funções de Conta/OAuth vivem uma só vez em `api/` e `lib/`.
- `site/scripts/build_impact.py` concentra o impacto do Site para Vercel/CI: frontend, APIs, gateway, Surface UI/workspace, catálogo, contratos, serviços de apresentação, marca e fonte Inter exigem build; mudanças isoladas de Creator/Desktop/Runtime nativo não. Diff incerto exige build. `tools/vercel/build.py` rejeita o staging antigo como destino executável.
- Workflow `.github/workflows/public-site-candidate.yml`: execução [44995192998](https://github.com/ordaxsystems/ordax-os/actions/runs/44995192998) **2/2 jobs SUCCESS** para a revisão de alinhamento Node 24. O workflow de integridade legal [44995001232](https://github.com/ordaxsystems/ordax-os/actions/runs/44995001232) validou o gate de equivalência. Não repetir kernel, QEMU, USB ou Creator por alterações do Site.
- A ativação legal manual exige que o **artefato produzido e verificado no commit do workflow** seja equivalente ao manifesto realmente servido pela produção, incluindo inventário de arquivos, hashes e política. O `source_commit` publicado pode ser anterior quando a Vercel pulou corretamente um build sem mudanças de Site. Se ambos os SHAs forem iguais, os bytes do manifesto também devem ser idênticos. Nunca presumir `READY` ou ativar Conta a partir de um SHA isolado.

## Gates independentes que não se presumem aprovados

1. E2E autenticado real de Conta/OAuth e gates de proteção, segurança e acessibilidade manual. HTTP 200 de sessão anônima não substitui essas provas.
2. Habilitação pública de recursos restritos, cadastro, downloads e releases depende de suas próprias autoridades e aprovações. `docs/contracts/public-site-source.json` ainda declara `production_deployment_activated=false`: não mudar o gate apenas por existir um bundle público; reconciliar seu significado com a autoridade de rollout antes de ativá-lo.
3. Staging legado **pausado e fora de operação**. Para futuras provas de autenticação, usar `ordax-os/main` e um ambiente autorizado; eventual reutilização do projeto antigo exige reconexão Git ao monorepo, nunca restauração de código legado.

Histórico da migração e recibos anteriores permanece no Git. Este handoff documenta **autoridades e gates operacionais**; para o estado em tempo real usar a conexão Git do projeto, o deployment ativo e o manifesto publicado. Não restaurar repositórios ou pipelines legados.

## Cutover dos releases históricos de marca e Meridian

Os dois pacotes de apresentação são gerados no próprio checkout Git
`ordax-os/main`, referenciando **exatamente o mesmo SHA** do bundle Site.
`site/contracts/dev-artifact-lock.json` v3 exige prova do contrato
`docs/contracts/surface-source.json`. Os inputs são conferidos contra
blobs Git, cada payload tem SHA-256 e inventário verificado. O status dos
pacotes permanece `candidate-not-published`. O Site não consome releases
de `ordax-surface` nem publica releases oficiais; catálogo público
`empty` até autorização independente.


## Publicação canônica no Hobby — Vercel Git da main (22/11/2026)

**Um publicador em produção:** integração Git nativa do projeto
`ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`), na equipe
`ordaxsystems`, conectada exclusivamente a `ordaxsystems/ordax-os/main`.
A equipe Vercel foi verificada no plano **Hobby**, que não permite
`deploymentPolicy.deploymentSources` com fonte exclusiva `rest-api`:
a tentativa de configuração foi rejeitada pelo provedor com HTTP 403
`pro_plan_required`, sem modificar a política do projeto. Portanto,
**não existe um segundo publicador REST/CI habilitado**. O protótipo
`tools/vercel/selective_site_delivery.py`, seu workflow e seus testes
foram retirados do source ativo; o histórico permanece no Git.

O mesmo `vercel.json` é consumido por `ordax-os-public` e `ordax-web`.
Sua política Git existente deve continuar:
`"deploymentEnabled": {"**": false, "main": true}`.
Nunca desligar Git globalmente para corrigir o Site: isso afetaria Web.
O build continua em `tools/vercel/build.py`; o único filtro compartilhado
de impacto é `tools/vercel/should_skip_build.sh`, que usa
`site/scripts/build_impact.py` para o Site. Deployments cancelados por
esse filtro podem ser esperados, mas ainda devem ser analisados contra
quota e conteúdo real. Não recriar scripts de publicação adormecidos,
hooks paralelos, projetos adicionais ou credenciais de CI desnecessárias.

`Public Site Candidate` mantém a validação de frontend, contratos e
composição Git. **Esse CI não é uma barreira síncrona pré-deploy** para
commits enviados diretamente à main: a Vercel pode iniciar o deployment
Git imediatamente. Testes e alterações relevantes devem ser validados
antes da publicação da main; não confundir CI concluído com Site já
atualizado. Manter o gate separado para Account Gateway no Supabase:
nenhum deploy Git do Site concede grants, ativa cadastro ou substitui
aprovação manual do SHA do Gateway.

### Recibo de produção datado — não é ponteiro permanente

Em 22/11/2026, a Vercel confirmou o deployment Git
`dpl_6n8nJyiJ4KZpiwBGeuckgphnWWpi` como `READY` e com alias
`ordax.com.br` e `www.ordax.com.br`, fonte
`a1c9f93de5e31c8522905431d49d779874e9a626`.
O GET HTTP de `https://ordax.com.br/public-site-manifest.json` devolveu
`200`, `artifact_class=public-site`, `source_commit=a1c9f93d...`,
e `brand` / `surface_preview` de `ordaxsystems/ordax-os` na mesma
revisão. A ancestralidade Git comprovou que esse commit contém as
correções de Conta/continuity (`c9503d29`) e as traduções (`65400432`).
Um avanço posterior da main sem mudanças de Site não invalida
automaticamente esse recibo, mas **a próxima conversa deve reconsultar
o deployment associado ao domínio, a HEAD, o CI aplicável e o manifesto**.

O alvo de publicação não pode ser deduzido de um número de commit
anotado aqui. Se a Vercel não publicar um input de Site realmente
alterado, investigar o webhook, a seleção de branch, os limites do plano
e a causa do deployment (inclusive Ignored Build Step). Não iniciar
deploy REST manual para compensar a demora, nem substituir a política
Git pela exigência Pro sem nova decisão arquitetural.
