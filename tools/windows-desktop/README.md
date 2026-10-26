# OrdaX OS Desktop Dev — Windows (Alpha)

**Produto pretendido:** a mesma fonte canônica do OrdaX OS USB, em uma
aplicação Windows. Não é um segundo OrdaX nem um fork da Surface. As
diferenças permitidas são as capacidades que exigem Windows em lugar do
kernel/serviços Linux; o Windows deve ter Internet, Conta OrdaX, apps, Spaces,
Intelligence, modelo local e os mecanismos de atualização aplicáveis à
modalidade. O objetivo é **paridade de produto**, não um emulador visual.

**Estado real deste build:** ALPHA INCOMPLETA. A implementação já compartilha
`system/composition/native`, `system/apps`, `system/services` e os
contratos, mas diversas portas ainda são um host de desenvolvimento. Um
arquivo existente no instalador não prova a capacidade funcionando. A
matriz, bloqueios e gates estão em
[`docs/plans/ordax-os-desktop-windows-ssot-2026-10-20.md`](../../docs/plans/ordax-os-desktop-windows-ssot-2026-10-20.md).

## Integração com a source authority atual — 25/10/2026

O Windows consome **a mesma revisão OS de `main`** utilizada pelos outros
modos. A revisão visual é **a única Surface externa** fixada por
`docs/contracts/surface-source.json`, propriedade de
`ordaxsystems/ordax-surface`. O código visual antigo
`system/surface/ui` e `system/surface/workspace` **não é rastreado pelo
repositório OS**. A CI Windows usa o verificador já canônico
`tools/surface-source/materialize.py` em checkout *descartável*, validando
proveniência Git e materializando a Surface apenas para build/teste e
empacotamento desta candidata. Não há segundo editor da UI.

A PR foi reconciliada com a `main` em `cbd4a9b9`, sem rebase/force-push,
e conserva os ajustes específicos Windows. O navegador usa o mesmo protocolo
Native, com transporte específico de Electron apenas quando seu bridge
restrito existe; indisponibilidade de bridge privilegiado do USB não é
substituída por uma autoridade falsa.

**Staging e ativação transacional Owner/Dev foram comprovados no
Desktop Windows físico (26/10/2026), com health e rollback preservados.** `dev-update.cjs` usa o mesmo OS SHA da `main` e o
`source_commit` da Surface fixado nesse commit. `surface-stage.cjs` é o
adaptador Git/Windows: obtém a revisão exata, valida origem, blobs Git,
limites e recusa symlinks; monta os arquivos visuais somente durante a
compilação, remove o overlay e grava o recibo OS/Surface com SHA-256 de
todos os ativos compilados. `hasNativeBundle` impede boot de candidata
sem lock, sem recibo ou com ativo JS/CSS alterado. Isso foi testado em CI e
fixtures Git offline; **as revisões `938f1ebc` e `2a007c30` foram adquiridas e ativadas
sequencialmente no Windows real, com `activeSha` confirmado após health,
`previousSha` preservado e `pendingSha=null`.** Não chamar isso de paridade
completa do `ordax-pull` até essa prova, nem instalar Python no usuário
ou distribuir uma segunda cópia permanente da Surface.

Os perfis `owner-development` e `stable-mvp` continuam definidos somente
em `docs/contracts/distribution-profiles.json`: o primeiro pode utilizar
desenvolvimento Git controlado e o segundo deve consumir **releases assinadas
sem Git obrigatório**. O Windows executa o mesmo produto com adaptadores de
host distintos; **não** possui outro catálogo de apps, outro mecanismo de
assinatura, outra política comercial ou uma segunda versão de código.
O instalador CI agora transporta o lock da Surface e o recibo contendo
OS SHA, Surface SHA e fingerprint SHA-256 dos arquivos Native gerados. O
Electron recusa abrir o bundle de instalação se faltar esse manifesto ou
houver divergência dos bytes. Isso não é assinatura de release pública.
Intelligence/Aura local, autenticação real, updates assinados e rollback
E2E instalado ainda **não estão homologados como produto completo**. Os PRs de infraestrutura já integrados não equivalem à homologação comercial Stable/MVP.

## Entrega Windows vinculada a `main` — política SSOT

