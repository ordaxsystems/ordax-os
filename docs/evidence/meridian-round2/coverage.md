# Meridian Round 2 — jornadas do sistema

Evidência de frontend de 13/10/2026. Esta rodada amplia a exploração visual; não declara Meridian pronto para merge, release ou uso físico. A validação técnica independente permanece pendente.

## 1–3. Branch, ponto de partida e commits

- Branch: `codex/meridian-design-lab`.
- HEAD inicial: `25e0f57` — correções da auditoria preservadas.
- Baseline histórico: `69a8937`, mantido no histórico.
- Implementação desta rodada: `050539b16d07b94e2a04b655f5116c0dbe588687`.
- Este relatório, capturas e instruções são entregues em um commit documental subsequente na mesma branch.
- Checkout neste computador: `C:/Users/TONECOS/Documents/github/ordax-apps/tools/assistant-host/.data/os-meridian-lab`.
- Origem: `https://github.com/ordaxsystems/ordax-os.git`.

Os três artefatos da auditoria foram lidos integralmente antes da implementação: [relatório](../meridian-audit-2026-10-13/relatorio.md), [inventário](../meridian-audit-2026-10-13/inventario.md) e [fluxos](../meridian-audit-2026-10-13/fluxos.md). Permanecem evidências históricas sem alterações; as prioridades abaixo não substituem seus critérios ou os contratos canônicos.

## 4–5. Superfícies e jornadas

A apresentação continua em `system/surface/experiments/meridian/`, montada exclusivamente por `tools/meridian-preview/`. O trabalho está agrupado em experiências, com detalhes progressivos:

| Experiência | Entrada | Percurso visual |
|---|---|---|
| Primeiro uso | Sistema / Primeiro uso | Boot, boas-vindas, idioma, teclado, região, rede opcional, proteção local, conta opcional, privacidade, dispositivo, revisão, Central ou Desktop |
| Continuidade portátil | Faixa operacional / Sistema | Mídia, host, volumes, persistência, uso local, indisponibilidade e falta de espaço |
| Sessão e energia | Conta / Sistema | Identidade local versus cloud, expiração, saída, troca, lock, trabalho pendente, reinício e desligamento |
| Atualização e recuperação | Faixa operacional / Sistema | Consultar, revisar, baixar, verificar, preparar, adiar, reiniciar, confirmar saúde, retornar ao conhecido-bom; recuperação em tela independente |
| Intelligence | Intelligence / Explorar jornada | Fontes e modelo, streaming, sugestão, proposta, revisão, aprovação pontual, execução ilustrativa, recibo e falha |
| Catálogo e composição | Descobrir / Perfis | Origem, versão fictícia, requisitos, trust, permissões, candidato, staging, ativação, saúde, configuração, atualização e remoção |
| Spaces | Seletor / Spaces | Impacto da troca, continuidade dos rascunhos, membros, saída, revogação, indisponibilidade e intenção de provisionamento |
| Arquivos e Ajustes | Arquivos / Ajustes | Operações revisáveis sobre referências, conflitos e estados de volume; ajustes por capacidade e confirmação visual |
| Dispositivos | Dispositivos | Descoberta, confirmação bilateral de exemplo, capacidade, conexão, expiração, recusa e revogação |
| Comunicação | Notificações / Mensagens | Origem e prioridade, leitura, dismiss/restauração, Não perturbe; participação opcional, entrega ilustrativa e moderação |

`demo/storyboards.mjs` concentra o conteúdo das jornadas. `journeys/navigation.mjs` conserva percurso e escolhas de apresentação. `journeys/view.mjs` renderiza os mesmos componentes de revisão, progressão, erro e resultado. Store e perfis compartilham uma definição de lifecycle visual; não têm duas implementações de instalação.

## 6. Itens P0: cobertura visual acrescentada

“Representado” abaixo significa roteiro navegável de demonstração. Não encerra critérios que exigem dados, autorização, persistência ou execução reais. Não foram reclassificadas as 196 linhas da auditoria como concluídas.

