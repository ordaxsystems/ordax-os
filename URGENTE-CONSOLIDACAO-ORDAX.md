# URGENTE — Consolidação estrutural do OrdaX OS

**Prioridade:** URGENTE — organização e redução de complexidade comprovada  
**Início:** 2026-11-14  
**Owner:** `ordaxsystems/ordax-os` (cada alteração em outro repositório pertence ao respectivo owner)  
**Estado:** EM EXECUÇÃO — P0.1, P0.2 e P1.1 concluídos; P0.3 avançando por remoção histórica com consumidores preservados  
**Regra:** Evolução Rápida — executar uma simplificação pequena e segura por vez, validar proporcionalmente e integrar.

> Este arquivo é **roteiro operacional de consolidação**, não uma nova autoridade de arquitetura, produto, release ou implementação. A hierarquia vigente permanece em `docs/README.md`; source, contratos, `docs/CURRENT-STATE.md`, `MVP.md`, ADRs e gates prevalecem. Não duplicar o roadmap de produto de `00-PLANOS-PRIORITARIOS/`.

## 1. Por que existe

Reduzir o custo de localizar código, contratos, documentação e pipelines, sem trocar uma estrutura existente por outra, sem destruir histórico útil e sem interromper trabalhos paralelos no OS/USB, MCP, Desktop, Surface ou Forge.

**Problema a resolver:** responsabilidade ou informação repetida em vários lugares; arquivos históricos confundidos com estado vigente; workflows sobrepostos; cópias locais confundidas com duplicação versionada. **Quantidade de arquivos, sozinha, não autoriza remoção.**

## 2. Base observada e limites

Inspeção read-only do checkout local `C:\Users\ordax\Documents\GitHub\ordax-os`, alinhado à `origin/main` em `a719d62fd` no momento da amostragem de 2026-11-14:

| Métrica | Amostra |
| --- | ---: |
| Arquivos Git rastreados | 3.052 |
| Arquivos em `docs/` | 362 |
| Arquivos em `docs/contracts/` | 146 |
| Arquivos em `docs/evidence/` | 134 |
| Arquivos em `.github/workflows/` | 165 |
| Markdown na raiz | 5 |

A árvore muda continuamente: **recontar antes de cada decisão**. A comparação SHA-256 dos YAML de workflow não encontrou pares integralmente idênticos; isso **não** descarta sobreposição de jobs, triggers ou responsabilidades. Não tomar números históricos de outras revisões como inventário atual.

Já existe consolidação anterior: planos históricos da raiz foram movidos para histórico Git e classificados no `00-PLANOS-PRIORITARIOS/REGISTRY.md`. **Não refazer esse trabalho.**

## 3. Fila de execução (sem tarefas paralelas desnecessárias)

| Ordem | Frente / ação concreta | Critério de aceite | Estado |
| --- | --- | --- | --- |
| P0.1 | Criar este roteiro na raiz e torná-lo descobrível pelo `README.md` sem substituir o roteador `docs/README.md` | Link funcional e hierarquia preservada | **CONCLUÍDO** — `41ddc196`, `d45de378` |
| P0.2 | Confrontar a lista de planos da raiz com `00-PLANOS-PRIORITARIOS/REGISTRY.md` e referências realmente existentes | Apenas planos vivos permanecem ativos; históricos com link ao commit antigo | **CONCLUÍDO** — dois planos na raiz (`PLANO-07`, `PLANO-08`), ambos no registry e README; históricos já referenciados por snapshots |
| P0.3 | Localizar documentos de mesmo assunto e conferir citações/consumidores antes de consolidar | Uma autoridade humana por assunto, sem perder contratos e runbooks | **EM EXECUÇÃO** — Intelligence, Desktop, CI e histórico de reparos USB reduzidos; `DEV-USB-GIT.md` -4.488 bytes (`8966df35`); seguir por consumidores, sem remover gates Release |
| P1.1 | Agrupar workflows por finalidade, `on:`, `workflow_call`, caminhos acionados e exigência de branch protection | Lista de candidatos **com sobreposição demonstrada**, não por semelhança de nome | **CONCLUÍDO (inventário)** — 165 workflows; filtros e triggers revisados; nenhuma fusão segura demonstrada por nomes; P1.2 condicionado à equivalência de prova |
| P1.2 | Consolidar cada par comprovadamente redundante no fluxo canônico; ajustar chamadas/regras consumidoras antes da exclusão | Mesmo gate/prova, disparo correto, sem rebuild desnecessário | PENDENTE |
| P1.3 | Revisar `docs/evidence/`: separar prova exigida por contrato de registro histórico sem consumidor | Evidência vigente preservada; removida apenas redundância sem dependências | PENDENTE |
| P2.1 | Verificar código, testes e scripts repetidos em `system/`, `tools/`, `bootstrap/` e `tests/` | Um único owner por responsabilidade, sem perda de comportamento | **EM EXECUÇÃO** — 3 classificadores preservados por gate, leitura Git -z/UTF-8 corrigida e allowlists exatas testadas (`27688edb`); não unificar scripts com owners distintos |
| P2.2 | Revalidar fronteiras com Apps, Surface, Runtime, Platform, Desktop, Creator e Site | Integrações por contratos/artefatos, sem cópia de implementação entre owners | PENDENTE |
| P3 | Consolidar a navegação final: README conciso, `docs/README.md` como índice de documentação, registry de planos sem concorrentes | Qualquer agente encontra owner, fonte vigente e validação com poucos cliques | PENDENTE |

