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
| P0.3 | Localizar documentos de mesmo assunto e conferir citações/consumidores antes de consolidar | Uma autoridade humana por assunto, sem perder contratos e runbooks | **EM EXECUÇÃO** — históricos Intelligence e Desktop reorganizados, `CURRENT-STATE` -46 KB, `DESKTOP-IDENTITY` -15,5 KB e 4 links corrigidos (`76a1f6ed`); continuar por consumidores |
| P1.1 | Agrupar workflows por finalidade, `on:`, `workflow_call`, caminhos acionados e exigência de branch protection | Lista de candidatos **com sobreposição demonstrada**, não por semelhança de nome | **CONCLUÍDO (inventário)** — 165 workflows; filtros e triggers revisados; nenhuma fusão segura demonstrada por nomes; P1.2 condicionado à equivalência de prova |
| P1.2 | Consolidar cada par comprovadamente redundante no fluxo canônico; ajustar chamadas/regras consumidoras antes da exclusão | Mesmo gate/prova, disparo correto, sem rebuild desnecessário | PENDENTE |
| P1.3 | Revisar `docs/evidence/`: separar prova exigida por contrato de registro histórico sem consumidor | Evidência vigente preservada; removida apenas redundância sem dependências | PENDENTE |
| P2.1 | Verificar código, testes e scripts repetidos em `system/`, `tools/`, `bootstrap/` e `tests/` | Um único owner por responsabilidade, sem perda de comportamento | PENDENTE |
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
