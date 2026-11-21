# OrdaX Site — módulo nativo do monorepo

Fonte única de código: ordaxsystems/ordax-os/main.
Módulo: site/
Raiz dos arquivos apresentados ao público: site/public/

Existe apenas um aplicativo público. A pasta public abriga HTML, CSS, assets e internacionalização; não representa outro owner nem um segundo aplicativo.

## Publicação e segurança
Reutilizar somente o projeto Vercel ordax-site existente (prj_rEZck0dLNrLlSX9UhjifUzGiFpts), com Root Directory configurado para site e commit da main do ordax-os. site/vercel.json mantém o build e as regras originais de rotas, CSP, headers, noindex e bloqueio de cadastros. Não criar outro projeto, pipeline, origem ou serviço.

Os entrypoints Vercel site/api/account-proxy.mjs e site/api/oauth-consent.mjs importam diretamente as APIs canônicas na raiz do mesmo commit Git do ordax-os, sem baixar código, sem locks de origem externa e sem implementar Identity, OAuth, permissões ou sessões novamente. O projeto Vercel precisa permitir arquivos de origem fora da Root Directory para empacotar esses imports, com prova real em preview antes do cutover.

O projeto não publica nem autoriza contas, grants, cadastro ou downloads por conta própria. contracts/dev-artifact-lock.json continua fixando somente artefatos de Marca e Surface verificados.

## Validação local
Na pasta site, executar:
  python3 scripts/build.py check
  python3 -m unittest discover -s tests -p test_site_contract.py
  node --test tests/test_gateway_host.mjs

Quando for necessário build/deploy do Site, executar o builder site/scripts/build.py com --source-commit igual ao SHA completo da main do ordax-os e --dev-lock contracts/dev-artifact-lock.json; depois executar verify no resultado. Não disparar kernel, QEMU, USB, Creator ou Desktop.

A regra DEV transversal reside somente em URGENTE-LEIA.md e docs/DEVELOPMENT-WORKFLOW.md da raiz do OS. Documentação histórica permanece preservada no Git da origem e não é instrução operacional.

Arquivar ordax-site somente após conferir o deploy real do mesmo SHA do OS e a inexistência de alterações/branches/PRs não importadas.
