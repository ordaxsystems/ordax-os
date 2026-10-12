# OrdaX System Foundation

Status: **SOURCE FOUNDATION / SAFE TO EVOLVE / NO NEW AUTONOMOUS AUTHORITY**

This document fixes the root ownership model for OrdaX as the product grows beyond the original prototype.
Apps remain user-facing clients. Durable identity, Memory, Intelligence, policy, lifecycle and action authority remain system concerns.

## Root model

```text
Adapters / platform capabilities
              |
      System Foundation
  capability registry + lifecycle
  bounded events + restrictive policy
              |
  Identity --- Memory --- Intelligence --- Sync
              |
        Personal OrdaX
              |
       Work / Activity
              |
     Action Gateway / grants
              |
      bounded execution

Apps: Files / Notes / Internet / Activity / Assistant / ORDAX Studio / ...
      consume the system; they do not replace it.
```

`Personal OrdaX` is a system orchestration service, not a super-app and not the owner of identity, Memory or permissions.
`ORDAX Studio` is a first-party app/runtime consumer. Blender, Unity, Three.js and later creative engines are capabilities behind the OrdaX boundary, not alternate OrdaX products.

## Foundation runtime

`system/services/system-foundation/runtime.mjs` introduces four small root primitives:

1. **Capability registry** — records what the current composition can actually provide. Availability is data only and always carries `authority: none`.
2. **Lifecycle graph** — resolves required/optional service dependencies, rejects missing required dependencies and fails closed on cycles.
3. **Bounded system events** — metadata-only operational events with a cursor. It is not a new Memory store and must not be used to dump prompts, secrets or documents.
4. **Restrictive policy aggregation** — combines `pass`, `require-approval` and `deny`; the strictest result wins. `pass` means only “no extra restriction here”, never permission to execute.

Action grants and the Action Gateway remain the authority boundary. The system foundation cannot mint a grant.

## Scheduler and background ownership

Scheduler and background execution belong at system level because updates, sync, backups and Personal OrdaX may all need them. They are not app-owned infrastructure.

The source foundation is now implemented with the safety primitives that were previously only roadmap items:

- bounded wall-clock, step, action and egress budgets;
- exclusive leases with heartbeat and expiry;
- cancel, deadline handling and fail-closed recovery;
- bounded checkpoints;
- durable Scheduler state with IANA timezone, one-shot/fixed-interval recurrence and bounded run counts;
- transactional occurrence outbox;
- stable deduplication keys and idempotent Background run creation;
- Scheduler-to-Background dispatch that revalidates consumer, subject, owner, Space/project and occurrence binding;
- every Schedule, occurrence and Background Run remains `authority: none`.

This does **not** mean public autonomous background is enabled. Personal OrdaX still does not automatically schedule or background Work, and no scheduled wake bypasses Action Policy, Action Review, approvals, exact grants, Action Gateway or Action Executor.

Native durable ownership also exists for automation metadata in `/var/lib/ordax/automation-state.json`, with private permissions, atomic replace, fsync, cross-process locking, CAS and corruption fail-closed. The JavaScript Background/Scheduler runtimes are async-store ready and have a bounded same-origin Native adapter. The production `native_host_server.py` route is still deliberately not wired at this cut, so the adapter remains fail-closed instead of pretending persistence is active.

## Component evolution and independent updates

The OrdaX component system already separates component identity/version, signed package staging, pending health, promotion and rollback. Independent component delivery must stay compatible with the same long-term rule used by whole-OS releases: an update is not safe merely because its signature and hash are valid.

`ordax.component-compatibility/1` adds a data-only compatibility boundary for independently evolving components:

- every provided contract has an explicit stable ID + major version;
- every required contract declares an accepted major range and whether it is optional;
- replacing one component must leave all non-optional requirements satisfiable;
- normal candidate staging is forward-only; downgrade uses the explicit rollback path;
- one pending candidate cannot be silently replaced by another;
- a component that owns persistent state cannot simply stop owning that state during an update;
- state-format changes require an explicit `ordax.component-state-migration/1` plan;
- same-schema state migrations are sequential `N -> N+1`;
- migrations are copy-on-write, owner-preserving, verified before switching and retain the previous generation;
- compatibility descriptors and migration plans always carry `authority: none` and contain no executable migration code.

The currently published signed `prototype-ordax.runtime-component-release/1` keeps its existing semantics. Compatibility metadata will **not** be silently added as a new required v1 field. When signed activation starts depending on this metadata, the correct target is a new release descriptor major (planned `runtime-component-release/2`) that hash-binds the compatibility descriptor. Old and new release schemas may coexist only through an explicit migration window.

This lets Local AI, OrdaX Intelligence, Studio runtimes and later services evolve independently without turning the component manager into a plugin system with implicit authority or allowing an update to reinterpret user state in place.

## Inventário transversal das atualizações dos serviços