## 3.1. Execução e verificação — 2026-11-14

- **Navegação/duplicação efetivamente corrigidas:** a PR #2541 já havia removido `docs/STORE-WINDOWS-VERIFIED-CATALOG-BOUNDARY.md`, mas dois READMEs ainda apontavam para esse arquivo inexistente. Reapontados para os owners atuais sem recriar o documento (commits `fc4fb7dd` e `3ec65f81`).
- **Evidências históricas:** dois links relativos quebrados corrigidos (`ff520d73`, `1e2b7074`); evidências preservadas.
- **CI sem rebuild desnecessário:** `URGENTE-CONSOLIDACAO-ORDAX.md` adicionado **somente** à allowlist explícita de diff documental do Foundation (`92a21366`). Verificados seis cenários de classificação: roadmap/README somente `docs-only`; arquivos de código, contratos, workflow e desconhecidos continuam `full` (fail-closed).
- **Inventário de workflows:** 165 arquivos; 137 de 140 com gatilho `push` e 147 de 150 com `pull_request` possuem `paths` ou `paths-ignore`. Os três restantes são `branch-hygiene`, `foundation` e `product-version-governance`; possuem finalidade transversal. Uma semelhança textual de ~65% entre provas de migração Network não elimina suas asserções SQL distintas.
- **Limite da conclusão:** não há arquivos Markdown com conteúdo exatamente igual no snapshot inspecionado, mas isso **não** prova ausência de repetição semântica. Nenhum workflow foi excluído; antes de fusionar, validar required status checks, triggers, provas SQL e consumidores. A auditoria de referências Markdown identificou quatro links quebrados que já foram corrigidos; não confundir auditoria pontual com garantia universal de links em todos os tipos de arquivo.

### Consolidação documental efetiva — 2026-11-14

- O arquivo `docs/INTELLIGENCE-REPOSITORY-MIGRATION.md` acumulava checkpoints de fonte externa já cobertos pelos owners ativos `docs/EXTERNAL-SOURCE-INTEGRATION.md`, `docs/OWNER-INTELLIGENCE-TRANSACTION.md` e `docs/contracts/intelligence-source.json`. A única referência pelo caminho antigo estava em `docs/README.md`; foi reencaminhada aos três owners, com link ao snapshot Git imutável `f8c8f76d62de41fe5b91ef05904ce1f3d79068c8`. O documento histórico foi retirado da árvore ativa, não apagado do histórico (`0b9738ea`, `65f28fdb`).
- Validação read-only sobre a `main` após o corte: 235 Markdown rastreados, **zero links relativos quebrados**, três destinos existentes, snapshot anterior disponível. Contrato de origem continua `integration-candidate` / `activation_authorized=false` / `cutover_complete=false`; nenhuma ativação ou alteração de Runtime.
- Verificação da família Network de workflows: as provas de migração repetem provisionamento PostgreSQL, mas exercitam migrations/funções SQL distintas e filtros específicos. **Sem supressão de gates** apenas por semelhança textual. Proteção de branch GitHub consultada em 14/11: nenhum required status check declarado pela proteção clássica e nenhuma ruleset listada naquele instante; isso não equivale a autorizar remoção de provas.
- **Próximo recorte:** identificar outra narrativa realmente histórica e sem consumidor ativo; só retirar depois de indicar os owners atuais e apontar ao snapshot imutável. Workflows: reduzir quando o mesmo teste/efeito for comprovadamente executado mais de uma vez, sem perder isolamento dos gates.

