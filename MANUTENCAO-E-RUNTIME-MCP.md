# ORDAX — Manutenção verificável, OrdaX Pull e Runtime MCP no USB

> Estado: contrato de implementação. **Não** constitui certificação de boot, reparo físico ou acesso remoto ativo.
> Autoridade: GitHub `main` para software Owner/Development; Base A/B e firmware continuam com seus gates próprios.

## 1. Estado inicial comprovado (2026-10-20)

- USB físico identificado no Windows: **Lidermix, serial 6699E36B, Disco 1, 8 GB**; disco interno WDC é Disco 0. A última leitura física certificada mostrou checkout `164a7b8d`; **não** há prova de que o dispositivo recebeu as alterações de energia da PR #2048 ou a `main` mais recente.
- O `ordax-pull` **manual** já executou transações físicas Git de ponta a ponta com checkout e helpers confirmados e ext4 íntegro. **Ainda não** foi aprovado o ciclo automático `Supervisor → Git remoto → candidato → Pull → health → Surface` no próprio notebook.
- Evidência de hardware: Surface inicializou no notebook em `164a7b8d`. Histórico diagnóstico registra `pull-remote-discovery-failed`; SHA remoto estava visível. A causa exata do Git no notebook ainda exige stderr classificado e prova de fallback do commit previamente obtido.
- Registro persistente de energia `/state/ordax/power/last-request`: `shutdown|<boot-id>|1792515039|failed`, falha cerca de 12s após a solicitação. O Guardian possuía limite de quiesce de 12s, inferior às esperas seriais da Surface; PR #2048 altera o orçamento e o encerramento concorrente, mas **sem boot físico certificado**.
- O diagnóstico local `bootstrap/dev-base/ordax-diagnose` é read-only; o `ProductDevicePostLoginCoordinator` ainda publica `remoteActionsEnabled: false`. Ter dispositivo inscrito não significa controle remoto MCP habilitado.

## 2. Arquitetura canônica — responsabilidades únicas

| Autoridade | Faz | Não faz |
| --- | --- | --- |
| `ordax-dev-init` | prepara Base e EFI, verifica rollback antes de iniciar runtime | aplicar Git do runtime ou conceder permissões MCP |
| `system/supervisor` | observar `main`, adquirir commit, classificar mudanças, invocar Pull e verificar saúde | duplicar o motor de Git ou manipular disco bruto |
| `bootstrap/dev-base/ordax-pull` | Git fast-forward, staging isolado, troca de checkout, atualizar helpers via owner, recibo de fase | atualizar kernel/ESP diretamente, redefinir usuário, executar comandos MCP |
| `Guardian` | coordenar energia, finalizar processos, persistir comprovantes, executar kernel shutdown/reboot | aceitar HTTP 202 como prova do desligamento |
| `ordax-diagnose` + Maintenance | reunir recibos seguros, saúde, DNS, Base/EFI, energia, recursos | modificar dispositivo no modo somente leitura |
| `Device Agent` + Product MCP/Cloudflare | identidade, pareamento, concessões, revogação, auditoria, relay de ordens allowlist | prometer acesso por mera presença na conta |
| Owner de Base A/B | adquirir e validar bytes imutáveis, preflight UEFI, staging inativo, testes de boot/rollback | reflashear disco interno ou armar BootNext sem gates |

Nenhum segundo Supervisor, Git Pull, armazenamento de grants ou serviço de autorização deve ser criado.

## 3. Centro de manutenção nativo

Uma única experiência em **Sistema → Manutenção** e uma CLI `ordax-diagnose` devem apresentar exatamente os mesmos recibos de fontes canônicas. Estados: **aprovado**, **falhou**, **pendente**, **não executado** e **não demonstrável**. Nunca converter ausência de dados em sucesso.

Inventário obrigatório: identificador de boot, versão exata de checkout/helper/Base/Surface, livre ext4, recibo de First Run, rede/DHCP/DNS/Git TLS (sem credenciais), Sup/Guardian/Native liveness, transação Git por fase, hash do snapshot A/B, EFI preflight, energia com `last-request`, e estado de pareamento MCP. Agregar resultados estruturados em `/state/ordax/maintenance/runs/<id>.json` via arquivo 0600, gravação temporária por PID + rename atômico, tamanho/retention limitados; nunca copiar tokens, senha Wi-Fi, cabeçalhos HTTP ou URLs autenticadas.

**Três modalidades**, sempre explícitas: `check` (somente leitura, disponível offline), `verify` (testes sem efeito destrutivo: rede, Git LS-remote, presença dos atores e staging isolado), `repair` (somente ação allowlist e autorização local do Owner; exige backup/rollback e plano de recuperação). Exibir erro, fase, duração, origem e SHA no mesmo painel.

