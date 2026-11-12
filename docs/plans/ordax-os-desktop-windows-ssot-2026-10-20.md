# OrdaX OS no Windows — paridade de produto e SSOT (20/10/2026)

**Decisão Owner:** O instalável Windows de desenvolvimento não é uma demo da
Surface. Ele é um **host do mesmo produto OrdaX**, executado sobre Windows.
A única diferença autorizada é a implementação de capacidades de plataforma:
não instala kernel Linux, não faz boot/UEFI e não assume controle do hardware
do sistema hospedeiro. **Ele deve ter Internet.**

Este documento fixa o escopo da PR #2040 e evita que os próximos agentes
interpretem "Surface compartilhada" como paridade funcional. É um plano
de entrega verificável, não uma declaração de prontidão.

## Única autoridade

- Source e componentes: `system/contracts/`, `system/services/`,
  `system/apps/`, `system/surface/` e `system/composition/`.
- Adaptação Windows: **somente** `system/adapters/desktop/` e o shell mínimo
  `tools/windows-desktop/`. Sem `apps-windows`, `surface-windows`,
  `intelligence-windows`, second account service ou duplicate update policy.
- As cinco modalidades da família definidas em `docs/PRODUCT-MODES.md`
  continuam válidas. Este host é a materialização Windows do modo `desktop`,
  **não** um sexto produto/modo.
- Contracts canônicos: `docs/contracts/product-capabilities.json`,
  `docs/contracts/distribution-profiles.json`,
  `docs/contracts/update-nomenclature.json`,
  `system/contracts/update-status.mjs`, `system/contracts/product-family.mjs`.
- A versão do **instalador Windows** é distinta da versão do **OS**, dos
  componentes e da Entrega. O instalador alpha não autoriza uma release pública.

## Dev e MVP: uma política, dois canais, executores específicos da plataforma

| Perfil | Fonte | Contrato de segurança | Ativação Windows |
| --- | --- | --- | --- |
| Owner/Development | `ordaxsystems/ordax-os` `main` | origem/branch/SHA exatos, checkout íntegro, atualização staging + ativação transacional, known-good, health e rollback/pin; sem perda de dados | mecanismo Windows adaptado ao **contrato real** do `bootstrap/dev-base/ordax-pull`, `system/supervisor` e `docs/DEV-USB-GIT.md` |
| Stable/MVP | release OrdaX autorizada | artefato assinado, integridade/proveniência, aquisição e ativação/rollback verificadas; **Git não é dependência do MVP** | atualização assinada do pacote Windows + componentes internos compatíveis; nenhum flash/boot involuntário |

O código Linux `ordax-pull` não pode ser executado como shell nativo
Windows. **Compartilhar a política não implica copiar o executável.** Um
executor Windows deve satisfazer os mesmos gates observáveis e devolver o
mesmo contrato `ordax.update-status/1`; nunca chamá-lo de `ordax-pull`
homologado antes da prova de staging, pin, health, rollback e recovery.

O atual `tools/windows-emulator/dev-supervisor.mjs` usa `git merge
--ff-only` na árvore ativa: **NÃO É equivalente ao Pull Owner USB atômico**.
Ele permanece temporariamente como ferramenta de desenvolvimento, não
autoridade da distribuição Windows. O modo MVP não deve usar esse polling.

## Paridade — critério funcional, não presença de arquivo no ZIP

| Capacidade do mesmo OrdaX | Fonte SSOT | Windows exigido | Estado comprovado da alpha.2 |
| --- | --- | --- | --- |
| Surface, Central, First Run, Design, apps | `system/surface`, `system/apps`, `system/composition` | UI e comportamentos reais | apresentação e persistência limitada; não é E2E completo |
| Internet e estado da rede | `ordax.network-status/1`, `network.https` | HTTPS utilizável e observações reais; controles Wi-Fi Windows só sob suporte explícito | adaptador status read-only incluído nesta PR, E2E instalado em CI pendente |
| Conta OrdaX/Spaces/sync | `system/services/account`, `system/services/spaces`, `system/services/sync` | sessão real, seguro dispositivo, logout/revogação, reabertura | indisponível / não homologado |
| Arquivos, navegador, notas, app data, Store | `system/apps`, `system/services` + contratos | mesma UI/serviços, portas Windows reais e seguras | não homologados; interfaces sozinhas não contam |
| Intelligence, Assistant, Memory, modelos locais | `system/services/intelligence`, `system/services/local-ai` | motor e pesos Windows verificados, mesmo router/memory; prova de inferência offline | sem motor/modelo Windows; IA operacional ausente |
| MCP/Device Agent e permissões | OrdaX Platform/Runtime existentes | conexão account-bound e grants canônicos; sem novo executor | não integrado no shell |
| Updates Dev e MVP | `docs/DEV-USB-GIT.md`, contratos de update/release | staging/health/rollback por perfil com histórico real | Git Dev simplificado; MVP ausente |
| Wi-Fi, bateria, notificações, sistemas de arquivos | capacidades em `docs/contracts/product-capabilities.json` | APIs Windows mediante consentimento/política; leitura antes de mutação | não homologados |
| Kernel/boot/recovery/UEFI | Linux USB/Native | **não aplicável** ao host Windows; não exibir controles falsos | não aplicável |

