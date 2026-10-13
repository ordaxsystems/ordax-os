# Inventário comparativo Meridian Round 2

Referência: 25e0f57 → 4dffe52, com correções desta auditoria. As 196 linhas originais permanecem em [Round 1](../meridian-audit-2026-10-13/inventario.md). Prioridades e horizonte foram preservados.

O estado abaixo avalia **representação visual**, não entrega do produto. “Demonstrável” significa percurso reproduzível na prévia; “demonstrável com lacuna” indica cobertura parcial ou inconsistência editorial remanescente; “esboçado” significa texto, tópico ou exemplo sem interação específica completa. “Bloqueado por owner/contrato” explicita a dependência funcional. Nenhum item é classificado como pronto para adapter: os view models ainda não são projeções validadas dos contratos.

Validação: [relatório](relatorio.md), [matriz de fluxos](fluxos.md) e [matriz final](matrix-checks.json). Não há conclusão automática de MVP por presença de mock. Os critérios reais anteriores continuam aplicáveis.

## Core

Entrada, revisão e saída estão roteirizadas; boot, credencial, durabilidade e health reais permanecem com seus owners.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-001 | boot | P0 / MVP | A | demonstrável com lacuna | setup / identity / power / recovery; Exibir fase, mídia, falha recuperável e saída para diagnóstico; boot independe de conta. |
| M-002 | welcome | P0 / MVP | A | demonstrável | setup / identity / power / recovery; Distinguir boas-vindas reais de uma saudação editorial. |
| M-003 | onboarding | P0 / MVP | E | demonstrável com lacuna | setup / identity / power / recovery; Idioma → fuso → rede opcional → conta opcional → conclusão persistente. |
| M-004 | login local | P0 / MVP | A | esboçado | setup / identity / power / recovery; Consumir sessão local; não confundir desbloqueio com login cloud. |
| M-005 | lock | P0 / MVP | A | demonstrável | setup / identity / power / recovery; Bloquear, desbloquear e explicar falha sem revelar conteúdo do Space. |
| M-006 | sessão | P0 / MVP | E | demonstrável com lacuna | setup / identity / power / recovery; Explicitar usuário local, estado e persistência da sessão USB. |
| M-007 | shutdown | P0 / MVP | A | demonstrável | setup / identity / power / recovery; Confirmar, mostrar trabalho pendente e retorno de falha. |
| M-008 | restart | P0 / MVP | A | demonstrável | setup / identity / power / recovery; Separar reinício normal e aplicação de atualização. |
| M-009 | erros críticos | P0 / MVP | A | demonstrável com lacuna | setup / identity / power / recovery; Mensagem acionável, identidade do incidente e diagnóstico sanitizado. |
| M-010 | update | P0 / MVP | E | demonstrável | setup / identity / power / recovery; Consumir estado real; não inferir atualização de um aviso genérico. |
| M-011 | recovery | P0 / MVP | A | demonstrável | setup / identity / power / recovery; Entrada acessível mesmo quando a Surface normal não inicia. |
| M-012 | instalação Native em disco | P0 / MVP | A | bloqueado por owner/contrato | setup / identity / power / recovery; Mostrar bloqueio atual e plano autorizado; nenhuma ativação por esta auditoria. |

## USB

Portable v2, ESP + DATA e números fictícios estão explícitos; sem leitura do host, persistência ou prova física.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-013 | primeira execução | P0 / MVP | A | demonstrável | storage / setup / update / recovery; Distinguir primeiro uso, retorno e recovery; ligar ao OOBE canônico. |
| M-014 | persistência | P0 / MVP | A | esboçado | storage / setup / update / recovery; Explicar onde ficam arquivos, preferências e dados que sobreviverão ao reboot. |
| M-015 | storage | P0 / MVP | E | demonstrável com lacuna | storage / setup / update / recovery; Mostrar capacidade real do volume, reserva e falha de escrita; não soma fictícia. |
| M-016 | identidade do dispositivo USB | P0 / MVP | E | demonstrável com lacuna | storage / setup / update / recovery; Origem/mídia/host explícitos, sem inferir modo pela URL. |
| M-017 | offline | P0 / MVP | P | demonstrável com lacuna | storage / setup / update / recovery; Continuidade local com release conhecida e operações remotas pausadas. |
| M-018 | rede | P0 / MVP | E | demonstrável com lacuna | storage / setup / update / recovery; Conectar/tentar de novo sem tornar conta requisito de boot. |
| M-019 | update | P0 / MVP | A | demonstrável | storage / setup / update / recovery; Diferenciar Base, Surface e apps conforme releaseMode real. |
| M-020 | segurança | P0 / MVP | A | esboçado | storage / setup / update / recovery; Estado de trust, bloqueio e proteção de dados conforme política vigente. |
| M-021 | recovery | P0 / MVP | A | demonstrável | storage / setup / update / recovery; Conhecido-bom local, fallback e orientação sem depender da internet. |