## 4. Prova ponta a ponta do ordax-pull

O CI deve usar repositório Git `main` **local e descartável**, um checkout degradado em workspace isolado, rede simulada ou relay de Git, e o **script real de produção**. Testar:

1. sem First Run completo: nenhum Pull automático;
2. First Run pronto + Surface saudável: Supervisor consulta remoto;
3. candidato já obtido pelo Supervisor: ativar usando apenas objeto verificado, sem segunda consulta HTTPS;
4. DNS/TLS/timeout/offline: códigos precisos, nenhuma mutação de checkout, retry com backoff delimitado;
5. candidato novo: fetch bounded, FF ancestry, staging, atualização de helpers e recibo `HEAD=current-commit=dev-helpers-sha`;
6. checkout incompleto, SIGKILL em cada estágio, pouco espaço, falha de helper, disputa de locks, queda da rede: jamais perder known-good;
7. alteração de `system/surface`: health e recarga/restart seletivo; rollback no erro;
8. alteração Base/kernel: **não** trocar bytes ativos, encaminhar à Base A/B e bloquear promoção sem boot real e comprovação de saúde;
9. integridade após Pull: fsck desmontado e USB correto identificado por serial, sem supor `/dev/sde` estável;
10. teste físico: no notebook, confirmar `main` no runtime, funcionamento automático após reconnect, rede e UI; guardar witness do próprio boot.

O ensaio em Windows/WSL deve operar por padrão em `--read-only`. `--apply-to-usb` requer serial exato, offline do OrdaX, ext4 limpo, espaço livre, candidato aprovado na `main`, consentimento Owner e prova posterior. O mesmo `ordax-pull` oficial deve fazer a escrita; nunca `git reset --hard` em dados pessoais nem um flash Creator disfarçado.

## 5. Runtime remoto através do Product MCP

O mesmo Device Agent nativo do OrdaX deve iniciar **na Base (antes da Surface gráfica)** para que o notebook continue administrável quando Cage/WebKit ou Wi-Fi da UI falhar, mas a falha do Agent **não pode impedir boot ou recuperação**. No MVP: heartbeat/discovery/health, leitura de diagnóstico, invocação de testes isolados e `request-pull`; ações de escrita exigem grants explícitos da conta logada, escopo por dispositivo e sessão, expiração, revogação, recibo e validação local.

Canal: conexão **de saída** TLS autenticada ao control-plane Cloudflare existente, sem porta SSH/MCP pública no notebook e sem credenciais embutidas na imagem. O plugin usa OAuth do Product MCP e invoca ações versionadas do Device Agent. Nem login, nem presença, nem `remoteActionsEnabled` false concedem execução remota.

Capacidades iniciais: `maintenance.status.read`, `maintenance.tests.run`, `updates.inspect`; `updates.pull.request` somente Owner e com gates; ações de Base/EFI, disco bruto, desligamento e remoção de arquivos requerem controle próprio e confirmação separada. Toda chamada deve carregar `account/device/actor/client/grant/nonce/request-id/expiry`, validação anti-replay e recibo append-only, sem duplicar as políticas do OrdaX.

Teste de ativação do MCP: autenticar conta no OrdaX, parear via Device Agent, conceder uma capability, consultar estado por plugin, revogar grant e provar rejeição imediata; repetir com Surface desativada e rede reconectada; garantir que tokens não vazam em logs. **Não anunciar acesso remoto ativo antes disso.**

## 6. Ordem de entrega e gates

