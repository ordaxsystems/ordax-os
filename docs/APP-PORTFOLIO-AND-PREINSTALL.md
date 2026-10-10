# Portfólio first-party e aplicativos iniciais

Status: **política de seleção implementada; pré-instalação física e publicação pendentes de comprovação**. Esta decisão não altera o payload USB atual nem a instalação dos usuários. A implementação de seleção sem autoridade está em `system/services/apps/first-run-selection.mjs`, com testes em `tests/test_first_run_selection.mjs`.

## Regra definitiva de ownership

- `ordaxsystems/ordax-os`: sistema/base, Surface, App SDK, Identity, Intelligence, Memory, permissões, Loja estrutural, Conta, Ajustes, Sistema, verificação, ativação e desinstalação de pacotes.
- `ordaxsystems/ordax-apps`: **destino canônico de fonte dos aplicativos first-party removíveis**, incluindo os que podem vir pré-instalados no OS. Versão do app e artefato pertencem a seu próprio owner; apps podem ser pré-instalados sem terem uma segunda cópia de código no OS.
- **Transição de source**: Arquivos, Internet, Projetos, Assistente, Atividade e Rede ainda têm source canônico no OS até os gates `migrations/*.externalization.json` autorizarem o cutover remove-first. O diretório de preparação no Apps não dá autoridade de execução nem permite fonte duplicada.
- `ordaxsystems/ordax-runtime`: host Windows e execução de capacidades do dispositivo.
- `ordaxsystems/ordax-platform`: Product MCP, Control Plane e conectores de provedores (ChatGPT/Grok etc.). Plugin é conector, não outro Studio.

**Loja não é owner de código nem de instalação.** Todos os aplicativos removíveis do catálogo verificado devem ser encontráveis na Loja: se instalados, mostrar Abrir/Atualizar/Desinstalar; se ausentes com pacote elegível e verificado, Instalar; senão, indisponibilidade verdadeira. Componentes estruturais (Conta, Ajustes, Sistema, Loja) são integrados e não removíveis. A Loja precisa de projeção real para componentes bundled e component-slot; hoje o `verified-store-projection.mjs` cobre somente o caminho de componentes externos verificados. Isso é um gap de integração, não motivo para duplicar inventário.

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
| **Rede (Network)** | Comunidades, mensagens e colaboração | Não confundir com infraestrutura de conectividade ou pares/dispositivos. |
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
- O plano continua `authority:none`. Não cria solicitações, não grava intenção de remoção e não comprova pré-instalação física.
- O catálogo indisponível continua indisponível na Loja. Apps não publicados/verificados não aparecem artificialmente como disponíveis.
- A próxima etapa de produção exige um port nativo de inventário **combinado** (bundled e component-slot) e um registro durável de primeiro provisionamento/remoção no owner de instalação, antes de delegar ações.

## Fases de integração (não equivale a release pronta)

1. **Feito:** inventário de owners, decisões de nome, seleção declarativa e seção Essenciais filtrada pelo catálogo verificado, com testes de status real e negação de reinstalação.
2. **A executar:** reconciliar IDs/manifests do Apps, completar os 6 cutovers com provas remove-first, nunca publicar duas fontes.
3. **A executar:** produzir/verificar artefatos assinados e entrega offline inicial; montar pré-instalação na autoridade de instalação da plataforma.
4. **A executar:** fazer Loja mostrar apps bundled e externos com inventário verificado e permissões de desinstalação reais, preservando App Data.
5. **A executar:** E2E de primeira instalação, desinstalação persistente, reboot, reconexão, reinstall voluntário, rollback e Store; então promover release.

SSOTs existentes: `system/services/apps/delivery-policy.mjs`, `system/services/apps/mvp-delivery-policy.mjs`, `docs/contracts/runtime-component-package.json`, `ordax-apps/ordax-apps.workspace.json`, migrações individuais e o catálogo verificado da Loja.
