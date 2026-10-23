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
- **Fonte já externalizada**: Internet, Assistente, Projetos, Atividade, Rede e Notas têm fonte canônica em `ordax-apps/apps/<id>/` e não têm fonte de app em `ordax-os/system/apps/<id>/`. Os seis cortes de fonte já estão concluídos na `main`; isso não habilita distribuição, instalação ou atualização independente.
- **Arquivos** é o único app removível cujo código de produto ainda tem fonte canônica em `ordax-os/system/apps/files/`. `ordax-apps/migrations/files.externalization.json` mantém `source_cutover_allowed:false` e `distribution_activation_allowed:false`; a remoção anterior falhou nos gates do bootstrap USB. O OS agora pode verificar e montar transitoriamente um candidato Files pendente em iframe de origem opaca, com raiz sintética vazia e sem App Data, recentes, projetos ou mutações de dados reais. Slots externos não substituem nem sequer são lidos pela descoberta enquanto a cópia bundled existir. Isso valida somente o contrato de montagem; não entrega a UI, não transfere a fonte, não promove nem distribui o componente. O handoff assinado ainda deve preservar o File Space local do dispositivo sob vínculo ao slot verificado e manter Conta/Space como escopo separado; faltam as provas de boot/recuperação acompanhadas em `ordax-os#1743`. Não criar uma cópia permanente em Apps enquanto a fonte OS estiver ativa.

### Separação entre Arquivos locais e arquivos de Space

Auditoria Native de 2026-10-22 confirmou que a seleção de Space é apenas um registro local de `subjectId + selectedSpaceId`, validado contra o catálogo de Conta carregado no cliente. Ela não provisiona armazenamento nem é autoridade para uma rota do host. As rotas `/__ordax/native/files`, `file-content`, `file-import`, `file-export`, previews e lixeira operam exclusivamente sobre `NativeHostServer.user_root`; seus pedidos não carregam ou validam um Space. O serviço de Conta encaminha `/account/spaces`, mas o host de Arquivos não consulta sessão/catálogo nem associa IDs de Space a diretórios. `kind=personal` também não é uma chave segura: a conta pode ter vários Spaces pessoais, de trabalho ou profissionais.

Há dois escopos diferentes e eles não devem ser combinados implicitamente:

- **Arquivos locais do dispositivo** continuam disponíveis offline no `user_root`. Um candidato no OS acrescenta o escopo imutável `ordax.file-space-scope/1` com `kind=device-local` e encaminha as operações ao slot Native `files` somente depois de validar sua identidade/revisão exatas. Esse escopo nunca representa Conta, Space compartilhado ou grant de recurso.
- **Arquivos de Conta/Space** ainda exigem um broker diferente que, em cada operação, vincule identidade autenticada, seleção de Space validada por autoridade do host e armazenamento provisionado com identidade estável. O app não pode escolher livremente `subjectId`, `spaceId`, raiz ou caminho físico. A seleção local persistida não substitui essa validação; `ordax.file-space/11` ainda não implementa esse vínculo.

O escopo local do candidato habilita verificação isolada e um contrato de montagem transitório, usando somente dados sintéticos vazios. Isso não autoriza mover a UI, duplicar o pacote ou abrir distribuição. O binding Native para uso normal continua condicionado à ausência comprovada da fonte bundled e ao slot atual verificado; enquanto `system/apps/files/` existir, ela segue como fonte única. O corte ainda requer a borda pública de SDK/runtime, pacote first-party completo, bootstrap assinado, instalação offline, health/rollback e provas USB/QEMU. Os gates `source_cutover_allowed` e `distribution_activation_allowed` permanecem fechados até esses critérios serem comprovados.

Arquivos existentes no `user_root` são dados locais do dispositivo: não inferir que pertencem ao Space pessoal, copiá-los automaticamente, movê-los na primeira leitura nem apagar a raiz antiga. Qualquer migração futura entre armazenamento local e storage de Space exige decisão do owner de dados e fluxo explícito, verificável, sem sobrescrita e reversível que preserve a raiz antiga até confirmação.
- **Studio** tem produto portátil canônico em `ordax-apps/apps/studio/`, mas ainda não tem um pacote executável pelo boundary público do OS. No `ordax-apps/main` verificado em 2026-10-22 (`ba1d2df1`), `app.json` declara `0.15.9` e `releaseMode: component-slot`, mas não existe `apps/studio/src/runtime.mjs` nem `apps/studio/compatibility.json`; a própria auditoria do Apps classifica o Studio como `not-assessed-no-package-boundary`, e `migrations/studio.externalization.json` mantém `cutover_allowed:false`. O `system/apps/studio/runtime.mjs` local é uma integração Native `git-app` distinta (`STUDIO_VERSION=0.1.0`), não o runtime portátil nem substituto compatível. Antes de retirar essa integração, Apps precisa publicar o runtime e descriptor compatíveis, e OS precisa comprovar paridade Native/Web, instalação/ativação verificada, isolamento, saúde, rollback, reinstalação offline e boot USB sem Studio. Não duplicar produto portátil, tratar o manifesto como pacote executável ou apagar a integração enquanto esses gates estiverem fechados.
- Fonte de app, integração do host e estado de distribuição são fatos distintos. Nenhum corte de fonte comprova publicação ou instalação de aplicativo externo.
- `ordaxsystems/ordax-runtime`: host Windows e execução de capacidades do dispositivo.
- `ordaxsystems/ordax-platform`: Product MCP, Control Plane e conectores de provedores (ChatGPT/Grok etc.). Plugin é conector, não outro Studio.