**Programa de implementação:** [Issue #1680](https://github.com/ordaxsystems/ordax-os/issues/1680), execução do plano modular anterior [Issue #684](https://github.com/ordaxsystems/ordax-os/issues/684), que continua sendo a referência de arquitetura e não deve ser duplicado. O primeiro corte é **para todos os serviços de uma vez**, não para um único serviço: `node tools/service-update-inventory.mjs --check` descobre cada diretório `system/services/<nome>` no repositório e deriva todos os componentes de `system/apps/component-catalog.mjs`. O teste `tests/test_service_update_inventory.mjs` e o workflow `service-update-inventory.yml` conferem essa projeção em mudanças de serviços/apps.

A projeção `ordax.service-update-inventory/1` é **somente leitura e sem autoridade**. Não mantém outra tabela de versões, installed state, permissões, donos de projetos ou updater. Versões e `releaseMode` permanecem exclusivamente nos manifests. Diretório sem componente próprio aparece explicitamente como domínio embutido: existência de código **não prova** serviço executável ou atualização independente. Um `component-slot` declarado também **não prova** distribuição pública.

O relatório inclui também as dependências reais e os consumidores diretamente afetados por cada componente, o escopo de reinício e a criticidade, todos **derivados dos mesmos manifests**. A projeção `ordax.service-update-readiness/1` confere cada componente contra `docs/contracts/runtime-component-package.json`, incluindo candidatos de pacote e gates de assinatura/ativação/saúde/rollback; ela nunca concede autorização nem transforma policy em prova de instalação. A CLI `node tools/service-update-inventory.mjs` emite JSON completo, retido como artefato efêmero de CI para os outros responsáveis. `--check` mantém saída breve e detecta divergências da política oficial. Nenhum arquivo gerado constitui segundo SSOT. A exportação de descritores para o empacotador (`tools/component-package/compatibility.mjs`) consulta diretamente `coreRuntimeCompatibility` e valida o catálogo; **não** replica IDs de Local AI/Intelligence em outra lista manual. O verificador preexistente `tools/runtime-component-channel/check_production_readiness.py` agora também faz parte da auditoria em CI: ele compara a política de pacotes com a política de confiança e seus gates, sem duplicar a regra de segurança no serviço de inventário. A cópia de política distribuída com o SDK (`sdk/app-sdk-v1/runtime-component-package-policy.json`) é uma **projeção publicada**, não outra fonte de verdade; um teste exige igualdade com `docs/contracts/runtime-component-package.json` e impede divergência silenciosa. O teste transversal garante que os descritores exportados continuem alinhados ao catálogo canônico. A auditoria **não** realiza o teste físico de instalação nem comprova que um componente foi promovido.

### Regra de atualização por família

| Família | Origem da decisão | Entrega até aprovação real |
| --- | --- | --- |
| Base/kernel/boot/recovery | release OrdaX + `base-ab` | Geral/A-B; reboot quando necessário |
| Supervisor/atualizador/segurança e estado crítico | manifestos e contrato de sistema | Geral; jamais updater dentro do updater |
| Shell, rede, energia e relógio | manifests atuais | `bundled`; isolamento futuro apenas com provas |
| Local AI / Intelligence | manifests + compatibilidade `ordax.local-ai/1` e `ordax.intelligence/1` | `bundled` agora; candidatos a `component-slot` com saúde/rollback |
| Spaces, Memory, Sync, Personal OrdaX, Scheduler, Background, notificações | serviços donos dos domínios; fonte descoberta no inventário | Embutidos no OS até existir pacote standalone, versão/ABI/dependências verificadas e migração segura |
| Profile/Knowledge/Skill/idiomas | manifests versionados e políticas de pacotes existentes | Conteúdo/versionamento próprio quando assinados e ativáveis; não confundir com processo runtime |
| Apps first-party removíveis | ownership `ordax-apps` e manifests de app | `git-app` é só desenvolvimento; `component-slot` apenas após cutover e trust real |
| Conta, Ajustes, Sistema, Loja | componentes estruturais do OS | `bundled`, inicialmente |

### Compatibilidade de candidatos — verificação transversal

`system/services/components/service-upgrade-preflight.mjs` fornece **duas projeções sem autoridade**, sempre sobre os contratos existentes:

- `deriveServiceCompatibilityCoverage` cruza todos os manifests canônicos com descritores de compatibilidade realmente declarados. Uma ausência aparece como **descriptor-not-declared**, nunca como contrato vazio/ficticiamente compatível. Versão divergente, dependência de provider não declarada e catálogo inconsistente são erros. Nem todo domínio embutido necessita descritor próprio.
- `preflightServiceUpgrade` delega à autoridade **lógica** `evaluateComponentUpgrade`, já definida em `system/contracts/component-update-compatibility.mjs`, para checar avanço de versão, contratos fornecidos/requeridos pelos demais serviços e migração explícita de estado. Recusa lançamento como `component-slot` quando o manifesto oficial ainda diz `bundled`, `git-app` ou `base-ab`; exige descritores atuais dos consumidores diretos para não inferir compatibilidade a partir de ausência de dados. A versão instalada em uso deve vir do **slot atual verificado**, pois pode ser mais nova que o manifesto da base OS; exigir igualdade com a versão embutida impediria o segundo upgrade independente. O preflight recusa grafo ativo incoerente ou descritores pertencentes a IDs ausentes do catálogo canônico.

As verificações foram adicionadas ao relatório JSON emitido pelo CLI/CI e a testes negativos de nova major incompatível, consumer omitido, downgrade, divergência de versão, dependência ausente e migração inválida. O relatório **não conhece trust material, dispositivos ou a instalação ativa**: `compatibilityAllowed` significa apenas que a avaliação de contratos da amostra explícita passou. **Não concede instalação**, não opera o Component Manager e não substitui o verificador criptográfico de release/2, o coordenador nativo de probation ou o proprietário do estado. Antes da ativação real, o owner precisa fornecer descritores de slots assinados e atuais, conciliar o resultado com a identidade verificada, executar migração do domínio e provar health/rollback.

### Gates comuns — nunca pular diretamente para `component-slot`

1. Cobrir todos os diretórios de serviço e todos os manifests no inventário automático, sem catálogos paralelos.
2. Para cada **unidade realmente instalável**, declarar dependências de contratos (fornece/requer), versão, ownership de estado, necessidade de restart e `releaseMode` no **manifesto canônico**, não na projeção de auditoria.
3. Usar uma única cadeia `artifact -> assinatura e trust pinado -> compatibilidade -> staging -> pending-health -> promoção -> receipt -> rollback`. Não inventar segunda Store/updater.
4. Para dados persistentes, migrar cópia separada e verificar antes de alternar; manter known-good e negar downgrade incompatível. Um serviço desativado não apaga projetos, Spaces, Memory ou arquivos.
5. Executar provas negativas: assinatura adulterada, API/ABI incompatível, dependência ausente, interrupção da instalação, health falho, rollback, troca de usuário e preservação dos dados.
6. Só alterar `releaseMode`/publicação com CI, assinatura de produção, recuperação e prova de hardware quando aplicável. **Nenhuma mudança desta primeira etapa altera o modo de release nem ativa instalação.**

**Trabalho paralelo:** a mudança transversal evita arquivos de Creator/kernel, HTML/CSS da Surface, local-AI runtime funcional, migrations de apps e backend Platform. PRs nessas áreas pertencem a seus respectivos owners e devem ser reconciliadas antes do merge. Próximo corte após a cobertura completa: provar um componente isolado contra o **mesmo** canal assinado e replicar o gate validado, sem reimplementar o mecanismo para cada serviço.

## Memory for years of use

The current native prototype persists `ordax.memory-snapshot/1` with a bounded item/byte ceiling. That remains a safe compatibility boundary, but it is not the final long-term storage design.

The new `ordax.memory-storage-manifest/1` foundation makes upgrades explicit:

- canonical user Memory stays `ordax.memory/1` and remains OrdaX-owned;
- storage format has its own version, independent of model/provider versions;
- canonical Memory generation is independent of the semantic/embedding index;
- an embedding index is **derived and rebuildable**, so changing the local model never rewrites canonical memories;
- every storage migration is sequential (`N -> N+1`), owner-preserving and fail-closed;
- an older system refuses to downgrade storage written by a newer OrdaX;
- future segmented/partitioned persistence can replace the single snapshot without changing app-facing Memory semantics.

The shared Memory runtime now also understands the optional `ordax.memory-record-store/1` persistence port. Unlike the legacy whole-snapshot port, it reads bounded candidate windows and writes/removes individual validated records, so the service itself no longer needs a global 2,048-item ceiling when that backend is selected. The service still revalidates every returned record and reapplies owner/Space/project/sensitivity authorization before ranking it. Session Memory remains volatile even when the record store is device-durable.

This is a service boundary, not a claim that Native already stores unlimited history. Before promoting Native from `ordax.memory-store/1` to the record backend, Native persistence and Account Memory sync must move together to an owner-partitioned/segmented backend with atomic generation switching and a last-known-good recovery point. Do not simply raise the 2,048-item or 8 MiB limits.

## Profiles and local AI

A user profile is not a hidden monolithic prompt. Preferences, durable facts, instructions and project/Space context remain typed Memory with explicit owner and scope.

Local AI consumes authorized context through OrdaX Intelligence. Model upgrades may change inference or rebuild derived indexes, but they must not silently migrate ownership, erase canonical Memory or make a provider the source of truth.

## Upgrade invariant

A normal OrdaX update may upgrade code and storage formats, but user state follows this order:

```text
read old generation
 -> validate owner + schema
 -> create explicit migration plan
 -> write new generation separately
 -> validate new generation
 -> switch active generation atomically
 -> retain last known-good recovery point
```

Destructive in-place conversion is not the target design.