## Central

Faixa operacional melhora origem, rede, dados, update e janelas. Host e detalhe da sessão ficam no painel; todos os indicadores são editoriais.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-022 | home | P0 / MVP | D | demonstrável | views/central / operations; Manter hierarquia editorial, revelar sessão/modo/capacidades disponíveis. |
| M-023 | contexto | P0 / MVP | D | demonstrável com lacuna | views/central / operations; Space/projeto/origem e escopo sempre explícitos; faltante não cai em outro Space. |
| M-024 | atividades | P1 / MVP | D | demonstrável com lacuna | views/central / operations; Consumir continuidade real e explicitar data/origem, sem histórico global indevido. |
| M-025 | widgets | P2 / pós-MVP | E | esboçado | views/central / operations; Contrato de composição e personalização antes de tornar cards extensões. |
| M-026 | Intelligence | P0 / MVP | D | demonstrável | views/central / operations; Compositor, resposta, cancelamento e indisponibilidade sem perder texto. |
| M-027 | Spaces | P0 / MVP | D | demonstrável | views/central / operations; Troca preserva isolamento; port indisponível recebe estado honesto. |
| M-028 | perfis | P1 / MVP | D | esboçado | views/central / operations; Mostrar perfil aplicado e compatibilidade, distinguindo profissão e identidade. |
| M-029 | Store | P1 / MVP | D | demonstrável | views/central / operations; Descoberta leva ao mesmo catálogo/gerenciador usado no Desktop. |
| M-030 | apps | P0 / MVP | D | esboçado | views/central / operations; Usar catálogo do owner Apps e capacidades do host; não promover apps fictícios. |
| M-031 | tarefas | P1 / MVP | D | esboçado | views/central / operations; Origem, conclusão, undo e erro ligados ao owner de trabalho pessoal. |
| M-032 | dispositivos | P1 / MVP | D | esboçado | views/central / operations; Estado conectado/desconectado coerente em todos os pontos. |
| M-033 | notificações | P0 / MVP | D | demonstrável | views/central / operations; Acesso ao centro único com leitura, dispensa e Não perturbe reais. |
| M-034 | mensagens | P1 / MVP | D | esboçado | views/central / operations; Unir descoberta e conversa sem misturar conta pessoal e Space profissional. |
| M-035 | arquivos | P0 / MVP | D | demonstrável | views/central / operations; Retomar apenas referências autorizadas e suportadas pelo app. |
| M-036 | comandos | P1 / MVP | D | esboçado | views/central / operations; Busca oferece destino contextual e distingue proposta de execução. |
| M-037 | automações | P1 / MVP | D | esboçado | views/central / operations; Estado/escopo/owner e revisão; toggle visual nunca significa grant. |

## Desktop

Continuidade de texto/janelas foi testada; exemplos Studio/Editor/Internet ainda contêm conteúdo fixo, sem lifecycle canônico.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-038 | launcher | P0 / MVP | D | demonstrável | views/desktop / session maps; Todos os apps acessíveis por teclado e em tela estreita. |
| M-039 | dock/barra | P0 / MVP | D | demonstrável | views/desktop / session maps; Distinguir fixado, aberto, ativo e minimizado, com nomes acessíveis. |
| M-040 | janelas | P0 / MVP | D | demonstrável com lacuna | views/desktop / session maps; Reusar lifecycle canônico; foco, rascunho e scroll sobrevivem a snapshots. |
| M-041 | snapping | P2 / pós-MVP | A | não representado | views/desktop / session maps; Definir comportamento de bordas, teclado e múltiplos monitores antes de desenhar. |
| M-042 | multitarefa | P0 / MVP | D | demonstrável | views/desktop / session maps; Expanded/floating/compact sem ocultar trabalho ou perder a janela ativa. |
| M-043 | workspaces/áreas | P1 / MVP | E | esboçado | views/desktop / session maps; Distinguir área de janelas de Space de autorização. |
| M-044 | overview | P2 / pós-MVP | A | não representado | views/desktop / session maps; Visão de janelas com navegação por teclado; não recriar estado do workspace. |
| M-045 | quick settings | P0 / MVP | D | demonstrável | views/desktop / session maps; Somente controles de hardware suportados, com estados pendente/erro. |
| M-046 | busca | P1 / MVP | D | demonstrável | views/desktop / session maps; Ctrl/Meta+K, Escape e retorno ao foco; escopo dos resultados explícito. |
| M-047 | arquivos | P0 / MVP | D | demonstrável com lacuna | views/desktop / session maps; Abrir e retomar documento via referência do owner; caminho bruto não vira grant. |
| M-048 | Space | P0 / MVP | D | demonstrável | views/desktop / session maps; Troca de Space não equivale a apagar sessão; definir política canônica. |
| M-049 | IA contextual | P0 / MVP | E | esboçado | views/desktop / session maps; Mesmo contexto/revisão da Central; integrar por contrato público. |

