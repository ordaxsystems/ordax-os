# Development Workflow

Status: CANONICAL FOR PROTOTYPE


## Regra operacional transversal — Evolução Rápida (DEV, 2026-11-04)

**Princípio:** entregar o que foi pedido primeiro; validar o resultado com o menor conjunto suficiente de provas, depois. Esta é uma regra de trabalho para todos os owners/repositórios OrdaX em desenvolvimento, inclusive quando o operador disser apenas `continue`. Não altera limites de segurança, gates obrigatórios de promoção ou autoridade de cada repositório.

1. **Localizar sem reabrir auditoria:** confirmar somente o owner, o arquivo/fluxo afetado, a revisão atual e o bloqueio concreto. Reutilizar diagnósticos, commits, testes e artefatos já válidos; não fazer inventário integral, pesquisa ou planejamento novo para uma tarefa simples.
2. **Executar imediatamente:** criar, editar, substituir ou remover no lugar canônico e fechar o menor fluxo funcional completo. Não gerar funcionalidades, registries, wrappers, documentação, tarefas ou infraestrutura adjacentes sem dependência comprovada. Se o pedido é escrever um alfabeto até Z, escrever um alfabeto até Z — não dez variações nem dez workflows.
3. **Validar depois, proporcionalmente ao impacto:** alterações triviais de texto/configuração exigem apenas checagem pertinente; código exige os testes direcionados da área afetada; integração exige smoke/E2E do fluxo alterado. CI amplo, rebuild de kernel/USB/Creator, testes físicos e repetição de suites só quando uma dependência real, contrato aplicável ou gate de merge/release exigir. Não criar workflow/teste novo para repetir cobertura existente.
4. **Encerrar a entrega:** corrigir a causa raiz de defeitos no escopo, verificar o resultado utilizável e integrar na `main` quando os gates aplicáveis permitirem. Evitar PRs/branches paralelas e pendências artificiais. Em `continue`, retomar a última mudança ou bloqueio real e avançar código/integração, não reiniciar relatórios.
5. **Conter desvios:** classificar CI vermelho alheio como externo somente após demonstrar que não depende do change set; corrigi-lo em seu owner sem transformar a tarefa atual em reforma de outro domínio. Melhorias opcionais não bloqueiam o objetivo; não criar fila paralela para elas.
6. **Comunicar entrega, não atividade:** reportar exatamente o que foi alterado, teste pertinente, revisão/PR e se está na `main`/remoto. Se impedido, identificar **um bloqueio concreto** e a ação necessária; nunca declarar finalizado o que só foi planejado ou documentado.

### Como decidir os testes sem atrasar a entrega

| Impacto real da mudança | Ação padrão em desenvolvimento |
| --- | --- |
| Texto, comentário, documentação, CSS ou ajuste visual isolado | Editar imediatamente; conferir o trecho/preview afetado, sem suíte completa, build de release ou novo workflow. |
| Código/comportamento de um único owner | Implementar no source canônico; executar testes existentes e direcionados; corrigir somente falhas causadas pelo diff. |
| Integração entre componentes | Concluir o fluxo vertical solicitado; depois executar smoke/E2E específico das interfaces modificadas. Reutilizar artefatos válidos. |
| Identidade, segurança, trust, dados, disco, boot, update, pagamentos ou promoção | Fazer antes da mutação os preflights realmente exigidos; depois aplicar testes e gates obrigatórios pertinentes. Não dispensar autorização nem integridade. |

### Protocolo anti-loop e critério de parada

- **Sem preparação infinita:** uma verificação objetiva de estado/owner deve produzir uma alteração ou identificar um impedimento comprovado. Não reiniciar a mesma auditoria após um resultado sem mudança no source ou no ambiente.
- **Sem trabalho artificial:** não criar planos, RFCs, novos testes, workflows, relatórios, branches, PRs ou arquivos de evidência só para demonstrar diligência. Usar os instrumentos existentes; criar um novo apenas se a entrega ou uma obrigação concreta exigir.
- **Sem efeito cascata:** falha fora do diff não autoriza migrar a missão para outros domínios. Corrigir no owner certo quando for dependência real; caso contrário, manter escopo e registrar apenas o bloqueio indispensável.
- **Sem recompilar por hábito:** mudanças em client/Surface não disparam kernel/USB/Creator/QEMU por padrão; cache e resultados imutáveis aprovados devem ser reaproveitados.
- **Sem parar em análise:** ao descobrir a causa de um defeito em escopo, corrigir o código existente; não substituir a correção por explicação, issue ou documentação.
- **Sem concluir por aparência:** só marcar entregue quando existir diff/artefato real, validação proporcional e integração/publicação requerida; caso a proteção da main ou gate exigido impeça, informar PR, estado e único bloqueio verificável.
- **Em pedidos de continuação:** retomar a última mudança incompleta no mesmo owner/PR; não abrir etapa lateral nem reiniciar a investigação sem evidência nova.