O workflow canônico `.github/workflows/windows-desktop-dev.yml` valida PRs
e executa também em `push` para `main` quando arquivos que impactam o
Desktop são alterados. Os dois eventos compartilham **um único filtro de
impacto**, não duas listas independentes. Execuções antigas são canceladas
quando uma revisão mais nova as substitui no mesmo fluxo.

O instalador de desenvolvimento resultante é sempre vinculado ao SHA exato
de `ordax-os` e ao SHA da Surface do lock **daquele commit**, verificado
na compilação, no recibo e no smoke instalado. O nome/versionamento do
shell Electron não é o número da Entrega nem representa o SHA da fonte OS.

Esse CI **não instala automaticamente** o novo shell no computador do
usuário, não publica o canal Stable e não grava USB. O Desktop Dev já
instalado continua dependente de uma instalação/upgrade verificado do
shell e de seu próprio update transacional do conteúdo OS. Assim,
`build aprovado`, `artefato disponível` e `Desktop efetivamente ativo
na revisão` permanecem três fatos distintos e verificáveis.

Mudanças exclusivamente Linux (kernel/base/USB) não devem acionar um
novo instalador Windows; mudanças no núcleo compartilhado, no lock
Surface ou nos adaptadores Windows devem acioná-lo.

## Ordax-pull no Desktop Windows (Owner/Development)

**Autoridade única:** `docs/contracts/distribution-profiles.json` mantém
`owner-development = git-main`. No USB Dev, o adaptador Linux de aquisição é
`bootstrap/dev-base/ordax-pull` e o Supervisor ativa a Surface. No Windows,
`tools/windows-desktop/dev-update.cjs:stageMain` é o adaptador de materialização
Git do **mesmo perfil Owner/Development e mesma main**, não um segundo canal
de distribuição. `main.cjs` coordena apenas o ciclo de vida Electron, sem
outro git-pull, segunda cópia da Surface ou outra base de dados.

**Causa da lacuna histórica:** o Desktop instalado fazia discovery após o
boot e a cada dez minutos, compilava e verificava uma candidata
`runtime-versions/<SHA>`, mas a deixava em `pendingSha` até que alguém
reiniciasse o aplicativo. Assim, não tinha a ativação automática que o
`ordax-main-watch` mais o Supervisor já oferecem no USB Dev.

**Contrato atual do branch de correção:** quando houver candidata validada,
o Electron verifica sua condição de inatividade a cada 15 segundos e solicita
seu próprio relançamento apenas após 60 segundos com janela oculta, 120
segundos em segundo plano, ou 600 segundos com janela em primeiro plano.
Não encerra uma sessão interativa ativa, não reinicia o Windows e não aplica
código não verificado sobre a árvore em execução. O handoff Electron usa um
único coordenador transacional em `dev-update.cjs`: impede callbacks de
timer concorrentes e **revalida SHA pendente, pino de rollback, atividade
humana e host saudável depois da leitura assíncrona do First Run**, antes de
pedir relaunch. Se qualquer pré-condição mudou, a candidata não é consumida,
o app continua aberto e o próximo ciclo pode avaliar o estado novo.
O navegador Windows tem a autoridade real de suas `WebContentsView`,
transferências e navegações. A ativação automática também exige **nenhum
download pendente/em andamento, nenhuma aba navegando e nenhum áudio
Chromium sendo reproduzido** (incluindo a Surface Native), pois a falta
de movimento de mouse/teclado não significa ausência de trabalho. Ao fim
desse trabalho, o próximo ciclo reavalia a mesma candidata Git — sem
descartar nem cancelar downloads para atualizar. Inspeção de mídia
indisponível falha fechada para a ativação, sem quebrar o aplicativo. Na inicialização, o mesmo
`chooseBootVersion` seleciona a candidata uma única vez, executa o Native
host + Surface, confirma saúde e grava `activeSha`; falha ou encerramento
sem recibo volta ao conhecido bom e rejeita o SHA. Rollback fixado desativa
atualizações até retomada explícita. Smoke NSIS usa perfil isolado e não
executa reinício automático.