## Intelligence

Resposta fixa, proposta e recibo separados. Nenhum router, Memory, grant ou executor conectado; não equivale a histórico durável.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-050 | conversa | P0 / MVP | D | demonstrável | intelligence / journeys; Turnos, streaming, erro, cancelar e preservar rascunho. |
| M-051 | comando | P0 / MVP | D | demonstrável | intelligence / journeys; Intenção → proposta → revisão → resultado verificável. |
| M-052 | contexto | P0 / MVP | D | demonstrável com lacuna | intelligence / journeys; Fontes autorizadas e escopo; seleção não concede leitura. |
| M-053 | memória | P0 / MVP | E | esboçado | intelligence / journeys; Origem, consentimento, consulta e remoção no owner Memory. |
| M-054 | sugestões | P1 / MVP | D | demonstrável | intelligence / journeys; Motivo e fontes, aceitar/recusar sem disparo implícito. |
| M-055 | automações | P1 / MVP | E | esboçado | intelligence / journeys; Recorte iniciado continua MVP; execução mutável aguarda seus gates. |
| M-056 | permissões | P0 / MVP | E | demonstrável com lacuna | intelligence / journeys; Permissão específica, duração, revogação e negado; booleano visual insuficiente. |
| M-057 | ações | P0 / MVP | E | demonstrável | intelligence / journeys; Approval/dispatch/result com identidade e autoridade canônicas. |
| M-058 | histórico | P1 / MVP | A | esboçado | intelligence / journeys; Retomar sem vazar turnos entre contas/Spaces. |
| M-059 | voz | P2 / pós-MVP | E | esboçado | intelligence / journeys; Entrada, cancelamento, transcrição revisável e fallback textual. |
| M-060 | microfone | P0 / MVP | E | esboçado | intelligence / journeys; Representar indisponível/negado e uso explícito; não prometer captação. |
| M-061 | apps | P0 / MVP | E | esboçado | intelligence / journeys; Manifests descrevem intenção; app/provider canônico executa. |
| M-062 | sistema | P0 / MVP | E | esboçado | intelligence / journeys; IA local incluída e degradação segura; falha não impede boot. |
| M-063 | dispositivos | P1 / MVP | E | esboçado | intelligence / journeys; Alvo, grant e resultado por Device Host/Action Gateway. |

## Spaces

Troca explícita, ausência e rascunhos segregados; revogação é cenário reversível, não membership real.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-064 | descoberta | P1 / MVP | D | demonstrável | space / currentContext; Separar espaços próprios, compartilhados e modelos de catálogo. |
| M-065 | catálogo | P1 / MVP | D | demonstrável | space / currentContext; Origem, visibilidade e escopo; sem misturar catálogo com membership. |
| M-066 | criação | P1 / MVP | D | esboçado | space / currentContext; Contrato de mutação do owner; port spaces/1 read-only não autoriza criar. |
| M-067 | instalação de composição | P1 / MVP | E | esboçado | space / currentContext; Instalar pack via gerenciador, criar Space via owner correto. |
| M-068 | ativação | P0 / MVP | D | demonstrável | space / currentContext; Confirmação e falha se contexto/capacidades não puderem ser ativados. |
| M-069 | troca | P0 / MVP | D | demonstrável | space / currentContext; Preservar rascunhos por contexto e evitar vazamento de resultados. |
| M-070 | Space atual | P0 / MVP | D | demonstrável | space / currentContext; Identidade e estado reais em Central, Desktop, Intelligence e painéis. |
| M-071 | configurações | P1 / MVP | E | esboçado | space / currentContext; Nome, membros, proprietário e políticas com autorização explícita. |
| M-072 | módulos | P1 / MVP | E | esboçado | space / currentContext; Inventário e disponibilidade por host; não lista estática de nomes. |
| M-073 | permissões | P0 / MVP | E | demonstrável com lacuna | space / currentContext; Roles/grants/revogação; texto 'Privado' não é proteção. |
| M-074 | atividades | P1 / MVP | P | esboçado | space / currentContext; Atividade e mensagens devem refletir membership/Space, incluindo vazio. |

