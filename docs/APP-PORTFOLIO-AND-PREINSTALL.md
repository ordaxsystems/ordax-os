# Portfólio first-party e aplicativos iniciais

Status: **política de seleção implementada; pré-instalação física e publicação pendentes de comprovação**. Esta decisão não altera o payload USB atual nem a instalação dos usuários. A implementação de seleção sem autoridade está em `system/services/apps/first-run-selection.mjs`, com testes em `tests/test_first_run_selection.mjs`.

## Prova isolada do ciclo Native assinado

O teste Go `TestSignedStoreRoundTripAcrossHealthUpdateRemovalAndOfflineReinstall`
usa a mesma geração real de envelope Ed25519, slots `release/2`, writer CAS,
verificação de assinatura, estado `pending-health`, registro de probation,
promoção e remoção. Em um diretório temporário isolado, executa
instalação saudável → atualização com saúde falha (mantém a versão anterior)
→ atualização saudável → rejeição de remoção antiga → remoção explícita
→ releitura do tombstone → retry idempotente da mesma remoção
→ reinstalação offline do slot assinado preservado → rejeição de replay antigo.
A cada etapa, recarrega `activation-state.json` pelo leitor Go e verifica
que um arquivo de usuário sentinela, fora do grafo de slots, permanece intacto.

A prova roda pelo workflow `Runtime Component Candidate` com os testes Go
normais. **Não é um teste de hardware USB, de dados reais do App Data,
quiescência de processos, recuperação do formato persistente ou integração
de uma release assinada publicamente.** Esses gates continuam separados.

## Limite da autorização física ao alterar a composição Native

A integração de `expectedActivation` modifica
`system/composition/native/main.mjs`, que integra o conjunto de fontes
protegidas pelo contexto de autorização de gravação USB de
`tools/creator/physical_promotion.py`. A autorização anterior do
proprietário foi vinculada a **outros bytes** e não é válida para esta
geração do código. Neste candidato, o único documento canônico
`docs/contracts/physical-write-authorization.json` permanece no estágio
`blocked-explicit-physical-authorization-pending`, com
`explicit_owner_authorization:false`, `physical_write_allowed:false` e
`authorization_context_sha256:null`. Os hashes de assinatura, a prova
canônica de release e os demais bindings de integridade permanecem
inalterados; o recibo anterior pode ser consultado no histórico Git,
não em uma segunda autoridade.

Esse estágio permite verificar contratos de software de maneira honesta,
mas **não permite gerar um payload físico autorizado nem escrever no
pendrive**. Após fechar o código e os gates, uma nova autorização deve
ser preparada por `tools/creator/authorize_physical_write.py` e
explicitamente confirmada pelo proprietário com o escopo e a sequência
exatos, seguindo o fluxo oficial de três confirmações; só então a etapa
física independente poderá ser considerada. Não copiar o hash antigo,
não autorizar automaticamente no CI e não interpretar `QEMU PASS`
como permissão para gravação.

## Proteção contra replay entre gerações da instalação

A Loja emite somente planos `ordax.app-lifecycle-plan/2` que carregam a
**observação Native correspondente à projeção assinada atual**:
`expectedActivation = {source, revision, version, sourceCommit}`. Para
instalação, o estado deve ser `absent` ou `removed` naquela revisão;
para atualização ou remoção, deve ser `slot` com identidade do release
instalado. Sem observação confiável, o serviço nega o pedido.

A mesma precondição é verificada novamente pelo executor Native contra
`ordax-runtime-component-channel status`. Para `arm-pending`, a
`revision` observada segue como `--expected-revision` do **writer Go
canônico**. Para remover, o executor confirma a mesma revisão e
versão/sourceCommit antes do `uninstall-state`, que já implementa CAS.
Uma requisição antiga reapresentada após remoção, reinstalação ou mudança
de revisão, mesmo sem troca de SemVer, **não pode ser reutilizada para
modificar outra geração**. A UI não recebe novas permissões: o campo é
apenas uma precondição derivada de observações verificadas, nunca uma
capability de instalação.

Esta defesa impede replays perigosos, mas **não promete repetição
bem-sucedida** de uma resposta HTTP perdida depois de o Go ter confirmado
a mutação. O resultado nesse caso permanece não confirmado para o
solicitante e exige uma nova observação do estado Native. Não inferir
sucesso de `requestId` nem introduzir um journal paralelo.

## Comprovação do estado Native após operação da Loja

O executor oficial `native_app_lifecycle_executor.py` trata a resposta do
`ordax-runtime-component-channel` como **resultado de comando**, não como
comprovante isolado de persistência. Depois de `arm-pending`, relê via
`status` o estado de ativação canônico Go e exige a mesma revisão,
`pending.version`, `pending.source_commit` e saúde `unknown`. Depois
de `uninstall-state`, exige a revisão avançada, ausência de
`current/previous/pending/rejected`, `user_removed:true` e
`removed_identity` igual à versão exata removida. Divergência, saída inválida
ou falha na releitura **bloqueia o reconhecimento de sucesso**, mesmo quando
o comando imprimiu `YES`.