Uma capacidade pode ficar indisponível **apenas** quando o host não a suporta
ou quando o gate de segurança/produto não está pronto. Isso não autoriza
remover sua UI, duplicar sua implementação ou afirmar que o OS está completo.

## Gates por prioridade

1. **Fechar o instalador e o boot:** medir tempo por etapa, arquivos,
   CPU/I/O, etapa/progresso real do NSIS; resolver travas, reduzir somente
   dependências comprovadamente desnecessárias, preservar upgrade e userData.
   Ao final exibir resultado verificável, nunca só uma animação percentual.
2. **Host Windows canônico:** compor cada porta usada por `system/composition/native`
   através de `system/adapters/desktop` ou cliente compartilhado; medir
   disponível/indisponível em uma matriz automatizada. Nenhum placeholder
   pode retornar sucesso.
3. **Conta/Internet/Apps:** login real e persistência autorizada;
   navegador isolado; arquivos com escopo/consentimento; app data; apps
   Native e Space/Sync. Testar reinicialização, offline e negação.
4. **Intelligence:** usar o router `ordax.intelligence/1` e backend
   `ordax.local-ai/1`, com engine/modelo Windows de proveniência
   verificada; testar prompt/response reais offline, cancelamento e saúde.
5. **Atualizações:** portar semântica Owner Dev de candidata atômica,
   verificação e rollback; implementar release MVP assinada sem Git.
   Validar edição na `main` → alteração ativa no Windows e no USB Dev
   por seus canais (físico USB exige gate e autorização próprios).
6. **Gate final:** CI Windows instala um build protegido contra escrita,
   reabre o app, percorre UI real e executa testes de cada capacidade;
   comparação com USB e contratos canônicos; crash/recovery/rollback;
   zero regressões. Somente então remover draft e avaliar promoção.

## Proibições e evidência

- Não sobrescrever pendrive, alterar disco interno, iniciar reflash nem
  mesclar PR inacabada para fazer um teste "passar".
- Não embutir localhost de modelos sem isolamento, credenciais na UI,
  executar terminal arbitrário como autoridade de app, nem transformar
  login em acesso de computador sem OAuth/permite/grants.
- Não usar `npm run emulator:windows` como substituto de teste de pacote
  instalado. A versão alpha.2 provou boot HTTP e pacote, mas não essa matriz.
- Relatar commits, CI, hashes, passos E2E e **gaps remanescentes** por recurso.

## Continuação implementada — 20/10/2026, Desktop Dev alpha.5/alpha.6

A implementação Windows **não** pode reaproveitar o antigo `git merge
--ff-only` na árvore em execução. O caminho real desta PR agora usa
`tools/windows-desktop/dev-update.cjs` como executor **Windows** da política
Owner Dev, sem criar outro OrdaX e sem tratar esse journal como uma nova
versão de produto.

- Durante o boot, nenhuma aquisição Git é iniciada: abre-se imediatamente
  a última árvore válida ou o snapshot offline. As operações remotas são
  adiadas até depois da montagem da Surface.
- Candidatas são obtidas exclusivamente de `ordaxsystems/ordax-os` `main`,
  com Git partial+sparse e histórico suficiente para verificar fast-forward.
  O material é escrito em `runtime-versions/<SHA>`, jamais sobre os
  arquivos ativos; não há `reset --hard` nem substituição de pastas
  existentes do usuário.
- Journal **técnico local** `desktop-dev-update-state.json` registra
  `activeSha`, `previousSha`, `pendingSha`, `attemptedSha`,
  `pinnedSha` e `rejectedSha`, sem assumir autoridade de Entrega, SemVer,
  produto ou release; a projeção pública deve permanecer o contrato
  `ordax.update-status/1`, cuja ponte Windows ainda falta.
- Uma tentativa sem recibo de saúde é rejeitada no próximo boot e a
  árvore anterior é preservada. Rollback manual exige versão anterior
  verificada e mantém pin; desfixação é explícita.
- O Electron agora fixa seu `userData` em
  `%APPDATA%\\OrdaX OS Desktop Dev` **antes** do lock de instância única,
  para não criar perfis conflitantes ao atualizar o próprio shell.
- O Supervisor do emulador mantém seu fluxo de desenvolvimento separado;
  no Desktop instalado, ele não faz `merge` na árvore ativa.
- O teste de instalação agora verifica **montagem visível** da Surface
  (`#ordax-root` preenchido e boot `ready`), em vez de se contentar
  com HTTP 200.