## Perfis

Lifecycle visual compartilhado com Store. Legal BR bloqueado; demais exemplos não comprovam módulos disponíveis.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-075 | descoberta | P1 / MVP | D | demonstrável | profile / packageStoryboard; Taxonomia canônica e oferta compatível com o modo. |
| M-076 | catálogo | P1 / MVP | D | demonstrável | profile / packageStoryboard; ID/version/trust/origem; seis cards editoriais não são catálogo verificado. |
| M-077 | detalhes | P1 / MVP | D | demonstrável | profile / packageStoryboard; Módulos, requisitos, dados, escopo e publisher. |
| M-078 | instalação | P1 / MVP | E | demonstrável | profile / packageStoryboard; Plano → compatibilidade → trust → consentimento → progresso → receipt. |
| M-079 | ativação | P1 / MVP | D | demonstrável | profile / packageStoryboard; Estado de ativação real e falha/reversão; nome do perfil não basta. |
| M-080 | troca | P1 / MVP | D | esboçado | profile / packageStoryboard; Explicar efeitos nos dados/módulos do Space antes de aplicar. |
| M-081 | módulos | P1 / MVP | E | esboçado | profile / packageStoryboard; Reutilizar component inventory e compatibilidade. |
| M-082 | networking | P1 / MVP | E | esboçado | profile / packageStoryboard; Diretório opt-in do Space; conta pessoal não é publicada automaticamente. |
| M-083 | grupos | P1 / MVP | E | demonstrável | profile / packageStoryboard; Descobrir, pedir entrada, sair e moderação no owner Network. |
| M-084 | chat | P1 / MVP | E | demonstrável | profile / packageStoryboard; 1:1/grupo com envio/entrega/erro e escopo de Space. |
| M-085 | ferramentas | P1 / MVP | E | esboçado | profile / packageStoryboard; Apps first-party no owner Apps; grants separados da instalação. |
| M-086 | Pizzaria | P1 / MVP | E | esboçado | profile / packageStoryboard; Piloto pizzaria-br@1; revisar produção/pedidos por contrato operacional. |
| M-087 | Empresas | P1 / MVP | E | esboçado | profile / packageStoryboard; Taxonomia/pack Business; compatibilidade e maturidade por módulo. |
| M-088 | Advocacia | P1 / MVP | E | demonstrável | profile / packageStoryboard; Legal BR é proposta; não anunciar pack instalado ou módulo pronto. |
| M-089 | Impressão 3D | P1 / MVP | D | esboçado | profile / packageStoryboard; Piloto impressao-3d-br@1; simulação de impressora não comprova Device Host. |

## Store

