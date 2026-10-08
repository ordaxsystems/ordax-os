# Atualizar tudo — fila de solicitações da Loja OrdaX

Status: **implementação isolada da orquestração authority:none**. Não afirmar
que está habilitada na Surface ou que instala atualizações no dispositivo.

## Responsabilidade única

O owner `system/services/apps/store-update-request-batch.mjs` recebe o
`ordax.app-store-catalog-port/2` e o **mesmo**
`ordax.app-lifecycle-request-port/1` já utilizado pelo botão individual.
Seu propósito é converter um clique explícito em solicitações **individuais**
e sequenciais com IDs seguros fornecidos pela Surface. Não possui
instalador, downloader, cache paralelo, trust root, gerenciador de arquivos
ou persistência próprios. Estado do catálogo continua no port canônico.

O resultado `ordax.store-update-request-batch/1` usa
`state: requests-processed` para indicar apenas que **pedidos foram
processados**. `acceptedRequests` NÃO significa apps atualizados:
instalação, health, promoção e rollback somente podem ser certificados
pelo lifecycle do OS e por um novo snapshot de estado Native verificável.

## Contrato da fila

- A lista inicial contém somente apps instalados com candidato mais novo
  e verificado, `updatable=true`, identidade/provenance verdadeiras.
- Antes de cada solicitação, o mesmo catálogo é lido e validado de novo:
  se o candidato ou a versão mudou, aquele pedido é descartado. Se
  o catálogo se tornou indisponível/inválido, a fila interrompe os
  demais pedidos sem bypass. O snapshot inicial inválido também retorna
  `catalog-unavailable` sem lançar exceção na Surface nem delegar pedido.
- `requestIdFactory(appId)` deve ser injetada pela Surface a partir da
  fonte de entropia segura existente (`createStoreRequestSessionId`)
  e de um ordinal por sessão. Se não houver entropia ou identidade
  válida/única, nada mais é enviado. Não usar `Date.now()` ou contador
  global como fonte de identidade. Um conjunto bounded (até 4096 IDs)
  impede reuso de `requestId` entre lotes da mesma instância, inclusive
  para versões diferentes: o limite esgotado falha fechado e exige nova
  instância, sem remover provas de identidade anteriores.
- Solicitações são encaminhadas pelo `requestLifecycle` canônico com
  `source=store`, `operation=update`, `authority=none`. As respostas
  são validadas contra cada identidade de solicitação, sem confundir
  exceção ou rejeição com aceitação.
- Um clique repetido durante a fila reutiliza a mesma Promise. Os apps
  que tiveram o pedido aceito não são solicitados novamente para a mesma
  dupla versão instalada/candidata enquanto a projeção não mudar.
- `cancelPending()` impede novos pedidos da fila; não promete cancelar,
  interromper ou reverter o que o Native já aceitou.
- Uma falha individual é explicitada; não é convertida em sucesso de
  lote ou instalação. Os resultados são apenas observações efêmeras,
  não um inventário paralelo.

## Limites do MVP e integração

A ligação visual de **Atualizar tudo** é candidata nesta integração
de `system/surface/ui/store-overview-controls.mjs`, empilhada sobre a
reconciliação de Ajustes/IA #1482 para não sobrescrever Store/Native
em desenvolvimento simultâneo. O botão só aparece em **Atualizações**
quando o catálogo está `ready` e fica indisponível se não houver
candidatos elegíveis, port de lifecycle ou ID de sessão seguro.
A Surface reutiliza o mesmo `createStoreRequestSessionId` do botão individual
e mantém o contador de solicitações no mesmo escopo de montagem.

A UI não executa instalações; apresenta contadores de pedidos aceitos,
rejeitados e ignorados sem afirmar sucesso de promoção. Um clique repetido
não cria segunda fila, e as ações individuais permanecem bloqueadas enquanto
o lote estiver ativo. A Surface cancela pedidos **ainda não enviados**
ao trocar de aba, receber catálogo alterado ou desmontar; pedidos já
delegados continuam sob a responsabilidade da plataforma.

Esta ligação ainda precisa de provas completas no HEAD, integração segura
da PR e publicação posterior pelo canal de release do OS. Portanto,
**não está ativada no MVP publicamente distribuído**.

Atualização automática **não está ativada**. Ela precisa consumir as
mesmas solicitações canônicas, apenas depois que policy/preferências,
assinatura, compatibilidade de hardware, janela de rede/energia e
instalação Native saudável forem demonstradas. Nunca duplicar
lifecycle nem conceder permissões sem autorização.

A Base A/B e aplicativos bundled têm outros canais de atualização.
Candidatos unsigned do `ordax-apps` não são automaticamente instaláveis.

## Evidência

`tests/test_store_update_request_batch.mjs` valida serialização,
duplo clique, evolução do catálogo durante o lote, recusa Native,
respostas malformadas, identidade insegura/duplicada, cancelamento,
ausência de updates e invalidação da projeção. Esses testes rodam no
workflow canônico `first-party-app-delivery.yml`.
