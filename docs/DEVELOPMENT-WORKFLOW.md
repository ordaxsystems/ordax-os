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


## Integração multi-repositório — composição do produto (2026-11-13)

A separação de repositórios **separa ownership e ciclos de desenvolvimento; não separa o produto OrdaX em forks**. A integração normal deve ocorrer por contratos versionados, artefatos imutáveis e dependências diretas. Copiar source entre owners, coordenar HEADs idênticos ou fazer cada consumidor pinçar todos os repositórios transitivos recria um monólito distribuído e é proibido.

### Regra de dependência direta

- `ordax-surface` publica a fonte visual compartilhada. O `ordax-os` seleciona a revisão visual exata por seu lock canônico; Desktop, Creator e apps **não** mantêm outro pin da Surface.
- `ordax-apps` publica componentes/pacotes e catálogo pelos contratos existentes. A Surface apresenta estado e ações através dos ports do produto; não importa source de apps nem se torna autoridade de instalação.
- `ordax-intelligence` publica source/artefatos reutilizáveis. A composição Native seleciona a revisão aplicável por contrato; clientes não copiam o motor.
- `ordax-os` é o **compositor do produto Native**: host, serviços, lifecycle, contratos e a seleção das revisões externas que entram em um candidato OrdaX. Isso não transfere ownership do source externo para o OS.
- `ordax-desktop` consome **uma composição/candidato OrdaX verificável** para o host Windows. Não integra Surface, Apps ou Intelligence separadamente quando esses componentes já são transitivamente selecionados pela composição do OS.
- `ordax-creator` consome artefatos de mídia OrdaX já produzidos e verificados. Não recompila kernel, Surface, Runtime, Apps ou Base para o usuário final.
- `ordax-site` consome somente catálogos/artefatos públicos autorizados e assets publicados pelos owners. O site não participa da composição Native.
- Runtime/Control Plane permanecem owners independentes de suas capacidades e são consumidos por contratos públicos; composição nunca autoriza duplicar dispatcher, grants, OAuth ou controle local em outro repositório.

**Regra transitiva:** um consumidor fixa apenas sua dependência direta canônica. Se A compõe B e B compõe C, A não cria um segundo pin de C sem uma dependência direta real e documentada.

### Paralelismo por owner

Trabalhos independentes avançam simultaneamente. Um owner só espera outro no ponto em que realmente precisa consumir um novo contrato/artefato/revisão. Não transformar a existência de repositórios separados em uma fila global.

Exemplos:
- uma correção visual na Surface pode ser implementada e validada sem Desktop, Creator, kernel ou USB;
- a adoção dessa Surface pelo produto Native altera o lock/composição do OS e executa somente os gates de integração aplicáveis;
- o Desktop só precisa de nova execução quando houver intenção de produzir/validar um novo pacote Desktop com aquela composição;
- o Creator só entra quando houver novo artefato de mídia a consumir;
- uma mudança isolada em Forge/app não exige alteração de Surface/OS se os contratos existentes já bastarem.

### Estados de conclusão

Não usar `merged` como sinônimo de produto entregue:

1. **Implementado** — source do owner alterado e validação proporcional aprovada.
2. **Integrado** — alteração incorporada à `main` canônica do owner.
3. **Entregável** — existe artefato/candidato/canal verificável quando essa responsabilidade exige distribuição.
4. **Produto concluído** — a jornada correspondente funciona no destino aplicável (por exemplo Desktop instalado, USB inicializado ou app realmente instalado/aberto).

O estado exigido depende do pedido. Uma correção interna pode terminar em Integrado; uma entrega de Desktop, USB ou instalação de app não pode ser chamada de concluída só porque o source foi mesclado.

### Anti-cascata

- Não abrir PR em vários repos apenas para “sincronizar” SHAs sem consumo real.
- Não manter SHA histórico em README como instrução operacional; consultar o lock, workflow, manifesto ou proveniência vigente.
- Não reconstruir upstream no consumidor. Reutilizar artefatos imutáveis e cache válidos.
- Não executar QEMU/kernel/USB para alteração client-only sem causalidade.
- Se a interface pública continua compatível, o producer pode avançar sem bloquear consumidores; a adoção ocorre quando o consumidor realmente precisar da nova revisão.
- Mudança incompatível exige evolução versionada do contrato e adoção explícita, não edição coordenada informal em múltiplos repos.

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
## Ponte Native Product — PR #2400 (implementação candidata, não homologada)

Owners: ordax-os (Native Host, Supervisor e ponte autenticada);
ordax-runtime (dispatcher e ação Product Device);
ordax-surface (UI e appActivation existentes);
ordax-platform (Device, identidade, atestação e grants do cliente ChatGPT).
O MCP auxiliar Windows mantém identidade independente.
O histórico de testes locais abaixo é evidência de candidato,
não substitui merge gates atuais, recibo remoto nem Store CURRENT.



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
