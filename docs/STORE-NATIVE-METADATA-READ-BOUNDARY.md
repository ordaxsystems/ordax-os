# Loja OrdaX — consulta Native de estado com limites

**Escopo:** somente a projeção de leitura em \`system/services/apps/verified-store-projection.mjs\`. A lista de componentes, os artefatos, a política first-party e os estados \`current\` permanecem em seus owners canônicos. Este serviço **não** assina, instala, remove, atualiza, ativa ou executa aplicativos.

## Defeito corrigido

O serviço consultava o estado Native dos componentes em sequência, de modo que a latência total crescia linearmente com o número de aplicativos. Uma consulta que nunca resolvesse impedia indefinidamente a publicação da projeção da Loja, mesmo quando outros componentes tinham respostas válidas. Uma consulta de catálogo anterior também continuava consumindo trabalho quando o catálogo verificado mudava.

## Contrato de comportamento

- O conjunto de IDs ainda é derivado de \`listExternalFirstPartyComponentIds()\` unido às entradas **já verificadas** do catálogo; não há inventário paralelo.
- Leituras de \`current\` usam no máximo **quatro consultas simultâneas por refresh**, com tempo máximo configurável e limitado (padrão: 5 segundos por consulta); a lista é sempre montada na ordem determinística dos IDs.
- Uma consulta indisponível/expirada gera entrada \`blocked\` com motivo \`activation-state-unavailable\` **se** o app estiver presente no catálogo verificado. O serviço **nunca interpreta timeout, HTTP 404 ou resposta inválida como ausência ou permissão de instalação**.
- Ao chegar um catálogo novo ou destruir o serviço, a geração anterior é abortada e seus resultados não podem atualizar a projeção.
- \`AbortSignal\` cancela chamadas Native cooperativas, mas também há limite local de tempo para impedir bloqueio quando a implementação de fetch não respeita o sinal.
- Apps desconhecidos continuam \`first-party-delivery-policy-unavailable\`; o serviço não consulta o runtime para IDs sem política.

## Evidência automatizada

\`\`\`sh
node --test tests/test_verified_store_projection.mjs
\`\`\`

Os testes incluem concorrência limitada, ordenação estável, isolamento de uma consulta que nunca termina, cancelamento de catálogo antigo, rejeição de timeout inválido e liberação de consulta após \`destroy()\`. A CI **First-party App Delivery Foundation** já valida este teste; demais workflows do OS continuam sendo gates independentes.

**Limites de prontidão:** esta correção é de interface/consulta, não prova disponibilidade de publicação assinada, instalador Native, rollback, lifecycle nem Store pública no Stable. Esses gates permanecem fechados até evidência no owner da plataforma.


## Modelos de IA não são entradas de aplicativos

A Loja também possui a seção informativa **Modelos de IA**. Ela não adiciona
`appId` artificial ao contrato `ordax.app-store-catalog/2` e não chama
`requestLifecycle(install/update/remove)` para modelos.

A ficha inicial vem da projeção gerada do `source-lock.json` de Local AI,
validada por CI; não representa instalação, promoção, nem atualização disponível
da máquina. A leitura de compatibilidade é sob demanda e utiliza os adaptadores
Native existentes de inventário de hardware e métricas de sistema. Hardware
desconhecido ou desempenho não homologado aparecem explicitamente na UI.

Quando existir um canal de distribuição individual para modelos, deverá
compartilhar **o mecanismo assinado de componentes** (versão, hash, licença,
dependências, requisitos, staging, health, rollback) e publicar o estado
autoritativo desse canal. Não reutilizar lifecycle de aplicativos com uma
identidade falsa nem criar segunda Store, instalador, trust root ou updater.