**Evidência:** no DESKTOP-COHT67R, bateria isolada passou 13/13
testes Node/Git, repetida via OrdaX MCP com retorno zero. CI alpha.5
[#39444466912](https://github.com/ordaxsystems/ordax-os/actions/runs/39444466912):
build e `INSTALL_SMOKE=PASS` em 94 s, mas
`STARTUP_SMOKE` **falhou** por ausência do recibo esperado dentro de
180 s. O log canônico não apareceu no caminho monitorado, portanto a
causa foi tratada como não comprovada, não como simples lentidão da UI.
A correção do diretório estável e o timeout precoce estão na alpha.6;
CI [#39446071435](https://github.com/ordaxsystems/ordax-os/actions/runs/39446071435)
em execução no momento deste registro.

**Ainda pendente:** staging contra `main` real e ativação de candidata
no executável instalado (após contrato v1 estar na main), renderer E2E
Windows, redução da demora de instalação e porcentagem verdadeira,
Conta/Apps/Intelligence local e distribuição **MVP assinada sem Git**.
Nenhuma release Stable foi autorizada, nenhuma alteração USB foi feita.


## Evidências Owner no notebook — 20/10/2026, alpha.19 (não homologada)

Verificação física no **DESKTOP-COHT67R** com perfil per-user em
`%LOCALAPPDATA%/Programs/OrdaX OS Desktop Dev`. O artefato da
[CI #39516457717](https://github.com/ordaxsystems/ordax-os/actions/runs/39516457717)
foi transferido e teve SHA-256 local
`b0a5647f5c9fd1c4a0a0172034ed97e7fc22105b18b2b1d81b87d1b7a1505e7d`.
O executável `0.1.0-alpha.19`, `app.asar`, a Surface compilada e
`desktop-host-contract.json` estão instalados; NSIS registrou
`install-files-complete`. **O processo de instalação silenciosa não foi
observado terminando no limite de 300 segundos**, embora os arquivos tenham
sido materializados e o processo tenha posteriormente desaparecido. O
tempo/exit code/upgrade do NSIS no notebook continuam um gate separado.

O **executável instalado** foi iniciado e registrou `Native shell mounted
and ready` e `Native Surface ready`, com primeiro uso apresentado.
Respostas observadas no host nativo:

| Endpoint | Resultado |
| --- | --- |
| `/__ordax/native/network-status` | HTTP 200; Ethernet conectada e interfaces reais |
| `/__ordax/native/metrics` | HTTP 200; métricas reais do Windows |
| `/__ordax/native/update` | HTTP 200; `sourceSha: bundled-desktop`, `status: unavailable`, `phase: blocked` |
| `/__ordax/native/network` | HTTP 503; gerenciamento de rede não provido |
| Outras portas nativas (sessão local, teclado, display, recovery) | 503 observados; paridade ainda pendente |

**Navegação HTTPS real:** um segundo processo Electron em perfil de teste
isolado (`ORDAX_DESKTOP_TEST_PROFILE=1`), usando a mesma implementação
`browser-host.cjs`, recebeu `tab.open` por
`window.ordaxDesktopBrowser.postMessage`. Uma `WebContentsView`
navegou para `https://example.com/`; inspeção da própria WebContents
confirmou `origin: https://example.com`, `title: Example Domain`,
`document.readyState: complete` e corpo legível. O script isolado
apresentou um **falso negativo** apenas por procurar uma frase no corpo
que o site não mais inclui; os dados capturados confirmam HTTPS dentro do
navegador real. Esse teste não prova controles Wi-Fi/Conta/Intelligence.

**Atualizações Dev:** na consulta oficial, a `main` estava em
`24198ec84e37da6ac612b5c7287e125d26bec73a`, mas sem
`tools/windows-emulator/desktop-host-contract.json`.
O Desktop **corretamente recusou ativação** e persistiu
`incompatibleSha`; não está na última `main`. No notebook, a limpeza
imediata do Git staging deu `EPERM` mesmo depois de retries; um
diretório órfão foi removido mais tarde sem alteração de permissões.
O defeito está na separação entre **decisão transacional e limpeza
eventualmente possível no Windows**, não na disponibilidade de Internet.

**Correção proposta, ainda não instalada:** commits `6f28a8d` e
`fbbbe79` desacoplam limpeza de decisão, introduzem varredura de
candidatas envelhecidas nomeadas por UUID, evitam exclusão de versões
ativáveis e conservam veredito de SHA incompatível. **9/9 testes Node/Git
aprovados no Windows real**; [CI #39522600506](https://github.com/ordaxsystems/ordax-os/actions/runs/39522600506)
aprovou testes, build, instalador, upgrade e startup. Como o executável
instalado é da CI anterior, **a correção de lifecycle não foi ainda
comprovada no binário instalado**.

Gates restantes: evidenciar encerramento do NSIS no notebook, portar a
paridade nativa de serviços/Conta/Intelligence, publicar um contrato
Desktop compatível na `main` **somente após autorização de merge e gates
reais**, provar SHA ativo após staging e health, e homologar os canais
Owner Dev / MVP assinados separadamente. Sem promoção Stable/MVP e
sem intervenção no USB.
