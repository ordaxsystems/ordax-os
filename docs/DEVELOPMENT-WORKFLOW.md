# Development Workflow

Status: CANONICAL FOR PROTOTYPE


## P0 - OrdaX Native MCP integrado ao Desktop (02/11/2026)

Owner canonic: ordax-os (Native Host, Supervisor e ponte autenticada),
ordax-runtime (dispatcher e acao Product Device),
ordax-surface (UI e appActivation ja existentes), Platform (Device,
identidade, atestacao e grants do cliente ChatGPT).
Windows MCP auxiliar e uma identidade totalmente independente.

**Estado local comprovado:**
- A Surface publica estado de aplicativo por appId, sem usar windowId.
- Apenas o Runtime Product recebe o token de acao; o Electron
  injeta credencial distinta para a propria Surface. Rotas
  desktop-surface-state, desktop-surface-command e
  desktop-surface-receipt negam clientes sem credenciais.
- ordax.surface.open aceita somente account/settings/system/store,
  usa appActivation e aguarda confirmacao da janela exibida.
  Em timeout, app nao instalado, grant ausente ou resposta falsa,
  retorna erro, nunca sucesso. Sem controle de janelas Windows.
  O reporte transitorio de HTTP 503 nao repete appActivation:
  o canal reenvia apenas estado ate o Host aceitar a observacao;
  uma confirmacao antecipada nao e aceita. O reporter agora espera
  a janela visivel antes de reconhecer a ativacao, sem repetir o
  publish se a Surface renderizar mais tarde; abrir a janela que ja
  esta ativa nao cria outra. Se nao abrir, o Host devolve HTTP 504
  sem confirmar uma acao inexistente. Prova integrada sobre HTTP
  loopback com tokens distintos e rejeicao de acesso indevido.
  Testes: 58 OS e 130 Surface.
- Compilacao local oficial ordax-runtime em
  5173f2b01cb7abb1e5d98fdd00750c17fb6f85e4;
  SHA-256 988f2ee5a57404f03db8536d515551d3ed2976783a1575e92223b8f611fe327e,
  18.682.343 bytes; self-test congelado offline e dependencias
  verificadas por hash. Slot DEV atualizado sem reinstalar Electron.
- Janela Electron real e Surface prontas, reporter e polling autenticados
  no Native Host, 1 instancia Product (2 processos), 1 MCP Windows separado.
- Testes de integracao no OS, regressao da Surface, testes Python do
  Runtime e provas fisicas de loopback invalidado aprovadas.
- SSOT de evidencias: docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json.
  Arquivo historico de CI/prova remota da revisao anterior so no Git.

**Gates por responsabilidade (02/11/2026):**
- Platform #333 ja foi integrada a main (bcb9c8e7), com
  ordax_surface_status e ordax_surface_open sob perfis de Owner
  ordax-surface-read/ordax-surface-control, nunca Computer Control.
- Runtime #306 ja foi integrado a main (f89ab01c), sem segunda
  implementacao de dispatcher. O pacote Windows valida a lista Native
  pelo mesmo product_action_scope, e todos os gates de codigo
  passaram. O executavel DEV instalado continua pinned pelo hash
  de evidencia OS, sem promocao silenciosa.
- Esta revisao OS usa os contratos Native e appActivation existentes:
  credenciais efemeras distintas, relatorios apos comandos, receipt
  quando o app montou realmente, timeout fail-closed e uma arvore
  de processos sob o Supervisor. Sem acesso aos arquivos/janelas
  Windows pelo Device OrdaX Desktop.
- O MCP publico ainda esta no catalogo antigo e sua publicacao requer
  check_mcp_release.py, Owner grants reais e E2E atestado.
  Nao reduzir gate, habilitar full-computer-control, inventar grants
  ou produzir outro Worker/Runtime. Progresso de runtime/Platform no
  Git remoto nao e prova de deploy nem de acao GPT.
- Melhorias de Home/Loja/Spaces/Aura so devem usar novas capacidades
  canonicamente autorizadas, nunca cliques do Windows como substituto
  do OrdaX OS. Preservar o fluxo First Run de outros proprietarios.
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
