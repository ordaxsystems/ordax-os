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

O repositório antigo `ordaxsystems/ordax-site` foi limpo e arquivado como histórico somente leitura em 21/11/2026: `main@2369a051` e branch documental `f26f231b` possuem somente `README.md`. Nenhum código ativo nem workflow permanece lá. A publicação Git automática ainda depende de reconectar o projeto Vercel existente a `ordax-os/main` (Root Directory `site`, inclusão de arquivos externos à raiz). Para impedir que a remoção dispare um deployment vazio pela conexão antiga, o projeto Vercel recebeu temporariamente **Ignored Build Step = `exit 0`**; remover essa supressão somente após a reconexão e validação das configurações, sem criar segundo projeto.


## Dependências do host Vercel

O site é workspace npm do ordax-os, usando exclusivamente package-lock.json da raiz; nunca manter segundo lock no módulo. site/vercel.json executa a instalação a partir da raiz com npm ci --workspace=site --omit=dev para que a API canônica em lib/ consiga resolver @vercel/oidc sem cópia. Configurar Root Directory=site e habilitar Include source files outside the Root Directory na Vercel ao reapontar o projeto existente. Pré-flight em novo preview precisa confirmar a inclusão das rotas serverless antes de publicar.
