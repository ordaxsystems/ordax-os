# OrdaX Intelligence — conhecimento profissional por Profile e por Space

**Status em 2026-10-08:** arquitetura progressiva; fundação de Profile Content e Memory existe; RAG semântico, índice persistente operacional e gestão pública de centenas de perfis **não** estão entregues. Este documento é o guia canônico para expansão; não declara funcionalidades futuras como concluídas.

## Decisão estrutural: não treinar um modelo isolado para cada profissão

A mesma OrdaX Intelligence deve atender os vários ambientes. Um perfil profissional não é um modelo de IA nem uma conta; é uma composição versionada declarada pelo **manifest** do Profile Pack, aplicada a um Space autorizado.

- **Modelo / Local AI / Model Router**: motor genérico de linguagem; independente de profissão e substituível.
- **Profile Pack** `system/profile-packs/<slug>/v<version>/manifest.json`: identidade do perfil, finalidade, políticas declarativas, dependências e composição. É o SSOT do perfil, não cópia das instruções na UI.
- **Knowledge Pack** `ordax.profile-content-pack/1`: documentos especializados verificáveis com `source.uri`, `source.revision`, `license`, `jurisdiction`, SHA-256 por entrada e assinatura/receipt na cadeia de provisionamento.
- **Skill Pack**: procedimentos especializados versionados e verificáveis, `authority=none` e `toolIds=[]` no MVP. Texto recuperado não autoriza ações.
- **App SDK e ações**: interfaces funcionais e semântica de aplicativos; execução futura depende de autorização explícita do Policy owner, não de texto produzido pelo perfil.
- **Memory** `ordax.memory/1`: fatos, preferências e histórico **dos proprietários** (device/account/Space/projeto), não do Profile Pack. Profile não cria proprietário novo nem amplia permissões.
- **Índice semântico** `ordax.semantic-index/1`: *visão derivada*, vinculada ao SHA-256 do conteúdo, artefato exato de embeddings e proprietário/Space/projeto. Pode ser descartado e reconstruído, nunca se torna SSOT.
- **OrdaX Intelligence** `ordax.intelligence/1`: único ponto de combinação de contexto e inferência; permanece consultativo no MVP.
- **Descoberta editorial/comercial por perfil**: catálogo separado para cursos, receitas, eventos e patrocínio contextual, com publicação assinada e opt-in comercial como gates. Jamais injeta anúncios na IA nem lê Memory. Ver [`PROFILE-DISCOVERY-AND-SPONSORSHIP.md`](PROFILE-DISCOVERY-AND-SPONSORSHIP.md).

### Exemplo de resolução sem duplicação

```text
Sessão autenticada → Catálogo autorizado → Space selecionado
         |                    |
         |                    +→ Profile Pack ativo
         |                            ├→ Knowledge Pack verificado
         |                            ├→ Skill Pack verificado
         |                            └→ Capacidades de apps (somente declarações)
         |
         +→ Memory autorizada (device / account / Space / projeto)
                                  |
Prompt do usuário + contextos com proveniência e limite
                  → OrdaX Intelligence → Model Router / Local AI
```

A mesma profissão pode ser instalada em centenas de Spaces sem copiar seu Knowledge Pack público para cada negócio; a sobreposição particular (cardápio, preços, fornecedores, clientes, tarefas) permanece em arquivos e Memory **privados de cada Space**. Deduplicação de artefatos não implica acesso cruzado a dados.

## Recuperação lexical MVP: mecanismo e limites

A consulta de perfil passa pelo **mesmo port Native read-only** `ordax.profile-content-context-port/1`. O OrdaX Intelligence envia uma consulta local limitada a 256 caracteres. O host Native valida os parâmetros exatos `spaceId` e `query`; o leitor continua conferindo o inventário ativo, receipts, SHA-256 do artefato e dos textos antes de selecionar qualquer entrada.

