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

`system/services/components/service-upgrade-preflight.mjs` fornece **projeções e verificações sem autoridade de instalação**, sempre sobre os contratos existentes:

- `deriveServiceCompatibilityCoverage` cruza todos os manifests canônicos com descritores de compatibilidade realmente declarados. Uma ausência aparece como **descriptor-not-declared**, nunca como contrato vazio/ficticiamente compatível. Versão divergente, dependência de provider não declarada e catálogo inconsistente são erros. Nem todo domínio embutido necessita descritor próprio.
- `deriveServiceConsumerImpact` percorre o fecho transitivo de dependências **já declaradas nos manifests**, indica cada caminho afetado e separa descritores de origem efetivamente conhecidos dos ausentes. Essa projeção cobre todos os componentes no artefato de CI (`consumerImpact`), sem criar uma lista manual de serviços ou afirmar que o contrato de origem já está assinado/ativo.
- `preflightServiceUpgrade` delega à autoridade **lógica** `evaluateComponentUpgrade`, já definida em `system/contracts/component-update-compatibility.mjs`, para checar avanço de versão, contratos fornecidos/requeridos pelos demais serviços e migração explícita de estado. Recusa lançamento como `component-slot` quando o manifesto oficial ainda diz `bundled`, `git-app` ou `base-ab`; exige descritores atuais de **todos os consumidores diretos e transitivos** para não inferir compatibilidade a partir de ausência de dados. Essa exigência é derivada percorrendo o grafo de dependências do manifesto canônico: Local AI → Intelligence → Assistente. Como o Assistente ainda não tem descritor oficial, a tentativa de avaliar uma atualização independente do Local AI sem esse contrato é **recusada**, em vez de declarar compatibilidade por omissão. A versão instalada em uso deve vir do **slot atual verificado**, pois pode ser mais nova que o manifesto da base OS; exigir igualdade com a versão embutida impediria o segundo upgrade independente. O preflight recusa grafo ativo incoerente ou descritores pertencentes a IDs ausentes do catálogo canônico.

As verificações foram adicionadas ao relatório JSON emitido pelo CLI/CI e a testes negativos de nova major incompatível, consumer omitido, downgrade, divergência de versão, dependência ausente e migração inválida. O relatório **não conhece trust material, dispositivos ou a instalação ativa**: `compatibilityAllowed` significa apenas que a avaliação de contratos da amostra explícita passou. **Não concede instalação**, não opera o Component Manager e não substitui o verificador criptográfico de release/2, o coordenador nativo de probation ou o proprietário do estado. Antes da ativação real, o owner precisa fornecer descritores de slots assinados e atuais, conciliar o resultado com a identidade verificada, executar migração do domínio e provar health/rollback.

### Gates comuns — nunca pular diretamente para `component-slot`

1. Cobrir todos os diretórios de serviço e todos os manifests no inventário automático, sem catálogos paralelos.
2. Para cada **unidade realmente instalável**, declarar dependências de contratos (fornece/requer), versão, ownership de estado, necessidade de restart e `releaseMode` no **manifesto canônico**, não na projeção de auditoria.
3. Usar uma única cadeia `artifact -> assinatura e trust pinado -> compatibilidade -> staging -> pending-health -> promoção -> receipt -> rollback`. Não inventar segunda Store/updater.
4. Para dados persistentes, migrar cópia separada e verificar antes de alternar; manter known-good e negar downgrade incompatível. Um serviço desativado não apaga projetos, Spaces, Memory ou arquivos.
5. Executar provas negativas: assinatura adulterada, API/ABI incompatível, dependência ausente, interrupção da instalação, health falho, rollback, troca de usuário e preservação dos dados.
6. Só alterar `releaseMode`/publicação com CI, assinatura de produção, recuperação e prova de hardware quando aplicável. **Nenhuma mudança desta primeira etapa altera o modo de release nem ativa instalação.**

**Ponte nativa de compatibilidade assinada (somente leitura):** o runtime component channel original expõe o comando `inspect-slot-compatibility-v2 --slot ... --trust ...`. O comando reutiliza o verificador completo de release/2 e o SHA-256 do descritor assinado; retorna `ordax.verified-slot-compatibility/1` com identidade do pacote e `ordax.component-compatibility/1` do slot inspecionado, sem atualizar nada. `trustScope: caller-supplied-public-anchor` **não significa trust pinado de produção**, e `activationStatus: not-evaluated` **não significa slot instalado/ativo**. Antes de integrar com `arm-pending`, o owner Native deve selecionar `current` e `candidate` do estado de ativação oficial, usar trust público pinado, verificar todos os consumidores ativos, vincular versão/commit/revision e executar `preflightServiceUpgrade` sem possibilidade de TOCTOU. **Não** usar o relatório JSON como permissão de instalação. A edição de `activation-state.json` continua fora do escopo e de produção até a prova E2E de troca/health/rollback.

**Estado de ativação canônico (sem registro duplicado):** `inspect-activation-compatibility-v2` consulta `activation-state.json` diretamente, exige `--expected-revision` positiva, usa o slot `current` ou `pending` selecionado pela identidade oficial, verifica a assinatura/release/2 e reconsulta o estado após ler o contrato. Recusa ausência, revisão obsoleta, chave pública incorreta e estado malformado; devolve `ordax.activation-slot-compatibility-snapshot/1`, sem mutação. `preflightServiceUpgradeWithActivationSnapshots` permite comparar esse `current` com um candidato **staged ainda não armado** e consumidores atuais, usando somente o avaliador existente. O Native owner ainda deve validar o trust **pinado** e repetir a checagem/revision sob o lock original na transição `arm-pending` para impedir TOCTOU. A saída somente leitura **não** é recibo de instalação nem prova de ativação em produção.