Download, verify, staging, health e remoção navegáveis. Atualização/remoção podem ser exploradas editorialmente mesmo sem instalação anterior.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-090 | home | P1 / MVP | D | demonstrável | store / packageStoryboard; Descobrir com catálogo real e estados de indisponibilidade. |
| M-091 | busca | P1 / MVP | D | demonstrável | store / packageStoryboard; Busca/filtro com vazio e contexto de compatibilidade. |
| M-092 | categorias | P1 / MVP | D | demonstrável | store / packageStoryboard; Usar taxonomia/versionamento do catálogo; labels não definem packages. |
| M-093 | detalhes | P0 / MVP | D | demonstrável | store / packageStoryboard; Publisher, versão, origem, compatibilidade, trust e permissões. |
| M-094 | apps | P0 / MVP | D | esboçado | store / packageStoryboard; Identidade verificada vinculada ao app e artefato. |
| M-095 | Spaces | P1 / MVP | E | esboçado | store / packageStoryboard; Representar composição/modelo, sem dar à Store autoridade de membership. |
| M-096 | perfis | P1 / MVP | E | esboçado | store / packageStoryboard; Profile Pack versionado e requisitos da ativação. |
| M-097 | módulos | P1 / MVP | E | esboçado | store / packageStoryboard; Componente com lifecycle, dependências e releaseMode. |
| M-098 | extensões | P2 / pós-MVP | E | esboçado | store / packageStoryboard; Contrato de extensão e isolamento antes de oferecer instalação. |
| M-099 | temas | P2 / pós-MVP | E | esboçado | store / packageStoryboard; Separar material da prévia e pacote de tema; preservar perfis atuais. |
| M-100 | integrações | P1 / MVP | E | esboçado | store / packageStoryboard; Consentimento/credencial no owner, sem segredo na Surface. |
| M-101 | instalação | P0 / MVP | D | demonstrável | store / packageStoryboard; Gerenciador decide; simular adição não representa instalação. |
| M-102 | progresso | P0 / MVP | A | demonstrável | store / packageStoryboard; Download, verificação, staging, ativação, falha e retenção. |
| M-103 | permissões | P0 / MVP | E | demonstrável | store / packageStoryboard; Revisar alcance e negar sem instalar/autorizar silenciosamente. |
| M-104 | atualização | P0 / MVP | A | demonstrável com lacuna | store / packageStoryboard; Compatibilidade, canal, pending health, conhecido-bom e rollback. |
| M-105 | remoção | P0 / MVP | A | demonstrável | store / packageStoryboard; Impacto/dados dependentes, confirmação e falha preservando trabalho. |

## Conta e identidade

Lia, visitante e sessão expirada são identidades fictícias. Testes cobrem troca/retorno; nenhuma credencial ou sessão autorizada real.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-106 | login | P0 / MVP | E | esboçado | identity / contextSubject; Formulário real, erros, cancelamento e estado do gateway; separado da sessão local. |
| M-107 | cadastro | P0 / MVP | E | esboçado | identity / contextSubject; Aceite e política vigente no owner; não recolher credenciais no estudo. |
| M-108 | continuar sem conta | P0 / MVP | D | demonstrável | identity / contextSubject; Uso local sem pressão de login; indicar limites remotos. |
| M-109 | sessão | P0 / MVP | E | demonstrável com lacuna | identity / contextSubject; Expiração, revogação, offline e reautenticação. |
| M-110 | perfil pessoal | P1 / MVP | E | esboçado | identity / contextSubject; Dados mínimos, edição validada e confirmação. |
| M-111 | sincronização | P0 / MVP | E | esboçado | identity / contextSubject; Escolha, fila, erro, conflito e pausa por sessão/capacidade. |
| M-112 | privacidade | P0 / MVP | E | esboçado | identity / contextSubject; Exportação, exclusão e escolhas com evidência e estado real. |
| M-113 | dispositivos associados | P1 / MVP | E | esboçado | identity / contextSubject; Inventário autorizado, sessão, revogar e indisponível. |
| M-114 | troca de conta | P0 / MVP | A | demonstrável | identity / contextSubject; Limpar/segregar estado autorizado; não reutilizar rascunhos de outra identidade. |
| M-115 | logout | P0 / MVP | A | demonstrável | identity / contextSubject; Fila pendente e revogação; sessão local pode continuar sem cloud. |
| M-116 | recuperação de acesso | P0 / MVP | A | esboçado | identity / contextSubject; Estados disponíveis apenas quando o owner habilitar o fluxo público. |

## Dispositivos

Código, capability e duração são exemplos. Dispositivos/capabilities fixos continuam no bundle; não são descoberta ou inventário autorizado.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-117 | PC | P1 / MVP | E | esboçado | device / settings; Host, modo, capabilities e atualidade da consulta. |
| M-118 | celular | P1 / MVP | E | esboçado | device / settings; Companion iniciado/contratado não equivale a APK ou serviço disponível. |
| M-119 | câmera | P1 / MVP | E | esboçado | device / settings; Selecionar fonte, visualizar consentimento e interrupção. |
| M-120 | microfone | P1 / MVP | E | esboçado | device / settings; Alvo, nível/estado se disponível, consentimento e revogação. |
| M-121 | webcam | P1 / MVP | A | esboçado | device / settings; Distinguir câmera local, webcam e câmera remota; falha/desconexão. |
| M-122 | impressoras | P2 / pós-MVP | A | não representado | device / settings; Descoberta/driver/fila requerem contrato e prova próprios. |
| M-123 | impressão 3D | P1 / MVP | E | esboçado | device / settings; Revisão do trabalho/alvo e execução governada; não disparar pelo card. |
| M-124 | periféricos | P1 / MVP | E | esboçado | device / settings; Capacidades presentes/ausentes e suporte por hardware. |
| M-125 | pairing | P0 / MVP | E | demonstrável | device / settings; Descobrir → confirmar em ambos → escopo → expiração → revogar. |
| M-126 | status | P0 / MVP | D | demonstrável | device / settings; Online/offline/indeterminado/obsoleto; não pintar todos os indicadores verdes. |
| M-127 | permissões | P0 / MVP | E | demonstrável | device / settings; Por capability, alvo e sessão; aparelho conhecido não autoriza ação. |