| IDs do inventário | Avanço nesta rodada | Limite |
|---|---|---|
| M-001–M-011, M-013 | Boot, OOBE, conta opcional, sessão, lock, energia, falha e recuperação | Não inicializa kernel nem autentica usuário |
| M-014–M-021 | Identidade da mídia/host, persistência, volumes, offline, rede e atualização portátil | Medidas fictícias; nenhuma prova física |
| M-022, M-023, M-026, M-027, M-033, M-035 | Central contextual com acessos a sistema, IA, Spaces, notificações e arquivos | Projeções em memória, não estado operacional |
| M-040, M-042, M-045, M-047–M-049 | Rascunhos e janelas por contexto, lock, Ajustes e arquivos no Desktop | Lifecycle canônico não integrado; launcher/dock anteriores preservados |
| M-050–M-052, M-056, M-057, M-061, M-062 | Fonte/modelo, resposta, proposta, revisão e recibo distintos | Executor, router, memória e grants não acionados |
| M-068–M-070, M-073 | Troca explícita, impacto, contexto ausente/revogado e separação de rascunhos | Provisionamento/membership reais continuam fora da prévia |
| M-093, M-094, M-101–M-105 | Catálogo, requisitos, permissões, instalação, atualização e remoção ilustrativas | Publisher e versão não constituem trust ou release |
| M-106–M-109, M-111, M-112, M-114–M-116 | Cadastro/entrada opcionais, expiração, logout, privacidade e orientação de recuperação | Sem coleta de credenciais; sync é escolha visual |
| M-125–M-128 | Pairing bilateral, status, escopo, expiração, indisponibilidade e rede | Nenhum dispositivo real descoberto ou conectado |
| M-132, M-133, M-135–M-137, M-139–M-143 | Áreas de teclado, idioma, bateria, energia, armazenamento, segurança, acessibilidade e horário | Campos de exemplo; sem configuração do host |
| M-144, M-145, M-148, M-151, M-153, M-154 | Referências, volumes, ações, contexto de arquivos e notificações | Operações do Files não duplicadas como app funcional |
| M-160, M-164–M-170 | Revisões de alcance ligadas às jornadas correspondentes | Não é matriz global de permissões nem emissão de grants |
| M-171–M-179 | Update, progresso, conhecido-bom, rollback, recovery, falha, versão editorial e reinício | Nenhuma mudança na mídia ou no sistema |
| M-180–M-193 | Offline, sem conta, loading, empty, falha, bloqueio, capacidade indisponível e pendências | Estados selecionados no ensaio; não telemetria |

## 7. Itens P1: cobertura visual acrescentada ou aprofundada

| IDs | Avanço e limite |
|---|---|
| M-024, M-028, M-029, M-032, M-034 | Entradas contextuais para atividade, perfis, Store, dispositivos e comunicação; dados continuam editoriais |
| M-054, M-058 | Sugestão separada da ação e percurso/recibo da demonstração; sem histórico persistente de IA |
| M-064–M-067, M-071, M-074 | Descoberta e revisão de Space, intenção de criação/provisionamento, membros e continuidade; recibo não cria Space autorizado |
| M-075–M-089 | Catálogo e lifecycle comum de perfis, configuração e comunidade; exemplos setoriais mantidos, Legal BR explicitamente conceitual |
| M-090–M-092, M-095–M-097, M-100 | Catálogo existente e busca/filtros preservados, detalhes compartilhados entre tipos; não há install adapters específicos por categoria |
| M-113, M-117–M-121, M-123, M-124 | Dispositivos associados e revisão de capacidade; não executa câmera, áudio ou impressão |
| M-130, M-131, M-134, M-138 | Ajustes de áudio, tela, região e usuários como tópicos revisáveis |
| M-146, M-147, M-149, M-150, M-152 | Favoritos, volumes, busca, preview e compartilhamento de referências; operações são intenção/recibo visual |
| M-155–M-158 | Participação consentida, conversa, grupo, estados de envio e moderação; não existe entrega de mensagem |

As ideias P3 de comparação de impacto e recovery explicativo foram exploradas. A antecipação proativa de perda de rede não foi implementada.

## 8. Deliberadamente pendente