1. Fechar regressões específicas de Guardian/Surface (PR #2048) e fazer primeiro teste de shutdown/restart em namespace isolado; não executar desligamento real pelo agente remoto.
2. Unificar esquema de receipts de Pull, energia, Base, rede e dados de manutenção sem criar mecanismo paralelo.
3. Executar matriz E2E CI do Pull e reparo de cenários controlados, com cobertura de falha e recuperação.
4. Implementar Device Agent mínimo no substrato Dev, conectar a grants canônicos do Product MCP e provar revogação e fail-soft.
5. Atualizar USB físico **somente após gates** com `ordax-pull`, confirmar CRC/recibos/commit, devolver ao Windows íntegro.
6. Reiniciar OrdaX pelo USB e provar, no notebook, Pull automático + energia + manutenção + MCP. Só então declarar produto aprovado.

## 7. Critério de encerramento

Não marcar `ordax-pull corrigido`, `desligamento corrigido` ou `Runtime MCP liberado` com base apenas em patch, PR integrada, HTTP 202, teste de namespace ou USB atualizado por Windows. Cada declaração exige **prova no fluxo físico real** e artefato verificável guardado no OrdaX. Falhas são apresentadas com fase exata, sem esconder atraso com timeout de interface.


## 8. Evidência física — Lidermix USB Dev (2026-10-20)

Este registro substitui **somente** o estado da mídia relatado no item 1. Os gates de boot físico e MCP permanecem pendentes.

- Host de reparo: `DESKTOP-COHT67R` via Remote Desktop Commander, com Git e Linux WSL de manutenção. Mídia positivamente identificada no Windows como **Lidermix, serial `6699E36B`**, Disco 1, USB 8.053.063.680 bytes; disco interno WDC, Disco 0, não utilizado como destino de gravação.
- Partições existentes mantidas: ESP FAT32 256 MiB, ORDAX ext4 cerca de 6,2 GiB, ORDAX-DATA exFAT cerca de 1 GiB. Nenhuma formatação, novo flash Creator nem gravação na ESP.
- Antes do reparo: checkout físico `164a7b8d51662149e0414412bed2f849a091df36`, origin canônico, árvore Git limpa, marcador `pinned-commit` ausente. Uma verificação desmontada `e2fsck -fn` encontrou órfãos/inconsistências no ext4 (código 1).
- Segurança: imagem de recuperação local da partição ORDAX criada no Windows com `e2image -ra` **antes** do reparo, sem upload público; comprimento lógico igual ao da partição. Leitura `e2fsck -fn` da imagem reproduziu as inconsistências pré-reparo. Não foi executado teste de restauração completo dessa imagem.
- `e2fsck -p` recuperou journal, mas recusou inconsistências adicionais. Reparação interativa `e2fsck -f` aceitou as correções propostas para lista de órfãos e contadores/bitmaps; após reparação, `e2fsck -fn /dev/sde2` aprovou as cinco etapas com código 0.
- Atualização por `/usr/local/bin/ordax-pull` **real**, dentro do ambiente de sistema da partição física, sem bypass do dono canônico: saída `checkout atomico ativado`, `ORDAX_DEV_HELPERS_SHA=c0293cbf6315753e23fc5b1d0164313482d2eae6`, `ORDAX_SOURCE_SHA=c0293cbf6315753e23fc5b1d0164313482d2eae6`, código 0. Após atualização, `git HEAD`, `/state/ordax/current-commit` e `/state/ordax/dev-helpers-sha` coincidiram no SHA completo; `previous-commit` preservou `164a7b8d...`; `pull-result=completed`, árvore limpa, sem pin de rollback.
- `ordax-remote` foi instalado como helper, mas **não** existe prova de sessão autorizada, dispositivo pareado ou capacidade MCP ativa. A consulta pelo plugin ainda retorna `product_targets_unavailable`.
- Fechamento: `sync`, desmontagem do bind `/dev`, desmontagem ORDAX, `e2fsck -fn` pós-Pull **código 0**, `usbipd detach --busid 4-1` código 0; Windows reconheceu o mesmo dispositivo e mostrou `ORDAX-ESP` e `ORDAX-DATA` saudáveis.
- Prova isolada adicional no WSL, em checkout descartável da mesma `main` (`c0293cbf...`): `test_dev_pull_expected_sha.py` 2/2, `test_dev_pull_helper_refresh_contract.py` 3/3, `test_owner_supervisor_real_git_discovery.py` 2/2, `test_dev_main_watch_single_owner.py` 5/5, `test_dev_base_helper_refresh.py` 6/6. **Total 18/18**. Estes são testes host-side, não E2E de boot físico.

### Gates ainda abertos

1. **Boot físico** do USB atualizado: prova da montagem da Surface, rede e First Run, versão efetivamente executada e ativação dos helpers depois do reboot.
2. **Pull autônomo**: confirmar `Supervisor/main-watch -> Git -> Pull -> ativação saudável` após mudança real de `main` ou reconexão, sem disparo manual no WSL.
3. **Energia física**: desligar e reiniciar via interface e botão ACPI, observando retorno de kernel e estado `last-request`; não aceitar HTTP 202 como sucesso.
4. **Runtime MCP**: ativação por identidade/grant canônicos, consulta remota de `ordax-diagnose`, revogação testada e falha da Surface não comprometendo canal, sem agentes paralelos.
5. **Base e Creator**: validar separadamente kernel/initramfs/ESP e o workflow Creator; sucesso do Git Pull não prova promoção Base A/B.

**Não declarar OrdaX OS integralmente corrigido nem Pull automático certificado antes desses cinco gates.** O USB está atualizado quanto ao checkout Git e helpers no instante do teste e seu ext4 foi verificado após a atualização.
