# URGENTE — Consolidação estrutural do OrdaX OS

**Prioridade:** URGENTE — organização e redução de complexidade comprovada  
**Início:** 2026-11-14  
**Owner:** `ordaxsystems/ordax-os` (cada alteração em outro repositório pertence ao respectivo owner)  
**Estado:** EM EXECUÇÃO — primeira etapa: organizar entrada e medir redundâncias reais  
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
| P0.1 | Criar este roteiro na raiz e torná-lo descobrível pelo `README.md` sem substituir o roteador `docs/README.md` | Link funcional e hierarquia preservada | **EM EXECUÇÃO** |
| P0.2 | Confrontar a lista de planos da raiz com `00-PLANOS-PRIORITARIOS/REGISTRY.md` e referências realmente existentes | Apenas planos vivos permanecem ativos; históricos com link ao commit antigo | PENDENTE |
| P0.3 | Localizar documentos de mesmo assunto e conferir citações/consumidores antes de consolidar | Uma autoridade humana por assunto, sem perder contratos e runbooks | PENDENTE |
| P1.1 | Agrupar workflows por finalidade, `on:`, `workflow_call`, caminhos acionados e exigência de branch protection | Lista de candidatos **com sobreposição demonstrada**, não por semelhança de nome | PENDENTE |
| P1.2 | Consolidar cada par comprovadamente redundante no fluxo canônico; ajustar chamadas/regras consumidoras antes da exclusão | Mesmo gate/prova, disparo correto, sem rebuild desnecessário | PENDENTE |
| P1.3 | Revisar `docs/evidence/`: separar prova exigida por contrato de registro histórico sem consumidor | Evidência vigente preservada; removida apenas redundância sem dependências | PENDENTE |
| P2.1 | Verificar código, testes e scripts repetidos em `system/`, `tools/`, `bootstrap/` e `tests/` | Um único owner por responsabilidade, sem perda de comportamento | PENDENTE |
| P2.2 | Revalidar fronteiras com Apps, Surface, Runtime, Platform, Desktop, Creator e Site | Integrações por contratos/artefatos, sem cópia de implementação entre owners | PENDENTE |
| P3 | Consolidar a navegação final: README conciso, `docs/README.md` como índice de documentação, registry de planos sem concorrentes | Qualquer agente encontra owner, fonte vigente e validação com poucos cliques | PENDENTE |

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

**Primeiro recorte:** tornar esta prioridade visível e eliminar ambiguidade de navegação no README; depois concentrar a revisão em redundâncias comprováveis de documentação e workflows, uma família por vez.

**Encerramento:** nenhum documento ativo concorrendo por mesma autoridade; nenhum workflow removido sem substituto ou justificativa; nenhum consumidor quebrado; navegação simples; código e testes existentes permanecem funcionais.
