# FOUNDATION-001 — Auditoria e consolidação da fundação do OrdaX OS

- **Tipo:** PLAN / MVP FOUNDATION / CROSS-AGENT HANDOFF
- **Status documental:** ACTIVE — auditoria inicial, implementação estrutural pendente
- **Elegibilidade de execução:** EXECUTION-ELIGIBLE **somente** para corrigir defeitos/falhas e fechar gates já exigidos por `MVP.md`, contratos e owners canônicos. Não promove funcionalidades futuras nem autoriza escrita física.
- **Prioridade:** P0 para integridade estrutural, boot, atualização e USB do MVP; demais melhorias são subordinadas aos gates atuais.
- **Criado/atualizado:** 2026-10-23
- **Owner de execução:** `ordaxsystems/ordax-os` (consolidação transversal; NÃO se torna dono dos demais repositórios).
- **Autoridades reais:** `AGENTS.md`, `docs/README.md`, `docs/CURRENT-STATE.md`, `MVP.md`, `docs/ARCHITECTURE.md`, `docs/PROMOTION-GATES.md`, `docs/DECISIONS.md`, `docs/contracts/repository-ownership.json`, contratos de boot/storage/atualização e respectivos arquivos-fonte.
- **Planejamento:** `00-PLANOS-PRIORITARIOS/ROADMAP.md` e `REGISTRY.md`; `NATIVE-001` continua proprietário do plano de instalação whole-disk, sem duplicação.
- **Base da fotografia inicial (não pin permanente):** OS `eff13564d93ca729cd39b259bc2e41246e4f7928`; Apps `cba14ff9eb742cc462c2dca66d0edc78d792f5fc` após PR #330; Runtime `9154cb977bbad9f007e7734ebfbeeb4997e7db57`; Platform `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a`. Revalidar antes de executar.

> **Handoff independente de conversa:** este é o roteiro persistente de execução; NÃO é novo SSOT de arquitetura, versões, bugs, grants, estado físico ou releases. Nunca presumir que o snapshot abaixo permanece atual. Nenhuma tarefa pode ser marcada concluída por edição, teste isolado ou PR aberta; exigir evidência no owner correto.

## Problema e resultado esperado

Consolidar a fundação do OrdaX OS sem criar subsistemas paralelos, retrocompatibilidade artificial ou reestruturação simultânea incontrolável. Prioridade ordenada: (1) projeto/ownership, (2) USB/Creator, (3) boot/supervisão, (4) atualização, (5) Runtime e serviços estruturais. A sequência de **execução segura** continua auditando dependências primeiro, consolidando por owner e validando cada migração antes de remover caminhos antigos. A prioridade de produto não autoriza editar todas essas áreas ao mesmo tempo.

Pronto significa: layout reproduzível, cold boot previsível, Surface e sessão saudáveis, atualização determinística com known-good/rollback, shutdown limitado, recuperação diagnóstica, source/CI/documentação alinhados; evidência física separada de testes de CI.

## Não objetivos e restrições

- Não implementar funcionalidades secundárias, polimento visual, novos apps, novo atualizador, outro supervisor, outro Creator, novos bancos/catálogos de estado nem novos frameworks por conveniência.
- Não substituir fontes de verdade: `docs/contracts/*`, manifests, código e owners permanecem superiores a este plano.
- Não promover Stable, autorizar release, gravar USB, escrever SSD/NVMe/HDD ou desabilitar integridade/consentimento por este plano.
- Não apagar recovery, rollback/known-good, logs, referências históricas necessárias ou artefatos ativos sem comprovar consumidores e substituição; eliminar legado com prova de ausência de referências.
- Não declarar dependência Alpine removida ou portabilidade de Runtime concluída porque PR/CI passaram; exigir provas reais no perfil-alvo.
- Não mudar `main` por force/squash/rebase que rompa a ancestralidade consumida por USB Owner/Dev. Preferir **merge commit**, conforme `AGENTS.md`.

## Fotografia de evidências — 2026-10-23 (revalidar)