### Consolidação da identidade visual e referências — 2026-11-14

- `docs/DESKTOP-IDENTITY.md`: retirei da leitura ativa duas seções de apresentação Web já marcadas como históricas/substituídas (notas antigas de 10/10 e microincrementos de sidebar de 11/10) e as substituí por links para o snapshot Git imutável `f5c66ec2d99d7707f3fd3b1a0d0a2d8bd7a55f7b`. O owner e o contrato Meridian continuam na abertura do documento; 21 headings históricos saíram da rota ativa, **nenhuma** das 27 âncoras com referências rastreadas foi eliminada.
- Corrigi quatro ocorrências de link Markdown aninhado incorretamente para o antigo plano funcional da Surface. Não repliquei o plano histórico.
- Redução física da documentação: **15.542 bytes** neste arquivo, commit `76a1f6ed`. A verificação de integridade por comparação de títulos e links não encontrou âncoras externas afetadas.
- **Limite explícito dos testes:** `test_surface_visual_identity.py` não passou no worktree isolado porque `system/surface/ui` não estava materializado a partir do owner externo; falhas de fixture/arquivo ausente, não prova de regressão nem aprovação completa da suíte visual. A entrega alterou somente documentação, sem source visual nem contratos.
- **Próximo recorte:** reduzir registros históricos de outros arquivos somente quando a referência ativa estiver migrada para o owner correto. Para `CURRENT-STATE.md`, preservar todos os marcadores consumidos por testes.

### Compactação do estado histórico sem perder gates — 2026-11-14

- `docs/CURRENT-STATE.md` acumulava uma seção **explicitamente histórica** de ~46 KB (checkpoints de outubro e início de novembro) antes da seção de inventário legado. Retirou-se somente esse trecho; o link no próprio arquivo aponta ao snapshot Git integral `0ce5a9b7c14bde6f280a09172bf521d9f22d8c67` (`a4a8707d`).
- A seção restante contém **674 marcadores de atribuição no total (653 distintos)** usados por testes de integridade. Comparação byte a byte dos marcadores antes/depois: **idênticos**. Não converter esses dados em outro SSOT por pressa; a futura compactação do legado depende de migrar os consumidores reais para contratos sem perda de validação.
- Isolamento de teste: em worktree temporário, 18 testes de `canonical_document_freshness`, 5 de `current_state_first_run_input`, 4 de `physical_handoff_freshness` passaram. A suíte `repository_ownership_contract` passou 11/11 no checkout principal com o import `tools` corretamente resolvido; no worktree descartável houve erro de módulo nesse teste, não falha de asserção do arquivo. Todos os worktrees temporários de teste foram removidos.
- **Não remover o restante de `CURRENT-STATE` só por volume**: há validações que consomem atribuições/termos específicos (especialmente `tests/test_canonical_document_freshness.py`). Revalidar qualquer novo corte com esses consumidores.

### Consolidação da documentação CI e correção de regressão Windows — 2026-11-14