O ranqueamento é **lexical, determinístico e offline**: termos normalizados sem acentos, correspondência por palavras, título/identificador e cobertura da pergunta. A seleção examina todas as entradas verificadas disponíveis, não apenas as primeiras oito; recorta trechos dos documentos longos sem exceder os limites da Intelligence. Itens sem correspondência não são fornecidos como contexto "relevante". O retorno não acrescenta autoridade nem muda o schema de entrada da IA.

O caminho sem consulta preserva a compatibilidade com o leitor existente. A pergunta não é enviada a terceiros ou anunciantes; passa somente pelo endpoint Native loopback, com cache desabilitado e autorização de Space revalidada antes da inferência. O valor da consulta no URL local é transitório; **não deve ser copiado para logs, telemetria ou armazenamento de publicidade**. Uma migração futura de transporte pode reduzir a exposição a logs do sistema.

**Limite de prontidão:** esta busca lexical não é RAG vetorial, não garante a melhor resposta nem substitui citations com licenças e fontes visíveis. Ainda faltam índice vetorial derivado, chunking semântico, avaliações de recall/latência, interface de fontes, atualização/revogação de índice e prova de desempenho com centenas de packs. Nenhum conteúdo comercial é elegível como Knowledge profissional.

## Regras de segurança que não podem regredir

1. A seleção do Space é **contexto**, não autenticação ou autorização. A projeção canônica `system/services/spaces/authorized-view.mjs` exige sessão assinada, catálogo pronto, `subjectId`, Space ativo e correspondência do `spaceKind`.
2. Antes de consultar conteúdo profissional, valide novamente o Space e a conta; depois da leitura assíncrona, revalide **antes** de entregar qualquer trecho à inferência. Mudança de identidade/Space no meio da leitura deve falhar fechada, sem reutilizar conteúdo já recuperado.
3. `ProfileContentContext` deve sempre devolver o mesmo `spaceId` solicitado e respeitar `scope=workspace`, limites de caracteres e proveniência. O host Native valida inventário, receipt e arquivo imutável assinado antes de fornecer entradas.
4. Se a ativação do Profile Pack mudar no mesmo Space durante a recuperação, o snapshot de revisão Native deve ser revalidado e o `profile.slug@version` da resposta deve coincidir com o Profile ativo. Uma consulta antiga não pode alimentar a IA com conhecimento de um Profile desativado ou substituído.
5. Conteúdo recuperado (incluindo instruções de Skill) é **dado não confiável**, não mensagem de sistema, permissão ou autorização de ferramenta. Prompt injection, fontes conflitantes e instruções para extrair segredos não atravessam o Policy owner.
6. Memory deve ser filtrada por owner/Space/projeto **antes do ranking**; itens restritos não entram automaticamente. Segredos não pertencem à Memory. Personalização opt-in deve continuar sujeita à revisão e exclusão pelo usuário.
7. Sem conexão externa implícita para embeddings, RAG, assistente ou sincronização. Fluxos cloud dependem de egress consentido e políticas próprias.
8. O orçamento de contexto existente é limitado; consumidor explícito tem prioridade. Resultados especializados não podem remover trechos fornecidos pelo usuário nem exceder os limites do contrato de Intelligence.
9. Trocar, atualizar, desativar ou remover o Profile **não apaga** arquivos, Memory e projetos do Space. Revogação de fonte/pack invalida resultados de consulta e seu índice derivado antes da próxima resposta.
10. Knowledge de domínios regulados (por exemplo, `legal-br`) exige fonte, revisão, jurisdição, licença, validação e avisos de limites, além do gate normal de publicação; não é liberado por escolher um rótulo profissional.

## Evolução para centenas de perfis: etapas e owners