- Instalação Native/Creator executável (M-012): apenas orientação e bloqueio no roteiro de recuperação.
- Memória persistente e histórico completo de IA (M-053/M-058), automações reais, tarefas duráveis, voz e captura de microfone.
- Novos workspaces, snapping e overview avançados; continuam com o owner canônico de workspace.
- Tradução completa: selecionar idioma não traduz o estudo, conforme aviso da própria tela.
- UI específica de cada perfil/módulo e integração; catálogo não comprova implementação do domínio.
- Revogação, autorização, isolamento de dados e persistência de produção. Ocultar fixtures no DOM não é proteção real de dados.
- Serviços, backend, API, migrations, publicação, site/conta web e conexão ao host real.
- Matriz completa de a11y, tamanhos, materiais, regressões e todos os caminhos de interrupção.

## 9–10. Mocks e isolamento

Os novos exemplos incluem USB de 64 GB/18,4 GB usados, host Notebook do estúdio, Entregas A/B, código de pairing não válido, publisher/versões fictícias, progressos e recibos editoriais. Nenhum valor foi obtido do computador ou de serviços reais.

A composição da prévia injeta explicitamente os roteiros. Views recebem dados; não importam providers de backend. O estado de percurso, rascunhos, fontes e recibos vive na memória desta página e desaparece ao recarregar. As escolhas de setup não gravam first-run. O fluxo de criação de Space só produz um recibo de intenção; os antigos handlers de instalação/perfil/criação de Space do dispatch foram retirados em favor do roteiro visual único.

O renderer não faz fetch, pairing, instalação, escrita de arquivos, autenticação ou execução. O host existente mantém allowlist de recursos visuais, loopback e CSP com `connect-src 'none'` e `form-action 'none'`. Nenhum novo endpoint, pacote de runtime ou dependência foi adicionado.

## 11. Owners e contratos preservados

| Área | Referência canônica consultada | Papel desta rodada |
|---|---|---|
| Sessão, boot e energia | `system/contracts/local-session.mjs`, `power-actions.mjs`, `docs/contracts/first-run.json` | Apresentar local versus cloud e escolhas opcionais |
| Mídia/persistência | `docs/contracts/physical-prepared-media.json`, `portable-usb-v2.json` | Mostrar alvo Portable v2: ESP + DATA; dados e imagens internas compartilham DATA |
| Update/recovery | `update-status.mjs`, `recovery-status.mjs`, `docs/UPDATE-NOMENCLATURE.md` | Não confundir Entrega, versão de produto, PR, health ou ativação |
| Identity/conta | `identity-session.mjs`, `account-lifecycle.mjs` | Identidades fictícias, sem credenciais ou serviço de login paralelo |
| Spaces/perfis | `spaces.mjs`, `space-selection.mjs`, `profile-activation-state.mjs`, `profile-provisioning.mjs` | Propostas e projeções; Surface não concede membership nem execução |
| Apps/Store | `app-store.mjs`, `app-activation.mjs`, Component Manager/trust | Instalação continua sob os owners; catálogo não ganha autoridade |
| Intelligence | `INTELLIGENCE-HANDOFF.md`, `model-router.mjs`, `action-executor.mjs` | Separar modelo, fontes, proposta, consentimento pontual e recibo |
| Dispositivos/rede | `device-capabilities.mjs`, `network-management.mjs`, `network-transport-v2.mjs` | Demonstrar capability, indisponibilidade e participação explícita |
| Files/notificações | `recent-files.mjs`, `notifications.mjs`; produto Files em Apps | Referências e ações propostas, sem segunda implementação |
| Desktop | `system/surface/workspace/presentation.mjs` | Reusar política de troca; não promover janelas de exemplo a window manager |

Os `.mjs` abreviados nesta tabela ficam em `system/contracts/`. A geometria de três partições descrita em texto histórico não foi copiada para o exemplo Portable v2. Isso não declara mídia física preparada ou homologada.

## 12–15. Central, Desktop, USB e primeiro uso

A Central ganhou uma faixa operacional com origem USB, sessão local, dados, rede, estado de atualização e janelas. Pendência de reinício volta a aparecer após fechar a revisão. O detalhe fica em painéis, sem transformar cada estado em um novo card permanente.