Essa conferência não cria banco de instalações, recibo paralelo ou política
de assinatura: lê a única fonte de verdade do componente. Não substitui
prova USB física, recibos de instalação, supervisor de quiescência ou
rollback de dados stateful. Testes de regressão em
`tests/test_native_app_lifecycle_executor.py` cobrem readback válido,
pendência ausente, revisão/saúde divergente e tombstone ausente.

## Regra definitiva de ownership

- `ordaxsystems/ordax-os`: sistema/base, Surface, App SDK, Identity, Intelligence, Memory, permissões, Loja estrutural, Conta, Ajustes, Sistema, verificação, ativação e desinstalação de pacotes.
- `ordaxsystems/ordax-apps`: **destino canônico de fonte dos aplicativos first-party removíveis**, incluindo os que podem vir pré-instalados no OS. Versão do app e artefato pertencem a seu próprio owner; apps podem ser pré-instalados sem terem uma segunda cópia de código no OS.
- **Transição de source**: Rede e Projetos já têm código-fonte exclusivamente no `ordax-apps`. Arquivos, Internet e Atividade ainda têm implementação no OS. O Assistente está no **Gate A remove-first desta PR**: sua implementação saiu do código da composição, mas o Gate B no Apps ainda não ocorreu. O inventário imutável dos 11 arquivos está em `migrations/assistant.source-snapshot.json`; o corte só é efetivo na main após integração desta PR. Nenhum desses fatos comprova publicação ou instalação de aplicativos externos.
- `ordaxsystems/ordax-runtime`: host Windows e execução de capacidades do dispositivo.
- `ordaxsystems/ordax-platform`: Product MCP, Control Plane e conectores de provedores (ChatGPT/Grok etc.). Plugin é conector, não outro Studio.

**Loja não é owner de código nem de instalação.** Todos os aplicativos removíveis do catálogo verificado devem ser encontráveis na Loja: se instalados, mostrar Abrir/Atualizar/Desinstalar; se ausentes com pacote elegível e verificado, Instalar; senão, indisponibilidade verdadeira. Componentes estruturais (Conta, Ajustes, Sistema, Loja) são integrados e não removíveis. A Loja precisa de projeção real para componentes bundled e component-slot; hoje o `verified-store-projection.mjs` cobre somente o caminho de componentes externos verificados. Isso é um gap de integração, não motivo para duplicar inventário. A composição de aplicações agora rejeita conflito entre IDs bundled e slots assinados: nunca silenciar uma segunda fonte e fingir que o primeiro owner venceu.

## Defaults do primeiro perfil/instalação

A lista executável de **intenção de seleção** fica exclusivamente em `listFirstRunDefaultAppIds()`. Não mantê-la em outro manifesto nem afirmar que já está instalada. Ela contém Arquivos, Internet, Notas, Calculadora, Relógio, Conversor, Calendário, Visualizador de Texto, Imagens, PDF, Mídia, Desenho, Cores, Mapa de Caracteres e Ferramentas.

- Os dois bootstrap anteriores (Arquivos/Internet) permanecem na Stable/USB corrente. Os demais seguem `on-demand` até existir uma release/provisionamento verificado que os entregue.
- Novo dispositivo/perfil pode **selecionar** os defaults, mas só instala após o pipeline assinado do owner da plataforma provar pacote, compatibilidade, saúde, promoção e receipt.
- Desinstalar um default é uma decisão persistente do usuário: jamais reinstalar silenciosamente após reinício, login, atualização ou reconexão. O gerenciador canônico `tools/runtime-component-channel/activation.go` grava o marcador `user_removed:true` junto à mudança de ativação de pacotes independentes; resolve-current respeita o marcador. O marcador *de primeira instalação* e a leitura Native autenticada deste sinal pela seleção inicial ainda precisam ser montados. O planejador JS continua sem autoridade e apenas consome snapshots autoritativos.
- Falta de catálogo assinado, pacote offline ou port Native produz `unavailable` e não sucesso fictício; apps opcionais não bloqueiam o primeiro boot.
- Remover aplicativo não remove dados; exclusão de dados exige operação distinta.
- O primeiro perfil deve ter acesso offline aos pacotes incluídos na imagem quando essa distribuição for ativada; não prometer rede disponível.

## Sobreposição e nomenclatura