## Sistema

Tópicos e revisões são demonstráveis; escolhas do roteiro não alteram o host e nem sempre atualizam outros indicadores da prévia.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-128 | Wi-Fi | P0 / MVP | E | esboçado | settingsTopics / settings; Redes, credencial, conexão, erro e esquecer via adapter público. |
| M-129 | Bluetooth | P2 / pós-MVP | A | não representado | settingsTopics / settings; Adapter/pareamento/prova antes de oferecer toggle. |
| M-130 | áudio | P1 / MVP | E | esboçado | settingsTopics / settings; Volume/mudo/saída suportados; slider de exemplo não é mixer. |
| M-131 | display | P1 / MVP | E | esboçado | settingsTopics / settings; Brilho/resolução/escala conforme capability; filtro CSS é apenas prévia. |
| M-132 | teclado | P0 / MVP | A | demonstrável | settingsTopics / settings; Layout e atalhos legíveis/localizados; estado real de aplicação. |
| M-133 | idioma | P0 / MVP | A | demonstrável | settingsTopics / settings; Catálogo canônico pt-BR/en-US, formatação e fallback; não duplicar strings. |
| M-134 | região | P1 / MVP | A | demonstrável | settingsTopics / settings; Locale, fuso e formatos consistentes. |
| M-135 | bateria | P0 / MVP | E | esboçado | settingsTopics / settings; Bateria ausente, carregando, baixa e informação desconhecida. |
| M-136 | energia | P0 / MVP | E | demonstrável | settingsTopics / settings; Desligar/reiniciar; suspensão só quando suportada e provada. |
| M-137 | armazenamento | P0 / MVP | E | esboçado | settingsTopics / settings; Volumes e uso real, erro/read-only/cheio; não somar bytes lógicos duplicados. |
| M-138 | usuários | P1 / MVP | A | esboçado | settingsTopics / settings; Sessão local e conta cloud explicitamente separadas. |
| M-139 | privacidade | P0 / MVP | E | esboçado | settingsTopics / settings; Histórico de acesso, escopo e revogação reais. |
| M-140 | segurança | P0 / MVP | A | esboçado | settingsTopics / settings; Bloqueio/trust/atualidade/limites do host e ação de recuperação. |
| M-141 | atualização | P0 / MVP | E | demonstrável | settingsTopics / settings; Consultar estado do owner e abrir detalhe; não 'nenhuma atualização' fictícia. |
| M-142 | acessibilidade | P0 / MVP | D | demonstrável com lacuna | settingsTopics / settings; Teclado, labels, contraste, texto ampliado e reduced motion em todas as rotas. |
| M-143 | data/hora | P0 / MVP | E | esboçado | settingsTopics / settings; Usar relógio/fuso reais; datas editoriais ficam explicitamente fictícias. |

## Arquivos

Referências e intenções/recibos; não há árvore real, salvamento, movimentação ou grant. Reutilizar Files do owner Apps.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-144 | explorer | P0 / MVP | E | demonstrável | files / storage; Navegação, seleção e operações reais via Files, não nova implementação Meridian. |
| M-145 | recentes | P0 / MVP | D | demonstrável | files / storage; Origem, disponibilidade e referência autorizada para abrir. |
| M-146 | favoritos | P1 / MVP | A | esboçado | files / storage; Fixar/remover, destino ausente e conservação do escopo. |
| M-147 | dispositivos | P1 / MVP | A | esboçado | files / storage; Fonte local/remota/USB sem confundir capacidade com grant. |
| M-148 | volumes | P0 / MVP | A | demonstrável | files / storage; Montado/ausente/read-only/cheio e retirada segura quando suportada. |
| M-149 | busca | P1 / MVP | D | demonstrável | files / storage; Filtro visual não equivale a indexação; definir escopo e falha. |
| M-150 | preview | P1 / MVP | E | esboçado | files / storage; Tipos suportados, indisponível e conteúdo não confiável isolado. |
| M-151 | ações | P0 / MVP | E | demonstrável | files / storage; Criar, renomear, mover, copiar, lixeira e restaurar sem clobber. |
| M-152 | compartilhamento | P1 / MVP | A | esboçado | files / storage; Destino, grant, expiração, revogar e confirmação. |
| M-153 | Spaces | P0 / MVP | D | demonstrável | files / storage; Referências/projetos no Space correto; trocar contexto não move bytes. |

