# Site — estado canônico de produção e staging

**Fonte única:** `ordaxsystems/ordax-os/main`, módulo `site/`. Os arquivos públicos estão em `site/public/`; os adaptadores `site/api/` reexportam somente `api/` e `lib/` do mesmo commit. Não clonar, copiar ou reconstruir `ordax-site`.

## Produção pública — evidência real

- **Projeto Vercel de produção:** `ordax-os-public` (`prj_mA9ew6hOfjdqlBr1cC757iMLPQJC`), conectado diretamente a `ordaxsystems/ordax-os`, branch `main`.
- **Domínios:** `ordax.com.br` verificado; `www.ordax.com.br` redireciona para o domínio principal. Esse projeto é diferente do staging `ordax-site`.
- **Autoridade de produção em tempo real:** consultar a versão `READY` associada ao domínio `ordax.com.br` no projeto Vercel existente e confirmar por HTTP 200 o `source_commit` e a classe `public-site` de [`/public-site-manifest.json`](https://ordax.com.br/public-site-manifest.json). Não registrar um SHA histórico como se fosse permanentemente a revisão atual da produção. O primeiro cutover foi comprovado em `dpl_GT8hoGeM7X2gzP56gG1zDHMwNXdR` (`0bf86219`); outra prova posterior ocorreu em `dpl_28Yj3saZ42WUUCVpB63tEnfFCNf9` (`ed7ad0c`). Estes são **recibos históricos**, não ponteiros mutáveis de produção.
- **HTTP público conferido:** `/` e `/login/` = 200; `/auth/session` = 200 com `authenticated:false`, `status:anonymous`, `provider:supabase`; `/releases/catalog.json` = 200, catálogo vazio. A sessão anônima valida a rota e a configuração pública, **não** comprova E2E de login real, cadastro ou publicação de releases.
- Deployments com estado `CANCELED` podem ser o resultado **esperado** de `tools/vercel/should_skip_build.sh` quando o Site não mudou. Conferir os eventos de build e o manifesto público antes de classificar um cancelamento como falha; alterações reais do Site devem continuar invalidando o cache.

**Conclusão:** a origem Git e o bundle realmente servidos pelo domínio público **já são do monorepo**. Não é necessário reconectar o projeto de staging para afirmar essa origem em produção. Não criar novo projeto nem deslocar os domínios existentes.

## Projeto antigo de desenvolvimento — pendência distinta

- **Projeto Vercel de staging:** `ordax-site` (`prj_rEZck0dLNrLlSX9UhjifUzGiFpts`), domínios próprios `vercel.app`, proteção SSO em todos os deployments, ainda conectado a `ordaxsystems/ordax-site`.
- **Origem histórica:** `ordaxsystems/ordax-site` está arquivado e somente leitura. `main@2369a051` e a branch documental `f26f231b` possuem apenas `README.md`; os commits antigos permanecem no Git, mas não há código ativo.
- **Preview comprovado do monorepo no staging:** `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr` (READY), `ordax-os@bcd355bab778edfb2d5583030c41420b0f2bd205`, com 11 rotas públicas e assets validados, sem produção promovida.
- O HTTP 503 `public-origin-unconfigured` nas rotas `/auth/*` do staging é **fail-closed e específico desse ambiente**. A API canônica exige origem configurada idêntica ao host de entrada, URL de gateway e identidade OIDC; copiar `https://ordax.com.br` para um host `vercel.app` protegido geraria rejeição de origem. Não remover a validação nem copiar secrets de produção.
- A configuração do projeto staging aceitou `rootDirectory=site` e `sourceFilesOutsideRootDirectory=true`; o override provisório `commandForIgnoringBuildStep=exit 0` foi removido. O conector Vercel disponível não permite substituir a ligação Git existente. **Se o staging for mantido**, reconectar pelo painel oficial a `ordax-os/main` e conferir a publicação automática. Se for descontinuado, preservar a produção pública e exigir decisão explícita antes de apagar o projeto ou seus aliases.

## Fluxo técnico mantido

- Um único lock npm na raiz do OS; workspace `site`. A versão de Node é fixada em `24.x` no manifesto raiz e no lock, alinhada aos projetos Vercel e aos testes do Site. A configuração canônica de build/rewrite está em `site/vercel.json`; as funções de Conta/OAuth vivem uma só vez em `api/` e `lib/`.
- `site/scripts/build_impact.py` evita builds de Site por mudanças isoladas em Desktop/Forge/sistema nativo e exige build quando frontend, APIs, dependências ou contratos executáveis mudam; diff incerto exige build.
- Workflow `.github/workflows/public-site-candidate.yml`: execução [44995192998](https://github.com/ordaxsystems/ordax-os/actions/runs/44995192998) **2/2 jobs SUCCESS** para a revisão de alinhamento Node 24. O workflow de integridade legal [44995001232](https://github.com/ordaxsystems/ordax-os/actions/runs/44995001232) validou o gate de equivalência. Não repetir kernel, QEMU, USB ou Creator por alterações do Site.
- A ativação legal manual exige que o **artefato produzido e verificado no commit do workflow** seja equivalente ao manifesto realmente servido pela produção, incluindo inventário de arquivos, hashes e política. O `source_commit` publicado pode ser anterior quando a Vercel pulou corretamente um build sem mudanças de Site. Se ambos os SHAs forem iguais, os bytes do manifesto também devem ser idênticos. Nunca presumir `READY` ou ativar Conta a partir de um SHA isolado.

## Gates independentes que não se presumem aprovados

1. E2E autenticado real de Conta/OAuth e gates de proteção, segurança e acessibilidade manual. HTTP 200 de sessão anônima não substitui essas provas.
2. Habilitação pública de recursos restritos, cadastro, downloads e releases depende de suas próprias autoridades e aprovações. `docs/contracts/public-site-source.json` ainda declara `production_deployment_activated=false`: não mudar o gate apenas por existir um bundle público; reconciliar seu significado com a autoridade de rollout antes de ativá-lo.
3. Decisão sobre o staging Vercel separado: religar ao monorepo **se necessário** ou descontinuar com autorização, sem ressuscitar o repositório de código antigo.

Histórico da migração e recibos anteriores permanece no Git. Este handoff documenta **autoridades e gates operacionais**; para o estado em tempo real usar a conexão Git do projeto, o deployment ativo e o manifesto publicado. Não restaurar repositórios ou pipelines legados.