| Identidade | Responsabilidade única | Conduta |
| --- | --- | --- |
| **Intelligence** | Serviço de IA, modelo e memória autorizada | Uma fonte sistêmica. **Assistant** é uma interface; **Brain** não vira memória/roteador paralelo. |
| **Studio** | IDE, projetos, chat e preview técnico | **Projetos** mantém domínio geral de projetos; App Forge é modo do Studio, não clone de IDE. |
| **Rede (Network)** | Comunidades, mensagens e colaboração | Fonte removida do OS pelo gate remove-first e destinada a `ordax-apps`. A Rede só estará instalada quando houver pacote assinado com slot saudável; conectividade/Wi-Fi continua no OS. |
| **Connect** | Nome do roadmap para pareamento/conexões | Não usar como segundo app de comunidades; revisar junto às capabilities de rede/dispositivos. |
| **Relay** | Ideia de laboratório de IA central para múltiplos PCs | Não criado nem absorvido pelo Studio. Experimentação separada, se aprovada. |
| **Activity** | Timeline/progresso e receipts reais de trabalho | Timeline é apresentação; não criar outro event store. |
| **Flow** | Editor futuro de fluxos | Consome Action Gateway/Scheduler; não cria executor ou permissões paralelos. |
| **Research** | Fluxo de pesquisa com fontes | Consome Internet/Notas/Projetos/Intelligence, sem navegador ou memória duplicada. |
| **Documents** | Experiência para arquivos, notas e visualizadores | Não virar outro sistema de arquivos. |
| **Finanças, Vendas, Estoque** | Domínios empresariais distintos | Permanecem fundações não instaláveis até App SDK, dados por Space e publicação real. |
| **Cores, Mapa de Caracteres, Ferramentas** | Utilitários pequenos | Podem ser agrupados visualmente, sem apagar IDs estáveis ou dados. |
| **Texto, Imagens, PDF, Mídia** | Leitores especializados | Reutilizar host/file grants; unificação de UI não justifica trocar IDs. |

## Integração verificada do catálogo na Loja

- A Loja agora tem a seção **Essenciais**, que usa `listFirstRunDefaultAppIds()` como origem única da seleção e filtra **somente entradas efetivamente projetadas pelo catálogo verificado**. Ela não adiciona itens de catálogo, inventário ou direitos de instalação.
- `planFirstRunAppSelectionFromStore()` deriva candidatos elegíveis da projeção `ordax.app-store-catalog/2`. Para ser elegível, cada aplicativo precisa estar ausente e marcado como instalável, com artefato e procedência verificados. Apps instalados usam a versão `current` efetivamente observada. Apps bundled não representados pelo port independente permanecem **desconhecidos** nesta projeção, jamais contados como instalados ou ausentes.
- O runtime-component channel expõe `SOURCE=REMOVED` quando a fonte de ativação canônica contém `user_removed:true`. O endpoint Native existente propaga `source:removed` usando o mesmo verificador e o mesmo escopo somente leitura; não existe um novo banco, endpoint de gravação ou inventário de instalação.
- O plano `planFirstRunAppSelectionFromStore` exige **observação Native `source:absent`** para cada candidato elegível: o catálogo da Loja sozinho não distingue ausência original de remoção voluntária. `source:removed` suprime qualquer seleção automática. A lista de observações é insumo efêmero, não uma segunda SSOT; o leitor Native/provisionador que forneça esse insumo ainda não está conectado ao First Run produtivo.
- A composição Native agora entrega ao assistente de primeiro uso um resumo **somente leitura**, derivado do mesmo snapshot da Loja e da mesma leitura temporária de ativação de componentes. `getCurrentObservations()` reaproveita as respostas já validadas pela projeção oficial, sem segundo fetch ou catálogo. A projeção limpa observações ao ficar indisponível, iniciar nova atualização ou ser destruída; First Run não autoriza instalar nada.
- A elegibilidade inicial usa `!firstRunStateStore.load().completed`, ou seja, o **estado persistente existente** de primeiro uso. Isso não é ainda uma marcação transacional de provisionamento de pacotes e não autoriza retentar instalações. Falhas de consistência Native/Loja são registradas no diagnóstico e não interrompem o onboarding nem geram instalações.
- O plano continua `authority:none`. Não cria solicitações, não grava intenção de remoção e não comprova pré-instalação física.
- O catálogo indisponível continua indisponível na Loja. Apps não publicados/verificados não aparecem artificialmente como disponíveis.
- A próxima etapa de produção exige um inventário Native **combinado** de apps bundled e component-slot, uma transição de provisionamento/receipts no owner nativo e pacotes assinados compatíveis antes de delegar ações. **Não** criar novo banco, segunda Loja ou mecanismo de execução para isso.

## Fases de integração (não equivale a release pronta)

1. **Feito:** inventário de owners, decisões de nome, seleção declarativa e seção Essenciais filtrada pelo catálogo verificado, com testes de status real e negação de reinstalação.
2. **A executar:** reconciliar IDs/manifests do Apps, completar os 6 cutovers com provas remove-first, nunca publicar duas fontes.
3. **A executar:** produzir/verificar artefatos assinados e entrega offline inicial; montar pré-instalação na autoridade de instalação da plataforma.
4. **A executar:** fazer Loja mostrar apps bundled e externos com inventário verificado e permissões de desinstalação reais, preservando App Data.
5. **A executar:** E2E de primeira instalação, desinstalação persistente, reboot, reconexão, reinstall voluntário, rollback e Store; então promover release.

SSOTs existentes: `system/services/apps/delivery-policy.mjs`, `system/services/apps/mvp-delivery-policy.mjs`, `docs/contracts/runtime-component-package.json`, `ordax-apps/ordax-apps.workspace.json`, migrações individuais e o catálogo verificado da Loja.
