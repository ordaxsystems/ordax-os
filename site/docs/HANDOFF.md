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
