# OrdaX Desktop — módulo Windows

**Código e publicação:** ordaxsystems/ordax-os/main, diretório desktop/.
Desktop, Surface e composição Native usam o mesmo SHA de fonte.
Não há outro host Windows ou repositório externo necessário ao desenvolvimento.

## Desenvolvimento direto (DEV)
Na raiz do OS: primeiro npm ci; depois npm ci --prefix desktop;
para executar a shell, node desktop/local-dev.cjs.
A visual Native vem de system/composition/native e system/surface/,
sem clone de ordax-surface nem instalação de outro Desktop.

Testes: node --test desktop/host-startup.test.cjs desktop/runtime.test.cjs.
A produção NSIS permanece no workflow existente
.github/workflows/windows-desktop-dev.yml, executado apenas quando necessário
com prova do mesmo OS SHA. O corte físico Windows foi comprovado pelo
workflow #44980537772 e pela instalação real com Surface Native pronta.
Mudanças de código do shell Electron exigem um novo NSIS validado; o conteúdo
Native/Surface DEV é atualizado pelo Git, sem reinstalar o shell por rotina.
Alterações exclusivas de Creator, Site e documentação não devem recompilar Native.

Auditoria de corte e evidências físicas: [docs/CUTOVER-2026-11-21.md](docs/CUTOVER-2026-11-21.md).