Central e Desktop usam a mesma identidade e seleção explícita de Space. Trocar contexto guarda a apresentação de janelas, rascunhos e conversa; retornar restaura a sessão correspondente. Lock retira a árvore de conteúdo e o desbloqueio de exemplo restaura o trabalho. Não há persistência depois do refresh.

O USB distingue mídia de host, imagem somente leitura de dados pessoais e rascunhos ainda não salvos. Volumes cheio/ausente/somente leitura são condições do roteiro.

O OOBE ocupa uma tela independente. Rede e conta podem ser puladas, há voltar/retomar e estados de erro. Falhar uma entrada e seguir sem conta conserva a escolha local, inclusive pelo atalho final para Desktop. A escolha offline chega à faixa operacional; não é detectada pela URL.

## 16–20. Intelligence, Store, Spaces, perfis e identidade

Intelligence diferencia fontes/modelo, resposta em streaming cancelável, sugestão, proposta revisável, aprovação pontual, execução ilustrativa e recibo. Mudança de escolha invalida o aceite do passo. O streaming só revela um texto fixo; não é chamada a modelo. Memória permanece uma área conceitual de controle de contexto.

Store e perfis compartilham revisão de origem, requisitos, permissão, download, verificação, staging, ativação e health. Falha de trust bloqueia o caminho. Remoção revisa documentos e dependências; revisitar detalhes não ressuscita o indicador de instalação. O recibo permanece marcado como demonstração. Não há abertura de pacote real após health.

Spaces mostram impacto antes de trocar; a troca não equivale a apagar rascunhos. Uma seleção ausente não cai automaticamente no primeiro Space. Criação e membership são apresentados como intenção. O perfil Legal BR não oferece instalação/ativação e permanece conceitual. Os demais exemplos setoriais não ganham disponibilidade real por aparecer no catálogo.

Conta distingue quatro conceitos: usuário local, conta cloud, perfil profissional e Space. Expiração/saída escondem o contexto remoto; uso local continua possível. O login de exemplo não recebe senha, token ou e-mail. Não foi criada conta web.

## 21–23. Update/recovery, ferramentas e estados

Update usa Entregas A/B claramente fictícias; tem revisão, espaço/compatibilidade, download pausado, integridade recusada, staging, reinício adiado, health e retorno ao conhecido-bom. Não oferece ignorar verificação. Recovery tem entrada própria, diagnóstico sanitizado, mídia ausente, opção indisponível, impacto, falha e retorno; não depende da Central renderizada por trás.

Files usa as referências do Space e o mesmo roteiro a partir da lista ou da janela existente. Criar/renomear/copiar/mover/lixeira/restaurar/compartilhar resultam em revisão e recibo visual; não alteram filesystem. Ajustes organiza tópicos do sistema com escolhas limitadas e confirmação; nenhuma chave simula autoridade sobre hardware. Dispositivos mostram código bilateral ilustrativo, escopo, indisponibilidade e encerramento.

Notificações usam os eventos do contexto, com origem, prioridade, filtros de não lidas/todas/histórico, leitura, dispensa, restauração e Não perturbe de apresentação. Comunicação explicita consentimento de presença, membership, pendente/entregue/falhou/retry e moderação.

Interrupções aparecem nas etapas correspondentes, dentro de “Explorar interrupções desta etapa”. O seletor anterior de cenários globais permanece para explorar a Central e preservar a auditoria; não substitui os novos estados de operação.

## 24. Acessibilidade e responsividade

- Diálogos nativos mantêm foco contido; retorno ao controle de origem e rascunhos da auditoria preservados.
- Etapas têm título focável, progresso com label, inputs nomeados, aceite explícito e erro com texto, não apenas cor.
- Argila/Grafite usam o mesmo markup e tokens Meridian; Claro/Escuro/USB canônicos não foram alterados.
- No mobile, a jornada usa uma coluna e diálogo inferior; o percurso anterior se compacta, preservando a etapa atual.
- Textos de detalhe novos têm em geral 12–15 px e corpo de leitura de 15 px. Não é declaração de conformidade WCAG.
- Recuperação em 320×568 e Central em 390×844 passaram a checagem de largura. Rolagem vertical é permitida nas jornadas extensas; não comprimimos uma revisão até torná-la ilegível.