**Inatividade confiável no Windows/RDP:** a ativação nunca deve
confundir inatividade de todo o Windows com inatividade do próprio OrdaX.
Quando a janela está em foco, o Electron ainda exige os 600 segundos reais
reportados por `powerMonitor`. Quando está minimizada/oculta ou em segundo
plano, o próprio `BrowserWindow` é a autoridade de foco e minimização:
um relógio monotônico iniciado nos eventos `blur`, `hide` e `minimize`,
reiniciado por `focus`, `show` e `restore`, mede respectivamente os
60 ou 120 segundos de ausência de atenção. `isMinimized()` é consultado
separadamente porque, no Windows, `isVisible()` sozinho não determina se
a janela foi minimizada. Essa política mantém todos os gates de downloads,
áudio, navegação, First Run, Native health, revisão Git e rollback, e não
cria serviço/atualizador adicional nem altera o temporizador global do PC.

**Gate de primeiro uso idêntico ao USB:** antes de descobrir atualizações
ou iniciar o trial automático, o Desktop lê o `native-state/native-state.json`
já persistido pelo Native Host e o valida com o módulo canônico
`system/contracts/first-run-state-store.mjs`. Sem comprovante `completed`
válido, não há staging automático nem reinício para aplicar `pendingSha`.
Uma candidata já preparada permanece guardada, sem ser marcada rejeitada;
após a conclusão do primeiro uso, volta ao caminho normal com health/rollback.
O fluxo USB já usa o mesmo pré-requisito lógico em `ordax-main-watch`.
Não há arquivo de configuração de OOBE paralelo.

**Fronteira de lançamento:** a consulta automática acima ocorre enquanto o
processo Electron está aberto. Não existe ainda um serviço permanente Windows
quando ele está totalmente encerrado. Além disso, `ordax-pull` altera o
conteúdo OS/Surface, **não substitui o executável Electron nem seu
`app.asar`**. Portanto corrigir esse fluxo não comprova atualização
autônoma do shell/instalador, assinatura da distribuição pública ou paridade
final com o USB. Nenhuma rota Git deve ser introduzida para o Stable/MVP;
essa modalidade permanece no canal assinado já definido no contrato.

## Boot do Desktop instalado sem servidor de desenvolvimento

O Desktop Windows instalado, quando recebe do Electron um bundle Native
compilado e verificado pelo recibo OS+Surface, usa
`tools/windows-emulator/desktop-native-server.mjs`. Esse adaptador monta
**os mesmos middlewares e grants Native** definidos em
`tools/windows-emulator/native-host.mjs` (Conta, arquivos, sessão,
diagnósticos, rede, energia, atualização e recuperação), e entrega somente
HTML/assets compilados e arquivos estáticos permitidos do sistema por HTTP
loopback. Não inicializa Vite, HMR ou transformação de código-fonte no boot.

A autoridade de seleção continua sendo
`tools/windows-desktop/main.cjs` junto com os validadores em
`native-build.cjs` e `dev-update.cjs`; o HTTP server não decide se uma
candidata Git é confiável nem substitui o supervisor transacional.
`tools/windows-desktop/host.cjs` mantém fallback Vite **apenas** quando
o snapshot anterior não possui o runner compilado, ou no emulador explícito.
O compilador Vite ainda é empacotado para construir novas candidatas
Owner/Dev, mas não precisa iniciar para mostrar uma versão pronta.

A CI instalada deve demonstrar
`DESKTOP_INSTALLED_NATIVE_NO_VITE=PASS`, montagem da Surface,
capacidade de navegação e rejeição de chamadas localhost sem token.
Testes isolados verificam HTTP, acesso à fonte estática limitada,
integridade da política e ausência de acesso a arquivos privados.
A otimização **não** implica que o peso do NSIS foi reduzido: a remoção
do toolchain da distribuição depende antes de substituir a compilação
local por entregas verificadas mantendo rollback e o mesmo SSOT.
Também não comprova automaticamente a melhoria de tempo no hardware real,
que exige medição separada após o upgrade autorizado.

## Desenvolvimento e empacotamento

A partir da raiz (Node/npm instalados):

```sh
npm ci
cd tools/windows-desktop
npm ci
npm start
# em Windows: npm run dist:win
```