| Fase | Entregável | Estado | Owner |
| --- | --- | --- | --- |
| 0 | Manifests de Profile, catálogo leve e composição versionada | Existe | `system/profile-packs` |
| 1 | Contents assinados/receipts, leitor Native e entrada na Intelligence | Base Owner/Development; publicação pública ainda bloqueada | `system/profile-content-sources` + Native |
| 2 | Memória persistente segregada por owner/Space e recuperação lexical autorizada | Existe; exige provas físicas | `system/services/memory` |
| 3 | Proteção contra troca assíncrona de conta/Space na consulta de Profile | Implementada nesta etapa; CI/merge devem validar | `system/services/intelligence/profile-content.mjs` |
| 3a | Busca lexical local por consulta em todas as entradas de Knowledge/Skill verificadas, com ordenação determinística, fragmentos relevantes e limite de oito itens | Implementação inicial nesta PR; exige CI e prova Native em hardware | Native Profile Content + Intelligence |
| 4 | Indexador local verificável (embedding model aprovado, chunk IDs determinísticos, content SHA, ACL e rebuild atômico) | **Não implementado** | Intelligence/Memory + storage owner |
| 5 | Busca híbrida lexical + vetorial, ranking por relevância, citações e fallback offline | **Não implementado** | Intelligence retrieval owner |
| 6 | UI de conhecimento profissional: fontes, versões, licença, última atualização, controles de exclusão/reindexação | **Não implementado** | Account/Profiles na Surface |
| 7 | Gestão de publicação, assinatura, diffs, canary, rollback, revogação de pacotes e prova de domínios | Parcial/pendente | Profile content trust + Store |
| 8 | Ações profissionais via apps/Skills com Policy/consentimento e logs auditáveis | **Não habilitado no MVP** | Application Action / Policy |

Não criar outro banco de vetores por perfil, nem duplicar Memory/OS/runtime. O índice derivado pode possuir **partições lógicas** por owner/Space/artifact e cache compartilhado apenas para documentos públicos verificados. A dimensão do embedding, modelo/versão, hash do artefato e métrica fazem parte do ID de índice; atualização incompatível exige reindexação sem modificar fontes.

### Contrato de fontes profissional

O `Profile` aponta para artefatos versionados no manifest. Cada fonte de Knowledge já exige URI, versão da revisão, licença, jurisdição e título; cada entrada exige content hash. Uma operação de atualização deve:
1. baixar sob trust root e validar assinatura/manifest/receipt;
2. comparar fontes pelo hash e atualizar somente entradas modificadas;
3. construir nova geração do índice derivado em staging, com quotas por Space/owner;
4. ativar geração nova de modo atômico após health/provas, preservando rollback dos **artefatos**, nunca revertendo Memory;
5. invalidar páginas/caches por fonte revogada e registrar proveniência exibível na resposta.

### Exemplo operacional

No Profile **Pizzaria**, a IA pode combinar procedimentos gerais de cozinha e atendimento (Knowledge Pack) com o cardápio, os preços e os fornecedores daquele estabelecimento (dados privados do Space), usando documentos verificados, Memory autorizada e perguntas do operador. Em **Impressão 3D**, outros Knowledge Packs explicam filamentos, perfis de impressão, falhas e manutenção, enquanto projetos, impressoras e orçamentos pertencem ao Space correspondente.

Esses resultados podem orientar o usuário; *executar* pedido, acessar mensagens de clientes, alterar preço ou acionar equipamento exige app autorizado, permissão explícita e prova de capacidade do OS. Nenhuma profissão ganha poder por um prompt.

## Critérios de aceite antes de anunciar RAG profissional pronto

- Provar leitura offline em hardware real e sem leitura cross-Space, inclusive trocas de conta durante I/O e cancelamentos.
- Verificar fontes e licença; respostas atribuem proveniência e versão, e o usuário distingue conhecimento público de suas memórias privadas.
- Testar atualização/revogação/reindexação de fonte sem alterar dados de usuário; verificar rollback de índice e de artifact.
- Medir latência, precisão, recall, degradação offline, orçamento RAM/disco e proteção contra prompt injection.
- Ter pipeline de revisão de domínio, assinatura, CI e publicação incremental para packs, sem editar o runtime para adicionar profissões.

**Importante:** RAG é consulta de conhecimento externo, não treinamento permanente dos pesos do modelo. Fine-tuning de domínio pode ser uma otimização separada e opcional quando houver dataset licenciado, avaliação e hardware adequados; nunca substitui controle de acesso, proveniência ou Memory.