**Exceções não negociáveis:** antes de uma ação que possa ser destrutiva, vazar dados, alterar identidade, permissões, trust, assinatura, atualização/recovery, pagamento ou promoção pública, executar os preflights e obter as autorizações pertinentes. Não burlar proteção de branch, checks realmente obrigatórios, rollback, integridade, segurança ou fail-closed. Quando há risco, a verificação preventiva necessária antecede a execução; não serve de justificativa para auditorias ou builds sem relação causal.

**Critério de sucesso:** o pedido produz um comportamento/artefato observável e validado no owner correto, não uma coleção de planos, evidências e workflows sem entrega.


## P0 — Native MCP no Windows/Desktop DEV (31/10/2026)

**Atualização de handoff (04/11/2026):** o código do Capability Fabric v1
já foi integrado (OS PR #2406). Consultar
[`docs/CAPABILITY-FABRIC.md`](CAPABILITY-FABRIC.md) e o estado atual
antes de aplicar as instruções de 31/10 abaixo. Descoberta semântica
não significa execução MCP; OS #2400, Runtime, Platform, grants e
recibos reais mantêm gates próprios. **Este bloco preserva o histórico
DEV**, não autoriza substituir versões, instalar agentes ou repetir
processos enquanto não houver verificação do estado atual e owner.

**Missão canônica:** provar o mesmo `ordax-runtime` no OrdaX OS Desktop
instalado no Windows **e**, depois, no agente auxiliar Windows com outra
identidade Product Device. Prova DEV antes de assinatura de produção.
A Platform, OAuth/grants, Worker e Supervisor existentes são as únicas
autoridades. Não criar Runtime, dispatcher, CLI, banco, sessão, workflow ou
instalador paralelo.

**Estado comprovado em `DESKTOP-PNUHUA0`:**
- Desktop NSIS oficial já atualizado; um único Runtime DEV existente
  iniciado pelo Supervisor, com processo principal + subprocesso PyInstaller.
  O Device `OrdaX Desktop (DESKTOP-PNUHUA0)` ficou online na Platform.
- OAuth Owner do cliente ChatGPT exato e grant `computer-observe` por 1 dia
  foram concluídos. A seleção Owner de um challenge foi aceita pelo sistema,
  e uma chamada MCP real `computer.access_status` chegou ao Runtime, mas
  recebeu `action not allowed: computer.access_status`. Portanto conexão e
  resposta remota foram **provadas**, sucesso da leitura ainda não.
- Causa no owner Runtime: a antiga lista permitia só `agent.status`.
  [ordax-runtime#282](https://github.com/ordaxsystems/ordax-runtime/pull/282)
  foi integrada à Runtime main (commit `726f41f77897aed7bdadbf4a7865a9aeca032f9c`)
  e limita o Desktop a **exatamente** `agent.status` +
  `computer.access_status`; não há terminal, escrita, clique, GUI nem
  segundo adapter Windows.
- O novo executável Windows foi gerado pela mesma workflow oficial e
  provado no Windows físico **sem Python no PATH, credenciais ou rede**.
  Origem `ordax-runtime@50a8626d9212e3741b38b87fbe658e24c8bee024`,
  SHA-256 `33e6c14b2f6e03e275697806f686195ca3de1a13296adc107bd003f5d71ceae2`,
  19.491.629 bytes. O único manifesto fonte de verdade é
  `docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json`;
  ele não é licença para ativação de produção.
- **Ainda pendente:** o executável **novo** ainda não substituiu o antigo
  na instância supervisionada; a leitura remota nova não foi concluída.
  O Windows auxiliar ainda usa a identidade do Desktop indevidamente em
  sua configuração DevAgent. **Não iniciar** agente auxiliar ou instalador
  com autostart enquanto as identidades colidirem.

**Ordem mínima do próximo executor:**
1. Após integrar o PR que atualiza o único manifesto OS, deixar
   o `ordax-pull` canônico materializar a revisão. Confirmar que o
   manifesto veio de `main`, a SHA é a acima e que o binário oficial
   obtido em CI já passou o self-test físico. Não alterar o checkout
   imutável manualmente nem inventar hash local.
2. Substituir **apenas** o executável DEV em
   `<Desktop userData>/native-state/product-runtime-dev/ordax-product-agent.exe`
   pela mesma origem, com Supervisor parado e recuperação segura se
   a verificação falhar. Não mexer em token, matrícula ou
   `Components` de produção, nem reinstalar Electron.
3. Reiniciar uma única instância Desktop DEV com
   `ORDAX_DESKTOP_MCP_DEV=1`, confirmar online/presença, grant exato,
   sessão atestada e chamar `computer.access_status` via o conector
   **OrdaX MCP** do ChatGPT; exigir receipt `status=succeeded`
   e `result.ok=true` no mesmo dispositivo. `queued` ou `pending`
   **não** bastam. Não marcar `mcpReady=true` sem digest atestado.
4. Com Desktop E2E provado, matricular o **agente auxiliar Windows**
   em uma identidade Product Device própria, usando o Owner oficial.
   Só então instalar/iniciar o Runtime auxiliar canônico e conceder
   os grants específicos do cliente, sem emprestar credenciais Desktop.
5. Assinatura Ed25519, cerimônia, distribuição estável e USB/Creator
   pertencem à fase de **produção/portabilidade**, não ao teste DEV.

**Restrições duras:** zero novos workflows, CLIs, serviços ou canais MCP.
Não iniciar buildroot/USB/Creator/QEMU/EROFS ou reinstalar NSIS do Desktop
para essa tarefa. Não recompilar o mesmo candidato já atestado.
Proibir grants implícitos, cópia de tokens, redirecionamentos permanentes
de endpoint e fallback de produção para binário unsigned. Quando o Worker
precisar de acesso Owner, usar OAuth oficial para o cliente exato; uma
seleção de challenge jamais substitui atestação do Device.

**Próximos chats:** ler esta seção, `docs/CURRENT-STATE.md` e
[issue canônica #1985](https://github.com/ordaxsystems/ordax-os/issues/1985)
antes de executar. Reaproveitar os commits/artifacts já aprovados e
continuar no último checkpoint; não repetir auditorias gerais ou criar
PR paralela. Registrar sucesso somente com ação física remota e receipt.

## Source model

`main` is the source authority for this prototype.

The intended daily loop is:

```text
edit source
  -> run affected tests
  -> preview in browser when Surface/app work is affected
  -> commit to main
  -> CI builds/verifies only affected owners
  -> publish/materialize a verified release or delta when applicable
  -> reconcile only the affected owner
  -> verify health/readiness
  -> record evidence
```

A full image rebuild, USB reflash or notebook reboot is not the default development action.

## Host independence

Development must not require WSL, QEMU, PowerShell, Bash or one desktop OS as a mandatory substrate.

Canonical tools must have portable cores. Host-specific adapters are allowed only for operations where the host OS genuinely controls access, such as raw disks, elevation or device enumeration.

QEMU is optional test infrastructure. It can improve disposable boot coverage, but source development and product correctness must not depend on its presence.

## Product targets

The same shared product source serves:

```text
Web preview / hosted Web
Mobile application
Desktop application
USB OrdaX
Native SSD/HD OrdaX
```

A normal Surface change should be visible through browser HMR before commit and then reach the applicable product modes from the same source commit. No manual Web-to-device port or copied UI fork is allowed.

## Phases

### Phase A - source-only

Work that can be completed without the notebook:

- architecture/contracts;
- shared Surface/apps/services;
- browser preview/HMR;
- Web/Mobile/Desktop capability adapters;
- provisioning core logic;
- release layout;
- security policy;
- unit/fixture tests;
- deterministic artifact tests;
- static image/filesystem verification;
- optional emulator-based tests when available.

### Phase B - physical bootstrap

Once provisioning, canonical release trust and pinned boot artifacts are proven against safe disposable/fixture targets:

- identify the physical USB independently from drive letters;
- require explicit destructive authorization;
- clean-provision the two-partition layout;
- install only the minimal pre-release bootstrap;
- verify physical bytes/layout/hashes;
- boot the notebook;
- prove UEFI boot + minimum network + signed release acquisition + verification + activation;
- prove recovery when first acquisition cannot complete.

SSH, Remote Core and Control Plane are not prerequisites for this phase.

### Phase C - live evolution

Once the notebook can safely consume verified releases:

```text
Git main
 -> build/test affected component
 -> publish release or delta
 -> OrdaX updater acquires it
 -> verify
 -> activate
 -> owner-local reconcile
 -> readiness/health evidence
```

Ordinary system changes must not require USB reflash, a remote shell or Codex. Boot/kernel/initramfs changes remain separately gated and may require a base update plus reboot.

Base-update evolution is now governed by `docs/contracts/base-update.json`: candidate kernel/initramfs bytes must stage only into an inactive A/B slot, use a one-shot systemd-boot candidate entry, leave the default/current entry untouched before health, and promote only after base heartbeat plus Surface health. The current contract/planner does **not** authorize ESP writes yet; disposable FAT32 and physical rollback proofs remain required.

## Branching

Prefer one permanent branch: `main`.

A temporary work branch is acceptable for isolated validation, but should be short-lived and integrated only after tests pass. Do not create a forest of long-lived feature branches as alternate source authorities.

A small work-in-progress budget (normally two or three active PRs per repository) is a review goal, not a hard cap or a reason to discard validated work. Keep one owner per responsibility and avoid parallel PRs implementing the same cutover.

The canonical `tools/ops/branch_hygiene.py` may prune an unchanged merged-PR head or a branch verified to have zero commits ahead of `main`, with exact SHA revalidation before deletion. **Closing a PR without merging does not by itself authorize deleting its branch**: exclusive commits must remain accessible for reconciliation or explicit archive. Open-PR heads, frozen release candidates and reserved refs remain excluded. Do not create additional branch pruners or manually force-delete unreviewed histories.

## Release model

Every deployed system version must be addressable by source commit.

Target shape:

```text
/ordax/releases/<commit>/
/ordax/current -> releases/<commit>
```

Rules:

- release directories are immutable after verification;
- activation is an atomic pointer/state transition;
- rollback selects a previously verified release;
- persistent mutable state never lives inside a release directory.

## Remote capability

Remote management is optional and is not part of the normal development/update path.

The normal path is repository/release driven:

```text
Git/GitHub
 -> build/test
 -> signed release or delta
 -> OrdaX updater
 -> verify
 -> activate
```

If a future product requirement justifies Remote Core or another remote-management capability, it must be delivered as a normal versioned release component behind explicit authorization. It must not become a hidden prerequisite for daily development, bootstrap, recovery or source authority. SSH remains optional and is not the default fallback.

See `docs/REMOTE-CONTROL.md` and ADR-007.

## OrdaX Creator development

`tools/creator/` exposes one shared product core.

Platform-specific code is limited to adapters needed for host APIs:

```text
tools/creator/platform/windows/
tools/creator/platform/linux/
tools/creator/platform/macos/
```

These adapters do not own layout policy, artifact choice, verification rules or user-visible product behavior.

End users must not need WSL, QEMU or a kernel toolchain to create/install OrdaX. The Creator consumes prebuilt verified artifacts and keeps destructive disk access behind a narrow, explicit host boundary.

## Evidence

For changes that affect boot, storage, identity, optional remote access or release activation, record at least:

```text
SOURCE_SHA=
TESTS=
TARGET=
OPERATION=
RESULT=
PHYSICAL_WRITE=YES|NO
REBOOT_REQUIRED=YES|NO
```

Evidence is not a substitute for tests, but makes the state of the prototype auditable by another conversation or agent.

## When the native target is offline

Do not block source work that is independently testable. Continue contracts, browser preview, fixtures, static artifact validation and other host-neutral work. Mark real-hardware validation explicitly as pending.