**Loja não é owner de código nem de instalação.** Todos os aplicativos removíveis do catálogo verificado devem ser encontráveis na Loja: se instalados, mostrar Abrir/Atualizar/Desinstalar; se ausentes com pacote elegível e verificado, Instalar; senão, indisponibilidade verdadeira. Componentes estruturais (Conta, Ajustes, Sistema, Loja) são integrados e não removíveis. A Loja precisa de projeção real para componentes bundled e component-slot; hoje o `verified-store-projection.mjs` cobre somente o caminho de componentes externos verificados. Isso é um gap de integração, não motivo para duplicar inventário. A composição de aplicações agora rejeita conflito entre IDs bundled e slots assinados: nunca silenciar uma segunda fonte e fingir que o primeiro owner venceu.

## Defaults do primeiro perfil/instalação

A lista executável de **intenção de seleção** fica exclusivamente em `listFirstRunDefaultAppIds()`. Não mantê-la em outro manifesto nem afirmar que já está instalada. Ela contém Arquivos, Internet, **Aura** (app com ID estável `assistant`, fonte única em `ordax-apps/apps/assistant`), Notas, Calculadora, Relógio, Conversor, Calendário, Visualizador de Texto, Imagens, PDF, Mídia, Desenho, Cores, Mapa de Caracteres e Ferramentas. **SSOT de nome:** `ordax-apps/apps/assistant/app.json#title` é o nome da marca do app (a UI do pacote o importa diretamente). O `intelligence` do OS é o **destino estrutural da Surface**, cuja janela/rail/preview compartilham `system/services/surface/destination-catalog.mjs`, não outro app nem outro ID de instalação. Quando a distribuição assinada for montada, título de app em Launcher/Loja deve vir da apresentação verificada do próprio pacote e substituir qualquer fallback da Surface; não copiar `title` manualmente para um segundo catálogo permanente. O destino sistêmico existente continua transitório até esse gate; não anunciar SSOT visual entre repositórios como fechado antes de testar a composição real. A seleção de Aura continua `authority:none`: não ativa um pacote por nome, não instala na ausência de catálogo assinado e `source:absent` nativo, e respeita `user_removed:true` e o fim do First Run. O motor de IA e os contratos `ordax.intelligence/1` e `ordax.local-ai/1` continuam pertencendo ao OS; a interface não mantém cópia de modelo, Memory ou permissões. O app Aura ainda tem distribuição independente bloqueada até as provas de assinatura, health, instalação e rollback do pacote `assistant`.

- Um app necessário no bootstrap deve estar disponível por um caminho verificável e compatível antes de retirar sua fonte do OS. A presença de um app na seleção inicial ou em uma imagem anterior não prova que sua instalação externa esteja ativa.
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
2. **Fonte:** os seis cortes para Apps estão concluídos. **A executar:** concluir o handoff remove-first de Arquivos após os gates de bootstrap e isolamento do Native; consolidar a integração local do Studio após as provas de paridade e lifecycle. Nunca publicar duas fontes.
3. **A executar:** produzir/verificar artefatos assinados e entrega offline inicial; montar pré-instalação na autoridade de instalação da plataforma.
4. **A executar:** fazer Loja mostrar apps bundled e externos com inventário verificado e permissões de desinstalação reais, preservando App Data.
5. **A executar:** E2E de primeira instalação, desinstalação persistente, reboot, reconexão, reinstall voluntário, rollback e Store; então promover release.

SSOTs existentes: `system/services/apps/delivery-policy.mjs`, `system/services/apps/mvp-delivery-policy.mjs`, `docs/contracts/runtime-component-package.json`, `ordax-apps/ordax-apps.workspace.json`, migrações individuais e o catálogo verificado da Loja.