## Comunicação

Filtros, dispensa e rascunhos testados. A conversa do storyboard é copy fixa; sem entrega, moderação ou ingestão em Memory.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-154 | notificações | P0 / MVP | D | demonstrável | notificationsView / communication; Centro único com ações, dispensar, histórico e Não perturbe. |
| M-155 | mensagens | P1 / MVP | D | demonstrável | notificationsView / communication; Rascunho → enviar → pendente → entregue/falhou; retry sem duplicar. |
| M-156 | grupos | P1 / MVP | E | demonstrável | notificationsView / communication; Descoberta, adesão, membros, sair e moderação. |
| M-157 | networking | P1 / MVP | E | demonstrável | notificationsView / communication; Diretório opt-in por Space/segmento e bloqueio/denúncia. |
| M-158 | colaboração | P1 / MVP | E | esboçado | notificationsView / communication; Permissão e contexto compartilhado; chat não concede edição de arquivo. |
| M-159 | presença | P2 / pós-MVP | A | esboçado | notificationsView / communication; Consentimento/atualidade e modo invisível antes de anunciar disponibilidade. |

## Privacidade e segurança

Aceite visual pontual e escopo transitório corrigidos; fixtures continuam globalmente acessíveis no source. Não é enforcement.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-160 | permissões | P0 / MVP | E | demonstrável | revisões contextuais / identity; Solicitação, negar, limitar, revogar e auditar por autoridade. |
| M-161 | câmera | P0 / MVP | E | esboçado | revisões contextuais / identity; Indicador de uso, origem, duração e parada imediata. |
| M-162 | microfone | P0 / MVP | E | esboçado | revisões contextuais / identity; Consentimento por sessão, negado/ausente e encerramento. |
| M-163 | localização | P1 / MVP | A | não representado | revisões contextuais / identity; Estado indisponível/negado; não inventar provider de geolocalização. |
| M-164 | arquivos | P0 / MVP | E | demonstrável | revisões contextuais / identity; Seleção e autorização distintas; sem caminhos brutos como credencial. |
| M-165 | Intelligence | P0 / MVP | E | demonstrável | revisões contextuais / identity; Fontes/modelo/retention e consentimento antes de saída ao provider. |
| M-166 | apps | P0 / MVP | E | demonstrável | revisões contextuais / identity; Trust/manifest/grants/executor separados; instalação não concede execução. |
| M-167 | Spaces | P0 / MVP | E | demonstrável | revisões contextuais / identity; Membership/roles, exclusão de outros Spaces e erro fail-closed. |
| M-168 | perfis | P0 / MVP | E | demonstrável | revisões contextuais / identity; Ativação não concede automaticamente câmera, arquivos ou ação remota. |
| M-169 | dispositivos | P0 / MVP | E | demonstrável | revisões contextuais / identity; Pairing, alvo, capability, revogar e chave/sessão expiradas. |
| M-170 | sessões | P0 / MVP | A | demonstrável | revisões contextuais / identity; Bloqueio local, expiração cloud e troca sem vazamento de dados. |

## Update e Recovery