- O documento sem consumidores ativos `docs/CI-TWO-STAGE-RELEASE-GATE-SSOT.md` (~16 KB) foi retirado da árvore versionada atual. As instruções vigentes sobre draft/Ready, serialização `queue: max`, Buildroot persistente, caches `BR2_CCACHE_DIR`/`BR2_DL_DIR` e paralelismo `ORDAX_SURFACE_BUILD_JOBS` foram reconciliadas com o **owner já existente** `docs/CI-SURFACE-CACHE-SSOT.md` (`f348b009`). O índice canônico `docs/README.md` agora aponta diretamente aos owners dos caches Surface e Base (`a8918662`). O histórico integral da antiga documentação fica no commit imutável `35bc94fa7402a733afdce7a3b086a9e1e0d2d0c7`; remoção em `190e1569`. Nenhum workflow foi excluído.
- A suíte de cache revelou `WinError 448` em `redirected_path()` ao atravessar uma junction Windows não confiável. O código agora considera **qualquer erro de inspeção `OSError` como caminho inseguro** e retorna a rejeição canônica em vez de propagar o erro (`4ffd6efa`). Regressão multiplataforma adicionada; duas capturas de saída de `mklink` utilizam decodificação tolerante apenas para texto de diagnóstico (`d536315e`). A validação de segurança dos artefatos permanece fail-closed.
- **Validação da `main` remota:** quatro suítes direcionadas em worktree descartável: 24 testes de cache Surface (5 skips definidos pela suíte), 5 de contrato Owner/Surface, 8 de escopo de workflows pesados e 4 de escopo de assinatura/release. **41 executados, 36 passaram, 5 skips, zero failures/errors.** O worktree foi removido após execução; nenhum build QEMU/USB foi inferido ou dispensado.
- **Próxima frente:** continuar eliminando documentos históricos somente com prova de ausência/substituição de consumidores. A remoção/fusão dos 165 workflows permanece condicionada à equivalência demonstrada de gates e provas; não há ganho em diminuir a contagem artificialmente.

### Consolidação do runbook USB Dev e preservação dos gates Release — 2026-11-14