| Evidência | Status na fotografia | Fonte/limite |
| --- | --- | --- |
| Quatro repositórios oficiais | Confirmados | `docs/contracts/repository-ownership.json`; GitHub nas `main` indicadas |
| Estrutura `ordax-os` | Inspeção inicial, NÃO auditoria exaustiva | Árvore Git com ~3.480 entradas; `boot/`, `bootstrap/`, `system/`, `tools/creator/`, `docs/contracts/` |
| Desenvolvimento Git-first | Implementação existente | `bootstrap/dev-base/ordax-pull`, `system/supervisor`, `docs/contracts/distribution-profiles.json`; não comprovado neste snapshot no USB físico |
| Stable/MVP signed | Contrato e componentes existentes, promoção física não provada aqui | `bootstrap/release-acquisition/`, `docs/PROMOTION-GATES.md` |
| USB Dev preparado | Layout **transitório** de 3 partições | `docs/contracts/physical-prepared-media.json`: ESP FAT32, ORDAX ext4, DATA exFAT |
| Portable MVP final | Alvo de 2 partições; escrita física ainda gated | `docs/contracts/portable-usb-v2.json`: ESP FAT32 + DATA exFAT; EROFS e imagem ext4 interna |
| Base independente | Migração incompleta | PR #1860 (draft na fotografia), checar CI, ABI, inicialização e consumidores antes de remover Alpine |
| Desenvolvimento transacional | PR concorrente | PR #2161 (draft); checkout atômico, helpers e Supervisor; não criar segunda solução |
| Diagnóstico de boot/power | PRs concorrentes | PRs #2168 e #2169; validar contra `main` atual |
| Superfícies estruturais | PR concorrente | PR #2177; na fotografia `web-client` falhou, rever checks atuais |
| Creator / geometria QEMU | PRs concorrentes | PRs #2167 e #2000; não duplicar inventário de artefatos |
| Testes locais de atualização | 28 testes Node passaram na fotografia | Testes de contrato, status e UX; NÃO são boot/rollback físico |
| Apps ownership documental | PR #330 integrada na `ordax-apps/main` | Correção de fonte documental, não do boot |
| USB físico | NÃO inspecionado/atualizado | Desktop Commander viu apenas SATA interno no desktop; mídia OrdaX ausente durante a verificação |

**Dívida/risco em investigação, não remoção já autorizada:** antigos entrypoints da Base/ESP, política de transição `legacy-tree`, fontes `system/apps` removíveis, documentação histórica, projeções geradas do SDK, scripts e gates de CI possivelmente sobrepostos. Antes de eliminar qualquer arquivo, produzir grafo de referências (code search, build, installer, runtime, docs, CI, recovery, PRs) e teste negativo. Cópias byte-idênticas de assets distribuídos separadamente **não** implicam automaticamente segundo SSOT.

## Arquitetura de referência (validar com implementações e contratos)

```text
ordax-os/
  boot/                    UEFI/systemd-boot e entradas de recuperação
  bootstrap/
    kernel/                source/build de kernel
    initramfs/             early boot/descoberta de volumes
    independent-base/      alvo de base independente
    dev-base/              aquisição Git Owner/Development
    base-update/           stage/arm/promotion de kernel/Base
    release-acquisition/   aquisição/verificação assinada
    recovery/              recuperação controlada
  system/
    entrypoint             início da composição do sistema
    supervisor             autoridade de ciclo de vida e health
    contracts/             contratos do produto
    services/              serviços estruturais (account, power, state, update, apps, etc.)
    surface/               interface nativa/Web
    composition/           composição por ambiente
    adapters/              portas e adaptadores de plataforma
  tools/creator/           único produtor/provisionador de mídia física
  docs/contracts/          fonte estruturada para comportamento e distribuição
  tests/                   regressões e contratos
```

Esta é uma **organização lógica**, não uma autorização para mover diretórios de modo massivo. Se os contratos atuais exigirem localização diferente, prevalecem; alterações efetivas exigem ADR/contrato, refatoração de consumidores e provas.

