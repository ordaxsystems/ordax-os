# Loja Web — catálogo oficial e demonstração

Incremento da Surface aprovado pelo pedido de continuação da Loja. Owner:
OrdaX OS Surface; serviços de Apps/Components continuam owners do catálogo
verificado e do lifecycle. Nenhum produto ou serviço de instalação é criado.

## Fonte de verdade e limites

A composição Web fornece o port público `ordax.app-store-catalog-port/2`,
com `authority: none`, à apresentação única da Loja.
`StoreCatalogProvider` adapta sua assinatura ao React; `official.ts` valida
e projeta snapshots usando o contrato canônico. Esse cache serve somente à
apresentação. Notificações acionam nova leitura do port; seu payload não é
aceito como fonte de dados. Revogação, resposta inválida ou erro de leitura
removem as entradas antigas. Unsubscribe impede callbacks tardios.

Ainda não existe transporte público Web para consultar o catálogo de um
dispositivo/conta ou solicitar lifecycle. A composição usa o port indisponível
canônico, sem endpoint privado Native, credenciais presumidas ou catálogo
simulado como fallback. Biblioteca e atualizações informam essa ausência.
Operações reais ficam indisponíveis; flags de elegibilidade não são execução,
e uma eventual solicitação aceita não poderá ser apresentada como concluída.

O candidato de IA local é importado de
`system/services/local-ai/model-candidate.generated.mjs`, gerado pelo
source-lock do OS. Seu identificador, motor, formato, quantização, licença e
tamanho não vêm do catálogo demonstrativo. Isso não comprova instalação,
disponibilidade Web, compatibilidade, requisitos de memória ou desempenho.
Instalação independente continua indisponível.

Não são inferidos publisher, plataformas, permissões, capacidades ou
changelog ausentes do contrato de Apps. A página de detalhes mostra versões,
estado, verificação de identidade/procedência e motivo de bloqueio informados
pelo host. Uma falha retém o estado/versionamento fornecido pelo catálogo.

## Apresentação única

A Loja abre em modo oficial. A demonstração exige ação explícita e conserva
as oito seções e os fluxos previstos pelo layout aprovado. Ambos os modos
usam os mesmos componentes e tokens. A troca desmonta a sessão anterior,
descartando timers, operações, favoritos e histórico simulados. Exemplos de
conexão, habilitação e instalação não contaminam o catálogo oficial.

A demonstração permanece uma ferramenta de avaliação do visual e das
funcionalidades futuras. Ela não substitui integrações pendentes nem permite
remoção de recursos planejados.

## Aceite e risco

Typecheck e build estritos; teste do port/projeção e renderização com snapshot
real do contrato; testes de revogação, invalidez, cache estável e cleanup.
A prova Chromium cobre desktop/mobile, início oficial, biblioteca demonstrativa,
progresso simulado e troca com operação pendente sem vazamento de estado.
A integridade da referência permanece verificável por ajustes reversíveis.

O recibo de build inclui o contrato, suas dependências e o catálogo/lock de IA.
CI verifica recompilação determinística e regressões Native. Risco residual:
transporte Web e lifecycle ainda pendentes; sem transporte, a UI não identifica
pacotes instalados na conta/dispositivo. Este incremento publica source e
candidato, sem assinar release nem ativar produção.