O NSIS é uma **prévia sem assinatura**, exclusiva do canal de
desenvolvimento. A CI Windows usa `windows-desktop-dev.yml`, instala em
diretório isolado, verifica execução do Electron e valida o Runtime com
dependências não graváveis. O instalador ainda não possui medição e
porcentagem suficientes; concluir a otimização é um gate pendente.

## Conta Windows — cofre local criptografado

O Desktop Dev instalado reutiliza exatamente o gateway HTTPS canônico de
Conta. Somente no host Windows instalado, `system/adapters/desktop/account-cookie-vault.mjs`
protege os cookies de sessão recebidos do gateway com **DPAPI CurrentUser** e
salva o envelope cifrado no perfil `userData`; o processo Native recupera
o envelope em uma nova inicialização. Não há cópia de identidade, sessão
fabricada ou cookies persistidos no renderer/Surface.

O emulador de desenvolvimento continua **somente em memória**; o suporte
Windows é ativado exclusivamente pelo host Desktop com perfil explícito.
Uma falha de descriptografia ou troca do gateway bloqueia a autenticação;
logout local explícito apaga o cofre, inclusive se o envelope estiver
corrompido. O gateway continua sendo a única autoridade para validar,
expirar e revogar a sessão. Não é uma prova de login remoto real em produção:
esse E2E ainda exige uma conta de teste autorizada e um restart físico do
aplicativo instalado. O DPAPI não é uma chave transportável entre máquinas.

## Sessão local Native no Windows

O host instalado implementa o contrato `ordax.local-session/1` com credencial
derivada via scrypt e registro durável, incluindo estado bloqueado, tentativa
incorreta com limitação de ritmo, desbloqueio e remoção autenticada. A credencial
em texto puro não é persistida. Cada execução do Electron gera um token local
distinto do token de Files; somente a WebContents Surface pode receber a
autorização, injetada pelo próprio host nos requests da rota Native. Qualquer
cliente localhost sem o token recebe HTTP 401.

Com a sessão bloqueada, as rotas de Conta/sync e Files recusam operações
(HTTP 423); falha de integridade do registro impede abrir os dados (503).
O bloqueio é **de Surface/sessão OrdaX**, e não substitui a segurança de disco,
login do Windows, nem a revogação da Conta. Os demais brokers privilegiados
ainda precisam de adaptadores Windows e controles próprios. O emulador visual
não adquire essa autoridade.

## Diagnósticos Native da Surface Windows

A instalação Windows agora usa o mesmo adaptador visual
`system/adapters/native/client-diagnostics.mjs`, com endpoint real
`/__ordax/native/session` limitado à Surface Electron autorizada.
O host emite apenas `diagnosticToken`: não cria permissões fictícias de
energia, rede, áudio ou gerenciamento. O endpoint
`/__ordax/native/client-diagnostic` aceita somente o relatório sanitizado
`sourceSha/stage/errorName/source`, vinculado à revisão OS comprovada pelo
recibo de compilação, com token exclusivo, corpo limitado e gravação
atômica em `desktop-client-diagnostic.json` no perfil privado.

O renderer não recebe o token secreto de **acesso à sessão do host**.
O token de relatório, por sua vez, autoriza somente enviar o evento
sanitizado, nunca ler arquivos, executar ações ou obter credenciais.
O `.exe` inicializa a Surface com `?source=<SHA>` da revisão OS
validada (bundle ou candidata Git), permitindo associar a falha à revisão
real. O emulador sem distribuição verificada continua sem esse privilégio.
Somente no smoke isolado de CI é gravado um evento de teste controlado.

## Perfil canônico de dispositivo no Windows

O Desktop instala a porta real `ordax.device-profile/1`, a mesma usada
pelo primeiro uso do USB. O identificador `ordax-<32 hex>` nasce uma única
vez por perfil OrdaX e permanece estável após renomeação e reinício.
`displayName` muda somente depois de POST autorizado da Surface; isso
não renomeia o computador Windows, não cria identidade de Conta/MCP e
não altera nenhuma configuração do sistema hospedeiro.

O registro `desktop-device-profile.json` reside no `userData` privado,
com validação, serialização de operações, escrita atômica e recusa de
arquivos corrompidos ou symlink. Bloqueio da sessão OrdaX retorna 423;
clientes localhost sem concessão efêmera específica do Electron recebem
401. O emulador sem host instalado continua sem esse privilégio.