**USB Owner/Development corrente:** GPT com ESP FAT32 + ORDAX ext4 + DATA exFAT; contrato `physical-prepared-media.json`, **somente transitório**. **USB Portable/MVP alvo:** GPT com ESP FAT32 e DATA exFAT, subárvore `ORDAX-DATA/.ordax/` contendo releases EROFS verificadas, runtimes endereçados por hash, estado persistente em imagem ext4 e ativação current/candidate/known-good dentro do estado Linux; contrato `portable-usb-v2.json`. Não colocar OverlayFS writable diretamente no exFAT, nem armazenar ponteiro de commit atômico no exFAT. Preservar arquivos do usuário na troca de release. Não alterar a geometria sem prova de Creator, PID1, QEMU e consentimento físico específico.

## Owners — não duplicar

| Capacidade | Source/execução proprietário |
| --- | --- |
| Boot, Base, early mount, recovery | `ordax-os/boot`, `bootstrap/*`; referência `docs/ARCHITECTURE.md` |
| Transição do sistema, supervisão, health, update routing | `ordax-os/system/supervisor` e owners de update definidos por `docs/contracts/distribution-profiles.json` |
| Git Dev (`ordax-pull`) | `bootstrap/dev-base/ordax-pull`, acionado pelo Supervisor; somente aquisição de código Dev |
| Kernel/Base A/B, ativação e promoção | `bootstrap/base-update` e `system/services/base-update` conforme `docs/contracts/base-update.json` |
| Stable signed release/Portable activation | `bootstrap/release-acquisition`, `bootstrap/initramfs`, `ordax-portable-state`, Supervisor e contratos `portable-*` |
| Layout e gravação física | `ordax-os/tools/creator` com `physical-*.json` e autorização explícita |
| Conta/sessão local, Surface/Settings/Store e lifecycle | `ordax-os/system/*`, nunca `ordax-apps` |
| Aplicativos removíveis | `ordax-apps`; o OS fornece contracts/ports, não source duplicado |
| Agente de ações e adaptadores nativos do computador | `ordax-runtime`; OS hospeda lifecycle/permissão local |
| OAuth remoto, grants, sessões atestadas, MCP/queue | `ordax-platform`; sem execução local duplicada |

`ordax-pull` e release-agent são **aquisições distintas por política**, não dois sistemas independentes de autoridade de estado/health; consolidar contratos de estado, detecção, ativação, promoção/rollback com seus owners reais sem forçar um único binário para tarefas fisicamente diferentes.

## Fases de execução, dependências e evidência exigida

### Fase 1 — auditoria real do source e concorrência (P0)

- [ ] Revalidar heads de quatro repos, PRs/workflows ativos, alterações concorrentes por arquivo e owners.
- [ ] Construir inventário de diretórios/entrypoints, imports, runtime call graph, serviços, scripts, build/test/CI, arquivos gerados, dependencies e source duplicated/unused.
- [ ] Distinguir **código morto comprovado**, projeções deliberadas, compatibilidade temporária necessária e caminho de recovery essencial.
- [ ] Mapear boot firmware→ESP→initramfs→Base→Supervisor→Surface→sessão, incluindo gates de maintenance e shutdown.
- [ ] Mapear Creator→partições→boot→updater Dev/Stable, estados persistidos, failure/rollback.
- [ ] Registrar achados reproduzíveis com path, consumidores, causa raiz, risco, teste e PR/owner; não chamar suspeita de evidência.

**Aceite:** mapa de dependências e conflitos revisável; nenhuma remoção física ou de código às cegas; resultados registrados nos owners (`docs/CURRENT-STATE.md`, auditoria datada em `docs/evidence/` se necessária).

### Fase 2 — definição/reconciliação canônica (P0)

- [ ] Conferir e corrigir **contratos e docs existentes**, não criar segundo contrato, e documentar ADR apenas quando houver decisão nova.
- [ ] Formalizar separação lógica kernel/boot/Base/estado/Surface/apps/Runtime e diretórios gerados vs versionados.
- [ ] Alinhar source Creator, target Portable e preparações de update/boot sob contratos correntes; explicitar o caminho transitório para Dev e gates de substituição.
- [ ] Comprovar que arquitetura proposta remove acoplamento sem redesenhar funções saudáveis ou expandir dependências.

