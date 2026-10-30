# OrdaX Desktop Windows: desenvolvimento local sem instalador

Este é o roteiro de execução do próprio host Electron em Windows, usando
`ordax-os` para serviços e `ordax-surface` como fonte visual única. Os
arquivos de apresentação são montados como junctions **ignoradas pelo Git**;
nenhum arquivo visual é duplicado no repositório OS.

No PowerShell, com os dois repositórios clonados como irmãos:

```powershell
git clone https://github.com/ordaxsystems/ordax-os.git
git clone https://github.com/ordaxsystems/ordax-surface.git
cd ordax-surface
git switch -c dev/desktop-preview 3e4b88a23ab5078092d342b691ed908994b2601a
cd ../ordax-os
npm ci
cd tools/windows-desktop
npm ci
node node_modules/electron/install.js
npm run dev:local
```

Substitua o SHA do exemplo pelo `source_commit` vigente em
`docs/contracts/surface-source.json`. O script falha explicitamente se o
remoto não for `ordaxsystems/ordax-surface`, se o checkout divergir do
lock ou se houver outra UI no caminho de montagem. O checkout pode ser
alterado localmente após a revisão inicial, mas isso **não** altera a
proveniência verificada de uma distribuição: um novo release requer commit,
lock e gates próprios.

O Electron reutiliza o host Native e os grants por sessão. Vite acompanha
alterações de CSS/JS na Surface externa e oferece HMR, sem instalar,
compilar kernel ou criar executável NSIS. Mudanças de serviço Native podem
exigir reinicialização da sessão de desenvolvimento. Falta de uma capacidade
é reportada como indisponibilidade; o comando não cria permissões artificiais.

O fluxo instalado permanece separado: `surface-stage.cjs` fixa os
bytes de uma revisão, `native-build.cjs` verifica recibos SHA-256 e
`dev-update.cjs` gerencia rollback. Não usar o modo local como
evidência de assinatura Stable nem de atualização do shell Electron.
Testes mínimos: `node --test local-dev.test.cjs` e
`node --test checkout.test.cjs surface-stage.test.cjs host-startup.test.cjs`.