## Estado privado do Primeiro Uso e Preferências

No `.exe` Windows, as três rotas canônicas de estado
`/__ordax/native/first-run`, `/__ordax/native/preferences` e
`/__ordax/native/first-run-cursor` exigem um **sexto token efêmero de
256 bits**, independente dos grants Files, Conta e identidade. O Electron
retira qualquer header fornecido pela página e somente o injeta na
WebContents Native do próprio OrdaX; localhost externo recebe HTTP 401.
A sessão OrdaX bloqueada retorna 423 para **escrita**, mas mantém
leitura somente à Surface autorizada, pois a inicialização precisa
restaurar preferências e o recibo de Primeiro Uso antes de montar a tela
de desbloqueio. Estado corrompido continua indisponível sem ser recriado.

O endpoint administrativo `/__ordax/emulator/reset-first-run` agora é
estritamente de desenvolvimento visual e **não existe no host Desktop
instalado** (HTTP 404). O mesmo contrato de Primeiro Uso e Preferências
segue sendo usado no Windows e no USB; a implantação não cria novos
serviços, exceções de login ou políticas paralelas.

## Wi-Fi: detecção real de interface e ações indisponíveis

O Desktop consulta `NetworkInterface.GetAllNetworkInterfaces()` do
Windows/.NET para detectar se o host expõe uma interface 802.11.
Quando não existe, o contrato canônico `ordax.network-management/1`
admite explicitamente `wifiInterface:null`, zero SSIDs e
`unavailableReason:"no-wlan-interface"`; isso **não** é uma conexão
Wi-Fi simulada. O adaptador visual trata esse estado como capacidade
indisponível, sem exibir controles de conexão.

Se houver interface WLAN, a consulta responde 503 até existir um
broker Windows WLAN real; jamais anuncia scan, RSSI, WPA, associação ou
credenciais fictícias. Todas as ações POST retornam 503 (mesmo de uma
Surface autorizada), com o estado do host inalterado. O GET exige token
de 256 bits emitido pela sessão Native do próprio Electron;
clientes localhost não autorizados recebem 403. A sessão bloqueada
responde 423 à descoberta. Isto não altera conexões ou configurações
da máquina nem habilita gerência de Wi-Fi ainda.

## Observações Native privadas do Desktop

As rotas canônicas de observação de rede, energia, métricas, atualização,
histórico de atualização e recuperação no Windows exigem uma concessão
efêmera independente de 256 bits da própria WebContents Electron. O host
rejeita leituras localhost externas com HTTP 401, queries inesperadas
com 400 e tentativas de escrita com 405. O header é removido das
requisições da página antes da injeção exclusiva pelo host. A autorização
não muda nenhum contrato de dados do OS, serviço Linux nem política de
controles físicos. Leituras autenticadas permanecem disponíveis durante
o bloqueio local para permitir inicialização e painel de energia.

O smoke do instalador NSIS verifica seis negativas localhost e seis
leituras reais feitas pela Surface instalada; não confunde o acesso
direto ao serviço HTTP com uma autorização do Electron.

## Monitor Windows: modo físico atual (somente leitura)

O Windows Desktop usa o contrato já existente
`ordax.display-outputs/1` da Surface/USB. O provider chama
`EnumDisplaySettingsW(-1)` de user32 para obter a resolução física
e a frequência real de cada dispositivo `DISPLAYn`. As dimensões
de `Screen.Bounds` sofrem virtualização de DPI e **não** são usadas
como resolução física. A lista contém **apenas o modo atual**, sem
modos alternativos ou flags `preferred` inventadas, portanto o botão
de pré-visualização da Surface permanece indisponível.

O acesso exige token efêmero exclusivo da sessão Native Electron.
GET localhost sem autorização responde 403; o provider recusa
**todos** os POST de preview, confirmação e reversão com 503,
sem chamar APIs Win32 de mudança de modo. Se o monitor ou sua
frequência não puderem ser lidos com segurança, o GET falha com
503 em vez de criar um modo fictício. A troca de resolução e
o rollback seguro continuam como etapa separada ainda não entregue.