**Aceite:** owner único por capacidade; contratos e consumidores alinhados; nenhum estado paralelo introduzido.

### Fase 3 — limpeza com prova de ausência (P0 nos defeitos comprovados)

- [ ] Para cada candidato legado, enumerar consumidores em todas branches/CI/Creator/runtime/recovery e registrar dependências.
- [ ] Remover implementações substituídas, adaptadores obsoletos, scripts sem consumidores e artefatos versionados indevidamente **apenas** após prova de remoção segura.
- [ ] Revisar `system/apps`/superfícies estruturais em conjunto com PR #2177, sem mover Ajustes, Conta, Sistema e Store estrutural para Apps.
- [ ] Rodar testes positivos/negativos e atualizar owner documental no mesmo change set.

**Aceite:** nenhum consumidor quebrado; não há segunda autoridade; recuperação crítica não perde cobertura.

### Fase 4 — boot, Supervisor e desligamento (P0)

- [ ] Reconciliar PRs #2168, #2169 e dependências do checkout #2161 no mesmo owner de boot; evitar PR conflitante.
- [ ] Eliminar loops sem diagnóstico; distinguir falha de display, Surface, networking, Base e estado de update.
- [ ] Provar ordem, readiness, boot offline known-good, timeout bounded, manutenção só por erro real e logs estruturados.
- [ ] Validar reinício/desligamento sem esperar indefinidamente, sem mascarar falha de flush/remount.

**Aceite:** QEMU/OVMF com falhas injetadas e cold boot físico quando aplicável; nenhuma tecla Enter repetida necessária; recuperação previsível.

### Fase 5 — atualizações/rollback (P0)

- [ ] Reconciliar PRs #2161/#2155, sem segundo `ordax-pull` ou Supervisor; resolver causa de ciclos de download/falha e locks.
- [ ] Provar state machine download→verify→stage→ready→activate→cold-health→promote / reject→rollback com SHAs exatos.
- [ ] Manter Dev Git-first e Stable assinado como transports; validar Base separadamente de Surface/app sem controles conflitantes.
- [ ] Testar interrupção em cada commit point, energia/reboot, transação persistente, no-op, failed same SHA e retry limitado.

**Aceite:** instalada/ativa/Surface/versão técnica diferenciadas, sem atualização parcial anunciada como sucesso; last-known-good permanece íntegro.

### Fase 6 — Creator, layout e imagem USB (P0)

- [ ] Reconciliar PRs #2000/#2167 e migração da geometria transitória à final do Portable conforme contratos.
- [ ] Validar payload preseeded de release e runtime/IA quando exigidos pelo release atual, sob hashes, assinatura e política de remoção independente.
- [ ] Provar Creator e boot consumindo exatamente a mesma topologia, hashes, capacidades e políticas; sem terceira geometria ad hoc.
- [ ] Gerar mídia descartável, validar GPT primária/secundária, FAT32/exFAT/EROFS/ext4, labels, acesso e readback.
- [ ] Antes de qualquer operação destrutiva, conferir disco selecionado, tamanho, serial, bus, partições e autorização física válida; não inferir consentimento deste plano.

**Aceite:** imagem reproduzível no CI e execução física **apenas** quando gates aplicáveis autorizarem; update e recovery na mesma geometria.

### Fase 7 — validação ponta a ponta (P0)

- [ ] Executar testes estáticos e integração no source das PRs, depois na `main` exata.
- [ ] Provar primeiro boot, boot offline, login/sessão persistida, shutdown, restart, atualização/rollback e interrupção por QEMU/dispositivo real.
- [ ] Coletar hashes, comandos, saídas, run IDs, modelo e identificação do USB, active SHA e Surface SHA antes/depois.
- [ ] Diferenciar PASS-CI, PASS-QEMU, PASS-PHYSICAL; em falha ou ausência de dispositivo, manter **NOT-PROVEN**, jamais converter em PASS.