- **Entrega `8966df35`:** dois procedimentos de recuperação física datados (11/10 e 19/10/2026) foram retirados da leitura operacional de `docs/DEV-USB-GIT.md`, preservados no [snapshot Git imutável](https://github.com/ordaxsystems/ordax-os/blob/5b3ba101ac7fc347b514f0e42212c8ff96f30329/docs/DEV-USB-GIT.md). Restam a proibição de reset destrutivo, inspeção da mídia removível, `ordax-pull` canônico, integridade, rollback e evidência de boot físico. Redução medida: **4.488 bytes**; nenhum dos títulos operacionais de Git-first/Creator/rollback foi retirado.
- **Verificações pontuais:** `HEAD` local e `origin/main` alinhados em `8966df35`, checkout limpo no momento da checagem, `git diff --check` sem erros, três links Markdown do documento com destinos válidos, zero links externos para âncoras removidas. Um teste amplo do `creator_owner_impact` excedeu 100 segundos; **não** foi contado como aprovado; o worktree temporário foi removido.
- **Preservado por segurança:** `docs/RELEASE-CHANNEL.md` e os runbooks de signing/trust continuam ativos, com seus gates normativos. `docs/contracts/distribution-profiles.json` ainda define `runtime_method_switch_implemented=false`, `owner_signed_release_transport_implemented=false` e `stable_signed_git_transport_implemented=false`. Reduzir esse material sem outro owner autoritativo enfraqueceria o canal seguro.

### Scripts de CI — consistência de trust entre caches — 2026-11-14

- A comparação de AST dos 13 scripts Python em `tools/ci` detectou somente uma função de hash de arquivo identicamente implementada entre `portable_component_cache.py` e `independent_surface_component_cache.py`; fundir esses dois owners por uma função de seis linhas **aumentaria acoplamento sem eliminar um rebuild**. Nenhum produtor, workflow ou cache foi duplicado ou removido.
- A comparação dos dois validadores identificou uma lacuna de trust: o cache Surface já rejeitava junctions e erros de inspeção do Windows, mas o cache Portable conferia somente symlinks nas folhas e fazia `resolve()` dos destinos de artefatos/recibos. O verificador genérico recebeu validação fail-closed dos componentes pais, entradas e recibos (`f93f8323`), e três casos de regressão (`596244ab`).
- **Prova Windows no checkout canônico:** `test_portable_component_cache.py` executou **21 testes: 20 PASS, 1 SKIP esperado por privilégio de symlink, 0 FAIL**. `test_portable_component_reuse_workflow.py` executou **11/11 PASS**. `py_compile` dos dois arquivos e `git diff --check` também passaram. Não houve build pesado, alteração de workflow ou prova física USB. A limpeza do worktree descartável segue como housekeeping separado, sem afetar a main.

### Classificadores de impacto CI — nomes Git exatos e sem rebuild falso — 2026-11-14

- Os três classificadores `creator_owner_impact.py`, `independent_surface_impact.py` e `portable_qemu_impact.py` consumiam `git diff --name-only` por linhas. O formato padrão do Git pode escapar caminhos UTF-8 e tratá-los como entradas desconhecidas, disparando Creator/Buildroot/QEMU por documentação. Cada gate agora usa `git diff --name-only -z --no-renames`, decodifica UTF-8 com fronteiras NUL e timeout de 30 s. **Não** criamos helper, cache, workflow ou owner novo, pois cada script permanece responsável pelo seu gate.
- O teste Git real `tests/test_ci_git_diff_exact_paths.py` confirma em três classificadores a leitura de `docs/Guia-á.md`, além de rejeição de revisão Git inválida. O classificador Surface/Creator recebeu **somente** as entradas CI/teste não produtoras comprovadas no `LIGHT_EXACT` (inclusive este roteiro raiz), preservando a regra fail-closed para mudança de kernel e demais entradas não classificadas.
- **Evidência na `main` `27688edb`:** 7 arquivos desta entrega classificados como `required=false` em Creator, Surface EROFS e QEMU; 8/8 testes direcionados de paths/Surface/novo gate passaram, mais 19/19 da suíte Creator executados antes da última permissão leve. `py_compile` dos 7 arquivos e `git diff --check` passaram. O teste novo confirma que mudança de kernel ainda exige USB.
- Na execução integral `test_portable_qemu_impact.py`, o setup do grafo Native encontra `WinError 448` ao atravessar a junction local `system/surface/ui` para o owner `ordax-surface`. A correção `ccc69bd` transforma a falha em `unreadable-import` no grafo (22 erros observados), sem declarar `runtime-graph` íntegro, nem saltar gates. A regressão focal `5a2cc13b` passou. **A suíte integral Portable/QEMU continua não aprovada neste checkout; não alterar/copiar o owner externo para contornar uma junction não confiável.**
- Próximos candidatos de P2.1: conferir outros consumidores de `git diff` somente quando a divergência de comportamento ou rebuild redundante for reproduzida; P1.2 (fusões de workflow) segue pendente de prova de equivalência.

## 4. Regras obrigatórias

1. **Nenhuma exclusão por volume**: só remover após verificar imports/referências, chamadas de CI, consumidores, histórico e obrigação de compliance/release. Migrations SQL aplicadas, contratos versionados, manifestos assinados, logs de proveniência obrigatória e gates de segurança não são “lixo”.
2. **Não tocar em alterações não comitadas de outros agentes**. Inspecionar `git status` e origem remota antes de editar; isolar mudanças caso haja concorrência. Sem `reset --hard`, `clean -fdx` ou rebase destrutivo.
3. **Sem duplicar SSOT**: texto deste roteiro registra ações, **não** um segundo `CURRENT-STATE`, `ARCHITECTURE`, `DECISIONS` ou `MVP`.
4. **Não criar ferramenta, workflow ou relatório novo para cada item**. Preferir `git grep`, `git ls-files`, leitura de `.github/workflows` e testes existentes; usar automação somente se reduzir custo real.
5. **Workflow só sai após inspeção de uso e required checks**. O fato de nomes se parecerem não prova equivalência; nunca enfraquecer `fail-closed`, assinatura, publicação ou rollback.
6. Cópias `*-usbdev*` e worktrees locais são **ambientes**, não arquivos duplicados da `main`; só eliminar após conferir processo, branch e referências.
7. Não interromper as frentes ativas de MCP, OS/USB, Forge e Desktop nem migrar implementação entre owners sem coordenação.

## 5. Como executar e registrar conclusão

Para cada item: **(a)** identificar arquivo/owner e consumidor, **(b)** fazer a menor mudança segura, **(c)** executar verificação proporcional, **(d)** integrar na `main` quando permitido, **(e)** anotar no próprio item o caminho ou commit que demonstra conclusão. Sem abrir uma coleção de planos satélites, sem evidência fictícia e sem declarar “limpo” por contagem bruta.

**Primeira entrega concluída (2026-11-14):** documento de execução na raiz (`41ddc196`) e link explícito/correção de navegação no README (`d45de378`). Conferência do estado da raiz: somente `PLANO-07` e `PLANO-08`, ambos referenciados pelo registry e README. **Próximo recorte:** documentação repetida com consumidores demonstrados, seguida de workflows por família. Evitar reabrir limpeza histórica já integrada.

**Encerramento:** nenhum documento ativo concorrendo por mesma autoridade; nenhum workflow removido sem substituto ou justificativa; nenhum consumidor quebrado; navegação simples; código e testes existentes permanecem funcionais.