Roteiros cobrem fases e falhas, sem bypass visual de trust. Known-good/rollback são editoriais, não execução comprovada.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-171 | update | P0 / MVP | A | demonstrável | update / recovery; Canal/artefato/compatibilidade e ação permitida. |
| M-172 | progresso | P0 / MVP | A | demonstrável | update / recovery; Baixar → verificar → preparar → ativar → health. |
| M-173 | known-good | P0 / MVP | A | demonstrável | update / recovery; Versão local recuperável e identidade legível. |
| M-174 | rollback | P0 / MVP | A | demonstrável | update / recovery; Motivo, alvo conhecido-bom, progresso, resultado e trabalho preservado. |
| M-175 | recovery | P0 / MVP | A | demonstrável | update / recovery; Entrada independente da Surface normal e opções aplicáveis. |
| M-176 | falha | P0 / MVP | A | demonstrável | update / recovery; Classificar rede/integridade/espaço/health; ação segura específica. |
| M-177 | versão | P0 / MVP | A | demonstrável | update / recovery; Produto/componente/Entrega/SHA segundo nomenclatura, nunca número de PR. |
| M-178 | reinício | P0 / MVP | A | demonstrável | update / recovery; Necessidade, adiamento quando permitido e trabalho pendente. |
| M-179 | recuperação USB | P0 / MVP | A | demonstrável | update / recovery; Boot offline conhecido-bom e orientação de mídia sem regravação automática. |

## Estados especiais

Estados operacionais são navegáveis, mas cenários independentes não formam uma máquina global consistente de capacidades.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-180 | offline | P0 / MVP | P | demonstrável com lacuna | condições por etapa; Aviso atual não desliga dispositivos nem suspende visualmente todos os fluxos remotos. |
| M-181 | sem conta | P0 / MVP | P | demonstrável com lacuna | condições por etapa; Guest muda alguns textos, mas mensagens/atividades continuam globais na fixture. |
| M-182 | sem rede | P0 / MVP | P | demonstrável com lacuna | condições por etapa; Separar offline voluntário, desconectado, sem internet e serviço inacessível. |
| M-183 | erro | P0 / MVP | P | demonstrável | condições por etapa; Cenário global não substitui erros por operação/controle. |
| M-184 | loading | P0 / MVP | P | demonstrável com lacuna | condições por etapa; Skeleton da Central existe; catálogos/painéis/progresso assíncrono faltam. |
| M-185 | vazio | P0 / MVP | P | demonstrável com lacuna | condições por etapa; Primeiro dia existe; vazio por Space/filtro/conta precisa de causas diferentes. |
| M-186 | indisponível | P0 / MVP | P | demonstrável com lacuna | condições por etapa; Erro contextual com retry/fallback e capability ausente. |
| M-187 | bateria baixa | P0 / MVP | A | esboçado | condições por etapa; Aviso útil, economia e ação compatível com o host. |
| M-188 | update pendente | P0 / MVP | A | demonstrável | condições por etapa; Aviso persistente com detalhe/adiar/aplicar conforme política. |
| M-189 | storage cheio | P0 / MVP | A | demonstrável | condições por etapa; Falha de escrita explícita, preservar rascunho e recuperação guiada. |
| M-190 | dispositivo desconectado | P0 / MVP | P | esboçado | condições por etapa; Card câmera existe; invalidar ações/painéis ao desconectar. |
| M-191 | Space ausente ou revogado | P0 / MVP | A | demonstrável | condições por etapa; Não usar spaces[0] como fallback de autorização; seleção deliberada. |
| M-192 | sem permissão/recurso bloqueado | P0 / MVP | A | demonstrável | condições por etapa; Motivo/capability e caminho legítimo; não oferecer ação vazia. |
| M-193 | serviço indisponível | P0 / MVP | P | esboçado | condições por etapa; Diferenciar falha temporária, port ausente e configuração incompleta. |

## Exploração futura

Explorações de apresentação, sem autoridade, predição de rede ou operação real.

| ID | Item | Prioridade / horizonte | Round 1 | Round 2 auditada | Evidência / próximo critério real |
|---|---|---|---|---|---|
| M-194 | Antecipação de perda de rede | P3 / futuro/experimental | A | não representado | space impact / recovery; Sistema/continuidade, como projeção read-only de capacidades dos owners; sem prever autoridade ou criar fila paralela. |
| M-195 | Comparação antes de trocar contexto | P3 / futuro/experimental | A | demonstrável | space impact / recovery; Surface workspace + Space selection; consumir a política existente, sem recriar membership ou Memory. |
| M-196 | Ensaio explicativo de recovery | P3 / futuro/experimental | A | demonstrável | space impact / recovery; Ajuda/Sistema/Recovery, usando estados e receitas do owner; nunca executar rollback no ensaio. |

Totais: {"demonstrável com lacuna":24,"demonstrável":91,"esboçado":74,"bloqueado por owner/contrato":1,"não representado":6}. Total 196; pronto para adapter = 0.