**Aceite:** matriz por ambiente, commit, versão da Base e mídia, com falhas e recuperação rastreáveis; nenhum sucesso inferido de código alterado.

### Fase 8 — consolidação na `main` e handoff (P0)

- [ ] Integrar PRs concluídas validadas por **merge commit**, fechá-las, sem acumular forks de implementação.
- [ ] Atualizar `docs/CURRENT-STATE.md`, contratos/owners afetados, `docs/PROMOTION-GATES.md` e evidências na mesma entrega quando houver mudança de fato.
- [ ] Remover resíduos da refatoração somente após inventário de consumidores e prova.
- [ ] Revalidar `main` e notebook/USB **separadamente**; publicar pendências reais e próximo owner/tarefa.

**Aceite:** source, CI, documentação e status de mídia conciliados; PRs abertas justificadas, sem herança de conversa.

## Política de coordenação entre agentes

1. Ler `AGENTS.md`, `docs/README.md`, o plano, `ROADMAP.md`, `REGISTRY.md` e os owners antes de editar.
2. Revalidar imediatamente `main` e PRs que alteram os mesmos paths; uma PR existente é a unidade de coordenação preferida. Não criar segunda PR da mesma área sem demonstrar que a primeira não cobre o defeito.
3. Uma refatoração por owner, preservando boot/update operáveis. Não mesclar changesets simultâneos e desconectados de Base, EFI, Supervisor e Creator sem contrato/teste de integração.
4. Antes de cada write: confirmar SHA de base, paths afetados, consentimento físico se aplicável e lock de concorrência por owner. Nenhum force push em `main`.
5. Após cada merge: registrar no owner factual o commit, prova CI/QEMU/física, limitações, falhas e fase seguinte; usar este plano só como ordem/handoff.
6. Se outro agente já concluiu um item, validar a evidência e avançar; não reimplementar a partir de um snapshot antigo.

## Segurança, custos, regressão e falha

A autorização física/trust/EFI é controlada exclusivamente por seus contratos e cerimônias; status de desenvolvimento não remove essas condições. Provas em arquivos RAW descartáveis não autorizam escrita em disco real. Mudanças de filesystem e estado exigem preservação de user-data e known-good. Para PC fraco, medir tempo de boot, CPU/RAM, I/O USB e latência da Surface **antes e depois**, fixando regressões por perfil; não introduzir serviços extras em background. Não aumentar superfície de ataque, serviços remotos ou dependências por conforto.

## Próxima ação de execução (handoff imediato)

**Fase 1 → Fase 2, sem mudança física:** revalidar `main`/PRs #2161, #2168, #2169, #2177, #1860, #2000 e #2167; gerar mapa objetivo de boot/update/Creator com dependências e concorrência; identificar uma correção de causa raiz pequena e sem conflito, implementar no owner existente, executar testes e propor merge com evidência. `ordax-apps` PR #330 já está mesclada; não reproduzir a correção. Prosseguir nas fases seguintes somente após os respectivos gates.

**Handoff para novo chat/agente:** "No repositório `ordaxsystems/ordax-os`, leia `AGENTS.md` e `00-PLANOS-PRIORITARIOS/plans/FOUNDATION-001-OS-ARCHITECTURE-CONSOLIDATION.md`. Revalide contratos, `main`, PRs concorrentes e provas. Continue a próxima fase elegível pelo owner existente; não crie SSOT/planos/updaters paralelos. Diferencie merge/CI/QEMU/USB físico e atualize os owners com evidências." 

## Checkpoint de execução da Fase 1 — 2026-10-23

Mapa inicial de entrypoints, contratos de USB e colisões de PR: [evidência datada](../../docs/evidence/foundation-001-source-map-2026-10-23.md). Revalidado sobre `main@ec6cb268cbcfe`: #2177 e #2176 **já integradas**. Esta é evidência **PARCIAL**, não fase concluída: faltam grafo exaustivo de consumidores, prova QEMU/CI do HEAD e dados físicos. Evitar novo updater/Creator/Base e não refazer trabalho das PRs existentes.