## Compatibilidade de portas Native no Desktop (26/10/2026)

O host Electron usa a detecção canônica de transporte em
`system/adapters/native/browser-host-transport.mjs`. A composição compartilhada
não deve consultar `ordax.keyboard-layout/1` (aplicação de layout físico
Linux/XKB) nem `ordax.recovery-status/1` (slots de boot USB portable-v2)
quando estiver no Windows. O Windows já publica observação de rollback
pelo contrato distinto `ordax.desktop-recovery/1`, em
`/__ordax/desktop/recovery`. A ausência de adaptador Windows para mudar
layout não pode ser apresentada como capacidade disponível. No Linux, os
dois probes continuam ativos.

O Desktop mantém as portas reais de rede, energia e tela. A auditoria no
hardware Windows verificou leituras válidas dos três providers e de
recuperação, mas observou HTTP 503 transitórios durante o boot e 503
intencionais para ações de troca de modo de tela e WLAN ainda não
implementadas. A correção de roteamento não equivale à homologação
dessas capacidades. Não ampliar timeout nem fabricar snapshots para
ocultar os 503; investigar concorrência e falha da operação nativa
no owner do adaptador.

**Aceite de atualização em 26/10:** `activeSha=2a007c30af9c99a166dc63e898b01b53b463ae56`,
`previousSha=938f1ebcc1c9ef37fc8ae7e0bacda99f592385ba`, Surface
`ready`, transação sem candidata pendente; tests, CI e inspeção física
registrados na issue [#2271](https://github.com/ordaxsystems/ordax-os/issues/2271).
Essa prova refere-se ao Desktop OS Dev e não declara USB físico ou
MVP Stable atualizado. O instalador NSIS do host ainda tem custo físico
elevado (~931 segundos no upgrade observado), principalmente porque o
toolchain com milhares de arquivos participa do pacote.

## Composição canônica

- A mesma Surface e apps vêm de `system/`; não criar telas ou serviços
  Windows paralelos.
- `system/adapters/desktop/` é o dono de capacidades Windows.
  O host Vite/Electron não é autoridade de domínio.
- Primeiro uso/preferências usam estado isolado do usuário; não apagam
  nem alteram USB e não fabricam uma sessão de Conta OrdaX.
- Leitura de rede Windows usa `ordax.network-status/1` com
  `System.Net.NetworkInformation.NetworkInterface`: tipo real do driver
  (Wi-Fi/Ethernet/outro) e estado operacional do link (não uma inferência
  pela existência de endereço IP). Uma interface ligada não comprova
  conectividade com a internet. RSSI permanece `null` quando não há
  medida dBm segura; nenhum scan, senha ou conexão é alterado.
  A leitura é somente de observação, assíncrona e com prazo máximo de
  7 segundos; falha da API não vira HTTP 200 inventado. Gerenciamento
  de Wi-Fi continua separado e indisponível até haver adaptador real.
  Energia usa o mesmo contrato
  `ordax.power-status/1` do OS com `SystemInformation.PowerStatus`, a
  projeção Windows da telemetria real do kernel; não compila C# P/Invoke em
  cada solicitação. A execução física de três leituras sucessivas
  foi validada em perfil de teste isolado; indisponibilidade ou dados
  inválidos continuam falhando sem inventar bateria/carga. Outras
  portas só são publicadas com adaptador seguro e E2E real.
- Intelli­gence (serviços/contratos) está em `system/`, mas **não há**
  engine/pesos Windows homologados nesta alpha; apresentar modelo como
  conectado seria erro de produto.

## Atualização por perfil — política canônica

**Owner/Dev** acompanha a `main` oficial e precisa oferecer staging,
verificação, ativação transacional, health, rollback/pin e histórico, conforme
`docs/DEV-USB-GIT.md` e `system/contracts/update-status.mjs`.
O executor Windows em `dev-update.cjs` **não altera a árvore ativa**:
consulta `main` após abrir a interface, materializa uma candidata isolada,
valida commit/origem/ancestralidade e compatibilidade, ativa no próximo
início e conserva a anterior. Uma candidata sem recibo de saúde é revertida;
o rollback Owner mantém pin até desfixação explícita. O supervisor do emulador
não executa mais Git merge no aplicativo Desktop. O journal local guarda
apenas o estado de transação, **não** define outra política, versão ou registro
de componentes. O Desktop instalado comprovou `main → pendingSha →
attemptedSha → health → activeSha` e a projeção compartilhada
`ordax.update-status/1` respondeu `running/idle` para a revisão efetiva.
Isso prova a atualização Dev do conteúdo OS/Surface, **não** a paridade
completa do `ordax-pull` USB ou o upgrade automático do shell Electron.

**MVP/Stable** não pode depender de Git; precisa de distribuição assinada
do aplicativo e componentes com release verificada, staging, health e
rollback, mantendo identidade/versionamento canônicos. **MVP no Windows
não está implementado neste build**.

As políticas de atualização não pertencem ao Electron e não podem gerar
um segundo update registry, uma segunda versão dos apps ou outra origem de
código. Artefatos e executores de instalação são específicos da plataforma.

## Testes e promoção

```sh
node --test tests/test_desktop_network_status.mjs
node --test tools/windows-desktop/runtime.test.cjs tools/windows-desktop/checkout.test.cjs tools/windows-desktop/dev-update.test.cjs tools/windows-desktop/surface-stage.test.cjs tools/windows-desktop/native-build.test.cjs
```

A CI verifica o processo Electron instalado, a Surface realmente montada, o runtime imutável e a porta de rede. O instalador alpha.6 passou esse gate: 83,4 s de instalação e 6,5 s de startup no runner Windows, sem promessa de tempo universal.
Homologação exige, além disso, Conta, internet real, armazenamento, apps,
Intelligence com inferência real, update Dev/MVP e rollback E2E no Windows
instalado. O fato de o bootstrap/USB e Desktop consumirem código Git idêntico
não prova atualizações equivalentes.

**Não mesclar/promover até esses gates; nunca sobrescrever o USB por
atualização do app Windows.**

### Alpha.6 — evidência

CI Windows [#39446071435](https://github.com/ordaxsystems/ordax-os/actions/runs/39446071435) passou NSIS, read-only, rede Desktop e Native montada. Instalação 83,4 s e startup 6,5 s no runner. A porcentagem do instalador e o canal MVP assinado continuam pendentes. O materializador Git só ficará operacional contra `main` após o contrato Desktop ser integrado à fonte oficial, sem promover a PR inacabada.

## Dependências Node no instalador de desenvolvimento

O instalador Windows mantém o Vite necessário para compilar, com verificação, uma
nova revisão da mesma Surface. `runtime-toolchain.cjs` projeta somente o
fechamento canônico de `package.json` + `package-lock.json`, incluindo os
opcionais nativos da plataforma. **O pacote NSIS não materializa milhares de
arquivos individuais em Program Files**: transporta
`runtime-template/toolchain/node_modules.tar.gz` e
`toolchain-receipt.json` contendo SHA-256 do arquivo, SHA-256 do lock e
digest da árvore de arquivos. Não existe um segundo lock nem fonte visual.

O Native compilado inicia sem extrair Vite. Somente uma compilação Owner/Dev
(ou fallback explícito de uma versão Git antiga) chama o adaptador único
`toolchain-cache.cjs`, que verifica arquivo e recibo, nega traversal/links,
extrai para `userData/runtime-toolchains/<archive_sha256>` e verifica o digest
da árvore expandida **inclusive nas reutilizações**. A reutilização também
recusa o diretório final se for um link simbólico, junction/reparse point ou
arquivo comum, mesmo quando um destino externo tenha os bytes e recibo
corretos. Essa fronteira é testada no Windows real, sem tocar no perfil do
usuário. O cache não contém fonte
canônica nem cria nova política de atualização: é projeção descartável da
distribuição instalada. Jamais escreve dependências em Program Files ou
precisa buscar npm na rede para construir uma candidata Dev.

O smoke NSIS deve provar instalação e upgrade com archive protegido contra
escrita, seguido de compilação real de duas revisões OS/Surface usando somente
essa fonte offline, além de rollback, Surface e autorizações intactos.
Os tempos de CI são apenas métricas comparativas, **não** medição física
no Desktop do usuário. Se essas provas não forem aprovadas, o PR não deve
ser promovido.
