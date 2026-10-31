# Development Workflow

Status: CANONICAL FOR PROTOTYPE


## P0 — Native MCP no Windows/Desktop DEV (31/10/2026)

**Objetivo fixo:** fazer a mesma implementação `ordaxsystems/ordax-runtime`
responder a uma chamada remota real `agent.status` (1) no agente auxiliar
Windows e (2) no **OrdaX OS Desktop executado no Windows**, com duas identidades
de Product Device independentes. A conversa ChatGPT MCP usa a Platform/Worker
existente. Não há segunda implementação MCP, Dispatcher, Supervisor ou banco de
grants. Esta é uma tarefa de integração DEV no Windows, **não** uma tarefa
de USB, Creator, Buildroot, QEMU, distribuição de componentes ou lançamento.

**Critério de conclusão (verificação física, dois alvos):**
- `DESKTOP-PNUHUA0` Windows e OrdaX Desktop DEV identificados distintamente.
- Uma instância Runtime por identidade, com proprietário de processo e parada
  verificável; sem duplicar heartbeat, token ou processo.
- Sessão do cliente e grants por dispositivo válidos; `capability_digest`
  não vazio e atestado no caminho real, nunca preenchido artificialmente.
- `agent.status` remoto executado pela Platform/MCP e comprovado com o
  dispositivo correto; processo local, heartbeat ou teste offline **não**
  contam como sucesso. Não expor segredos no relatório.
- Se um gate falhar, manter a falha explícita e corrigir o owner real,
  sem simular `mcpReady=true`, nem desabilitar grants.

**Caminho DEV de menor custo, sem enfraquecer produção:**
1. Reaproveitar `ordax-runtime` Windows self-contained já gerado pela
   [PR #281](https://github.com/ordaxsystems/ordax-runtime/pull/281),
   candidato exato e hash em
   `docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json`.
   Não recompilar para repetir `--self-test`.
2. `system/adapters/desktop/product-runtime-supervisor.mjs` mantém intacto
   o caminho de release assinada; o caminho DEV requer opção local explícita
   `ORDAX_DESKTOP_MCP_DEV=1` no **Native Host do Desktop DEV**,
   identidade Product já matriculada, arquivo
   `<Desktop userData>/native-state/product-runtime-dev/ordax-product-agent.exe`
   idêntico ao SHA-256 e tamanho do artefato oficial. Não aceita URL
   arbitrária, novos hashes fornecidos pelo usuário, symlinks ou grants
   herdados de outro agente. Opt-in DEV **não** altera o contrato
   `runtime-component-trust-policy.json` e **não** produz assinatura.
3. Iniciar e testar no Windows real, primeiro o agente auxiliar existente,
   depois o Desktop; preservar isolamento de identidades. Status DEV
   `dev_remote_attestation_pending` significa **não pronto**, até prova real.
4. Só após esses dois E2E funcionarem considerar assinatura oficial,
   cerimônia de custódia, distribuição pública e instaladores de release.
   São gates de **produção**, não pré-requisitos para teste DEV isolado.

**Restrições de execução para este objetivo:** usar **um único PR de correção
em `ordax-os`** e o Runtime já integrado, com testes focados e uso da compilação
já existente. Nenhum CLI paralelo, segundo workflow, novo serviço ou rebuild
USB/Creator/Buildroot/QEMU/EROFS/NSIS apenas para investigar MCP.
Um build Desktop Windows só quando a alteração efetivamente exigir nova
instalação e os testes de fonte já estiverem verdes; aproveitar cache.
Não iniciar migração global de `studio-runtime-source-lock.json` ou fabricar
evidência Linux para corrigir o Desktop Windows. Preservar os PRs e
workflows de outros engenheiros sem interferir.

**Próximos chats:** antes de agir, ler esta seção, `docs/CURRENT-STATE.md`
e [issue canônica #1985](https://github.com/ordaxsystems/ordax-os/issues/1985);
inspecionar somente os HEADs, arquivos e gates diretamente relacionados.
Continuar de onde os testes terminaram; não abrir nova auditoria,
PR paralela ou projeto alternativo. Atualizar o estado real e a issue ao
mudar de fase. Se o ambiente físico estiver indisponível, reportar o
bloqueio exato, não declarar a tarefa concluída.

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