## 25. Verificações rápidas

- Sintaxe: 20 módulos da experiência e dos runners analisados com `node --check`.
- `git diff --check`: sem erro de whitespace.
- Preview local na porta 4203; HTTP 200.
- `node tools/meridian-preview/round2-smoke.mjs`: **23 verificações passaram**, nenhuma exceção JavaScript não tratada; detalhes em [quick-check.json](quick-check.json).
- Percursos verificados: pendência de atualização, integridade recusada, rascunho Central, troca de Space e retorno, lock/unlock, saída/retorno de conta, notificações, recibo de IA, instalação/remoção de exemplo, OOBE com falha de login e escolha local/offline, Desktop, recovery estreito e bloqueio de Legal BR.
- Capturas inspecionadas em desktop e mobile. O runner espera animações finitas antes de capturar.
- `browser-smoke.mjs` preserva as asserções da auditoria anterior; somente os dois trajetos de seleção de Space foram atualizados para passar pela revisão de impacto. A matriz completa desse runner **não foi repetida** nesta rodada.

O browser integrado não respondeu ao bootstrap da ferramenta. A inspeção usou o runner Chromium já existente no repositório, com perfil descartável e host local. Durante o desenvolvimento houve um timeout inicial e correções no roteiro de automação (seletor e navegação); a execução final focada passou. Não foi executada suíte Foundation, Node completa, build, CI, imagem/kernel/USB ou validação física. Falhas canônicas registradas na auditoria anterior não são consideradas resolvidas por esta rodada.

## 26. Riscos e revisão independente pendente

O controller ainda reconstrói a árvore em várias interações; não houve reescrita de runtime. Os mapas de rascunhos/percurso são exclusivamente de apresentação. A auditoria deve revisar foco em todas as transições, crescimento de histórico, restauração de estado, trocas repetidas de identidade/Space e todos os caminhos de falha.

Há simplificações conscientes: configuração de perfil não provisiona ferramentas, escolhas de hardware não mudam o host, indicadores de catálogo não abrem executáveis, autorizações são somente texto de revisão e cenários não equivalem a políticas. Ainda há copy editorial pequena nas superfícies anteriores. Contraste, zoom, teclado completo, leitores de tela e matriz de regressão precisam de auditoria própria.

As novas telas são preparadas para discutir projeções de contratos; os view models não devem ser promovidos a modelos de domínio. Integração futura exigirá adapters explícitos dos owners e reconciliação com a main então vigente, incluindo os gates de integridade da composição Web. Esta branch não está pronta para merge.

## 27. URLs e capturas

Host local: [Central](http://127.0.0.1:4203/), [Desktop](http://127.0.0.1:4203/?surface=desktop), [Grafite](http://127.0.0.1:4203/?material=ink), [Primeiro uso](http://127.0.0.1:4203/?journey=setup), [Atualização](http://127.0.0.1:4203/?journey=update), [Recuperação](http://127.0.0.1:4203/?journey=recovery&material=ink), [Sistema/Ajustes](http://127.0.0.1:4203/?area=settings).

As URLs só funcionam neste computador enquanto o host estiver ativo. Consulte [instruções de execução](../../../tools/meridian-preview/README.md).

- [Central desktop](captures/central-1440.png)
- [Central mobile](captures/central-390.png)
- [Revisão recusada por integridade](captures/update-invalid-1440.png)
- [Primeiro uso mobile](captures/setup-network-390.png)
- [Recuperação Grafite em 320 px](captures/recovery-320.png)
- [Intelligence](captures/intelligence-1440.png)

## 28. Integridade da main

A referência local `main` permaneceu em `fafed4a8916587ad35bc07c2f3baa1a60d561b1e` durante esta rodada. Nenhum checkout da main, merge, reset, force push ou publicação foi realizado. Nenhum push foi feito nesta rodada. Não se afirma que a main remota deixou de avançar por trabalho de outros chats.

A branch preserva `25e0f57` e `69a8937` como ancestrais. Os artefatos da auditoria de 13/10/2026 permanecem intactos. A próxima etapa é auditoria independente da proposta, não promoção automática.