**Estado local do componente na transação de ativação:** `armPendingStateAtRevision` passou a verificar os **descritores de estado assinados** tanto do slot `current` quanto do candidato release/2, sob o mesmo lock do `activation-state.json`. Uma atualização com o mesmo dono e `writeVersion`, cuja versão de escrita atual esteja dentro do intervalo de leitura do candidato, continua permitida; pacote stateless ou que introduz um novo dono de estado também segue o contrato lógico oficial. Mudança de dono, remoção do dono, mudança do `writeVersion` ou transição v1↔v2 sem prova de compatibilidade bloqueiam a ativação antes de registrar `pending`. Como o Native ainda não possui um migrador copy-on-write/last-known-good integrado e verificável, **não** é permitido usar um JSON de `migrationPlan` como autorização substituta. Os testes de rollback que investigam migrações inseguras agora exercitam diretamente seus contratos assinados, sem forçar uma migração que seria barrada no writer. **Limitação:** isso cobre somente estado local de um componente; não resolve a compatibilidade global dos consumidores diretos e indiretos nem o trust de produção pinado.

**Versões candidatas sempre para a frente:** a operação `arm-pending` do updater Go original recusa uma versão candidata igual, inferior ou de pré-lançamento com precedência inferior à versão `current`, mesmo quando a assinatura do pacote é válida e o chamador omite `--expected-revision`. A comparação ocorre sob o **mesmo lock canônico** do `activation-state.json`, usando o contrato SemVer do manifesto e versão `current` já confirmada no state. Na primeira instalação, sem `current`, ainda assim valida a sintaxe estrita da versão. A recuperação de uma versão anterior continua exigindo `rollback-state` explícito e os seus checks assinados de estado. O novo comparador Go existe somente no executável Native e tem regressões para versões grandes, sem criar uma segunda fonte de política/versionamento. Isso **não substitui** a avaliação dos consumidores ativos nem concede a atualização de produção.

**Fechamento da janela de concorrência no writer original:** `armPendingStateAtRevision` reutiliza `mutateActivationState` e o lock canônico de `activation-state.json`. O slot é verificado uma vez para descobrir ID e local canônico, e **novamente dentro do mesmo lock**, imediatamente antes de registrar `pending`. Chamadores Native podem informar a revisão observada, inclusive `0` para primeira instalação, para obter rejeição fail-closed se outra transação alterar a revisão. O comando antigo sem revisão permanece somente por compatibilidade de desenvolvimento; não é prova da segurança de distribuição. Testes Go preservam os fluxos existentes e cobrem primeira instalação, atualização seguinte, revisão obsoleta e lock concorrente. **Importante:** revalidar assinatura/revision sob lock **não substitui** ainda a autorização semântica dos contratos de consumidores, trust pinado de produção e migração de estado. Esses gates continuam pendentes antes de ativação pública.

**Rollback de dados com contrato assinado:** no writer existente `rollbackCurrentStateAtRevision`, a restauração de um componente release/2 verifica, sob o lock do SSOT de ativação, a integridade e os descritores assinados de `current` e `previous`. A versão anterior só pode assumir o lugar da atual quando seu intervalo declarado de leitura abrange a versão de estado escrita pela atual e o identificador do domínio de estado corresponde. Mudança de dono/ID de estado, remoção de estado, ou restauração de versão com estado para fallback embutido sem contrato conhecido **bloqueiam** a troca sem alterar `activation-state.json`. O comportamento release/1→release/1 mantém compatibilidade anterior sem inventar descritores; transições entre schemas release/1 e release/2 não são consideradas seguras automaticamente. Esse gate é a checagem de **legibilidade declarada**, não substitui migração copy-on-write, prova de dados reais, backup ou confirmação de integridade de armazenamento.

**Cobertura observável dos consumidores instalados:** o comando nativo `inspect-active-compatibility-catalog-v2` percorre o SSOT `activation-state.json` de todos os domínios presentes no armazenamento de componentes, consulta exclusivamente seus slots `current` com assinatura release/2 verificada e reinspeciona as revisões. Rejeita entradas indevidas, estados corrompidos e chave errada; pacotes apenas staged/cache e apps com intenção de desinstalação não contam como instalados. O relatório `ordax.active-slot-compatibility-catalog/1` informa **sempre** `completeForActivation:false`, pois não consegue provar a presença dos serviços **bundled** e não oferece uma leitura global travada. `validateActiveSlotCompatibilityCatalog` reutiliza os validadores JS do mesmo domínio para impedir que esta projeção seja falsificada como inventário completo. Não autorizar `arm-pending` com base apenas nesses dados; antes é necessário reconciliar a cobertura de serviços bundled e obter uma verificação transacional do grafo inteiro usando trust pinado. Não registrar um segundo installed-state.

**Lacunas transversais reconciliadas:** `assessServiceActiveGraphCoverage` cruza a projeção Native assinada com **todos os manifests do catálogo oficial e os descritores de fonte disponíveis**. Expõe por componente se o contrato existe, se há slot `current` observado e se o modo de distribuição do manifesto corresponde ao slot. O resultado continua `completeForActivation:false` e nunca deduz uma permissão a partir de uma lista incompleta. O próprio relatório rejeita IDs de slots que não pertencem ao catálogo oficial. Essa análise usa os owners e manifests existentes, não mantém uma segunda lista de apps ou serviços.

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
