# Inventário UI/UX Meridian — 13/10/2026

Evidência da auditoria de `69a8937`, na branch `codex/meridian-design-lab`. Este backlog alimenta a próxima rodada visual; não substitui [MVP.md](../../../MVP.md), os planos funcionais ou os contratos dos owners. Nenhum item abaixo autoriza implementação, publicação ou ativação.

**Como ler:** P0 essencial à clareza/segurança do fluxo; P1 importante; P2 evolução; P3 exploração. A prioridade é da próxima cobertura UI/UX, não um novo gate para o primeiro USB. MVP preserva o escopo integrado de todas as capacidades iniciadas; a disponibilidade continua condicionada ao modo e aos gates. "pós-MVP" indica extensão sem implementação comprovada nos recortes consultados, não adiamento de uma capacidade já iniciada.

**Estado do produto no source:** E = há implementação/UI no recorte canônico consultado; C = contratos/fundação/source parcial, sem afirmar disponibilidade; P = planejamento/conceito. E não significa release habilitado ou homologado. Para produtos em Apps/Runtime/Platform, esta auditoria não substitui uma revisão dos respectivos repositórios.

**Cobertura Meridian:** D = interação de demonstração; E = esboço/copy; P = estado parcial/inconsistente; A = ausente. Nenhuma linha D representa integração real. A referência de cada categoria aponta à fonte de verdade a consumir; o critério de cada linha explicita o que falta.

## Core

Owner: Boot/Surface/Session. Referências: `docs/contracts/first-run.json`, `system/contracts/local-session.mjs`, `system/contracts/power-actions.mjs`, `system/contracts/recovery-status.mjs`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-001 | boot | P0 | MVP | C | A | Exibir fase, mídia, falha recuperável e saída para diagnóstico; boot independe de conta. |
| M-002 | welcome | P0 | MVP | E | A | Distinguir boas-vindas reais de uma saudação editorial. |
| M-003 | onboarding | P0 | MVP | E | E | Idioma → fuso → rede opcional → conta opcional → conclusão persistente. |
| M-004 | login local | P0 | MVP | E | A | Consumir sessão local; não confundir desbloqueio com login cloud. |
| M-005 | lock | P0 | MVP | E | A | Bloquear, desbloquear e explicar falha sem revelar conteúdo do Space. |
| M-006 | sessão | P0 | MVP | E | E | Explicitar usuário local, estado e persistência da sessão USB. |
| M-007 | shutdown | P0 | MVP | E | A | Confirmar, mostrar trabalho pendente e retorno de falha. |
| M-008 | restart | P0 | MVP | E | A | Separar reinício normal e aplicação de atualização. |
| M-009 | erros críticos | P0 | MVP | C | A | Mensagem acionável, identidade do incidente e diagnóstico sanitizado. |
| M-010 | update | P0 | MVP | E | E | Consumir estado real; não inferir atualização de um aviso genérico. |
| M-011 | recovery | P0 | MVP | E | A | Entrada acessível mesmo quando a Surface normal não inicia. |
| M-012 | instalação Native em disco | P0 | MVP | C | A | Mostrar bloqueio atual e plano autorizado; nenhuma ativação por esta auditoria. |

## USB

Owner: Base/Creator/Runtime. Referências: `MVP.md`, `docs/MINIMAL-USB-BOOTSTRAP.md`, `docs/contracts/physical-prepared-media.json`, `docs/contracts/distribution-profiles.json`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-013 | primeira execução | P0 | MVP | E | A | Distinguir primeiro uso, retorno e recovery; ligar ao OOBE canônico. |
| M-014 | persistência | P0 | MVP | C | A | Explicar onde ficam arquivos, preferências e dados que sobreviverão ao reboot. |
| M-015 | storage | P0 | MVP | C | E | Mostrar capacidade real do volume, reserva e falha de escrita; não soma fictícia. |
| M-016 | identidade do dispositivo USB | P0 | MVP | C | E | Origem/mídia/host explícitos, sem inferir modo pela URL. |
| M-017 | offline | P0 | MVP | C | P | Continuidade local com release conhecida e operações remotas pausadas. |
| M-018 | rede | P0 | MVP | E | E | Conectar/tentar de novo sem tornar conta requisito de boot. |
| M-019 | update | P0 | MVP | E | A | Diferenciar Base, Surface e apps conforme releaseMode real. |
| M-020 | segurança | P0 | MVP | C | A | Estado de trust, bloqueio e proteção de dados conforme política vigente. |
| M-021 | recovery | P0 | MVP | E | A | Conhecido-bom local, fallback e orientação sem depender da internet. |

## Central

Owner: Surface; dados de cada owner. Referências: `system/surface/workspace/`, `system/surface/experiments/meridian/views/central.mjs`, `system/contracts/personal-ordax.mjs`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-022 | home | P0 | MVP | E | D | Manter hierarquia editorial, revelar sessão/modo/capacidades disponíveis. |
| M-023 | contexto | P0 | MVP | E | D | Space/projeto/origem e escopo sempre explícitos; faltante não cai em outro Space. |
| M-024 | atividades | P1 | MVP | E | D | Consumir continuidade real e explicitar data/origem, sem histórico global indevido. |
| M-025 | widgets | P2 | pós-MVP | P | E | Contrato de composição e personalização antes de tornar cards extensões. |
| M-026 | Intelligence | P0 | MVP | E | D | Compositor, resposta, cancelamento e indisponibilidade sem perder texto. |
| M-027 | Spaces | P0 | MVP | E | D | Troca preserva isolamento; port indisponível recebe estado honesto. |
| M-028 | perfis | P1 | MVP | C | D | Mostrar perfil aplicado e compatibilidade, distinguindo profissão e identidade. |
| M-029 | Store | P1 | MVP | E | D | Descoberta leva ao mesmo catálogo/gerenciador usado no Desktop. |
| M-030 | apps | P0 | MVP | E | D | Usar catálogo do owner Apps e capacidades do host; não promover apps fictícios. |
| M-031 | tarefas | P1 | MVP | C | D | Origem, conclusão, undo e erro ligados ao owner de trabalho pessoal. |
| M-032 | dispositivos | P1 | MVP | C | D | Estado conectado/desconectado coerente em todos os pontos. |
| M-033 | notificações | P0 | MVP | E | D | Acesso ao centro único com leitura, dispensa e Não perturbe reais. |
| M-034 | mensagens | P1 | MVP | C | D | Unir descoberta e conversa sem misturar conta pessoal e Space profissional. |
| M-035 | arquivos | P0 | MVP | E | D | Retomar apenas referências autorizadas e suportadas pelo app. |
| M-036 | comandos | P1 | MVP | E | D | Busca oferece destino contextual e distingue proposta de execução. |
| M-037 | automações | P1 | MVP | C | D | Estado/escopo/owner e revisão; toggle visual nunca significa grant. |

## Desktop

Owner: Surface workspace; Apps para conteúdo. Referências: `system/surface/workspace/`, `system/contracts/surface-render-lifecycle.mjs`, `docs/DESKTOP-IDENTITY.md`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-038 | launcher | P0 | MVP | E | D | Todos os apps acessíveis por teclado e em tela estreita. |
| M-039 | dock/barra | P0 | MVP | E | D | Distinguir fixado, aberto, ativo e minimizado, com nomes acessíveis. |
| M-040 | janelas | P0 | MVP | E | D | Reusar lifecycle canônico; foco, rascunho e scroll sobrevivem a snapshots. |
| M-041 | snapping | P2 | pós-MVP | P | A | Definir comportamento de bordas, teclado e múltiplos monitores antes de desenhar. |
| M-042 | multitarefa | P0 | MVP | E | D | Expanded/floating/compact sem ocultar trabalho ou perder a janela ativa. |
| M-043 | workspaces/áreas | P1 | MVP | E | E | Distinguir área de janelas de Space de autorização. |
| M-044 | overview | P2 | pós-MVP | P | A | Visão de janelas com navegação por teclado; não recriar estado do workspace. |
| M-045 | quick settings | P0 | MVP | E | D | Somente controles de hardware suportados, com estados pendente/erro. |
| M-046 | busca | P1 | MVP | E | D | Ctrl/Meta+K, Escape e retorno ao foco; escopo dos resultados explícito. |
| M-047 | arquivos | P0 | MVP | E | D | Abrir e retomar documento via referência do owner; caminho bruto não vira grant. |
| M-048 | Space | P0 | MVP | E | D | Troca de Space não equivale a apagar sessão; definir política canônica. |
| M-049 | IA contextual | P0 | MVP | E | E | Mesmo contexto/revisão da Central; integrar por contrato público. |

## Intelligence

Owner: Intelligence/Memory/Action Gateway. Referências: `INTELLIGENCE-HANDOFF.md`, `system/contracts/memory.mjs`, `system/contracts/model-router.mjs`, `system/contracts/action-executor.mjs`, `system/contracts/intelligence-tool-grant-authority.mjs`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-050 | conversa | P0 | MVP | E | D | Turnos, streaming, erro, cancelar e preservar rascunho. |
| M-051 | comando | P0 | MVP | E | D | Intenção → proposta → revisão → resultado verificável. |
| M-052 | contexto | P0 | MVP | E | D | Fontes autorizadas e escopo; seleção não concede leitura. |
| M-053 | memória | P0 | MVP | C | E | Origem, consentimento, consulta e remoção no owner Memory. |
| M-054 | sugestões | P1 | MVP | C | D | Motivo e fontes, aceitar/recusar sem disparo implícito. |
| M-055 | automações | P1 | MVP | C | E | Recorte iniciado continua MVP; execução mutável aguarda seus gates. |
| M-056 | permissões | P0 | MVP | C | E | Permissão específica, duração, revogação e negado; booleano visual insuficiente. |
| M-057 | ações | P0 | MVP | C | E | Approval/dispatch/result com identidade e autoridade canônicas. |
| M-058 | histórico | P1 | MVP | C | A | Retomar sem vazar turnos entre contas/Spaces. |
| M-059 | voz | P2 | pós-MVP | P | E | Entrada, cancelamento, transcrição revisável e fallback textual. |
| M-060 | microfone | P0 | MVP | C | E | Representar indisponível/negado e uso explícito; não prometer captação. |
| M-061 | apps | P0 | MVP | C | E | Manifests descrevem intenção; app/provider canônico executa. |
| M-062 | sistema | P0 | MVP | E | E | IA local incluída e degradação segura; falha não impede boot. |
| M-063 | dispositivos | P1 | MVP | C | E | Alvo, grant e resultado por Device Host/Action Gateway. |

## Spaces

Owner: Spaces/Platform; Surface como consumidor. Referências: `system/contracts/spaces.mjs`, `system/contracts/space-selection.mjs`, `docs/contracts/spaces-and-profile-packs.json`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-064 | descoberta | P1 | MVP | C | D | Separar espaços próprios, compartilhados e modelos de catálogo. |
| M-065 | catálogo | P1 | MVP | C | D | Origem, visibilidade e escopo; sem misturar catálogo com membership. |
| M-066 | criação | P1 | MVP | C | D | Contrato de mutação do owner; port spaces/1 read-only não autoriza criar. |
| M-067 | instalação de composição | P1 | MVP | C | E | Instalar pack via gerenciador, criar Space via owner correto. |
| M-068 | ativação | P0 | MVP | E | D | Confirmação e falha se contexto/capacidades não puderem ser ativados. |
| M-069 | troca | P0 | MVP | E | D | Preservar rascunhos por contexto e evitar vazamento de resultados. |
| M-070 | Space atual | P0 | MVP | E | D | Identidade e estado reais em Central, Desktop, Intelligence e painéis. |
| M-071 | configurações | P1 | MVP | C | E | Nome, membros, proprietário e políticas com autorização explícita. |
| M-072 | módulos | P1 | MVP | C | E | Inventário e disponibilidade por host; não lista estática de nomes. |
| M-073 | permissões | P0 | MVP | C | E | Roles/grants/revogação; texto 'Privado' não é proteção. |
| M-074 | atividades | P1 | MVP | C | P | Atividade e mensagens devem refletir membership/Space, incluindo vazio. |

## Perfis

Owner: Profile Packs; Network para comunidades. Referências: `system/contracts/profile-pack.mjs`, `system/contracts/profile-provisioning.mjs`, `system/contracts/profile-activation-state.mjs`, `docs/contracts/profile-content-trust-policy.json`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-075 | descoberta | P1 | MVP | C | D | Taxonomia canônica e oferta compatível com o modo. |
| M-076 | catálogo | P1 | MVP | C | D | ID/version/trust/origem; seis cards editoriais não são catálogo verificado. |
| M-077 | detalhes | P1 | MVP | C | D | Módulos, requisitos, dados, escopo e publisher. |
| M-078 | instalação | P1 | MVP | C | E | Plano → compatibilidade → trust → consentimento → progresso → receipt. |
| M-079 | ativação | P1 | MVP | C | D | Estado de ativação real e falha/reversão; nome do perfil não basta. |
| M-080 | troca | P1 | MVP | C | D | Explicar efeitos nos dados/módulos do Space antes de aplicar. |
| M-081 | módulos | P1 | MVP | C | E | Reutilizar component inventory e compatibilidade. |
| M-082 | networking | P1 | MVP | C | E | Diretório opt-in do Space; conta pessoal não é publicada automaticamente. |
| M-083 | grupos | P1 | MVP | C | E | Descobrir, pedir entrada, sair e moderação no owner Network. |
| M-084 | chat | P1 | MVP | C | E | 1:1/grupo com envio/entrega/erro e escopo de Space. |
| M-085 | ferramentas | P1 | MVP | C | E | Apps first-party no owner Apps; grants separados da instalação. |
| M-086 | Pizzaria | P1 | MVP | C | E | Piloto pizzaria-br@1; revisar produção/pedidos por contrato operacional. |
| M-087 | Empresas | P1 | MVP | C | E | Taxonomia/pack Business; compatibilidade e maturidade por módulo. |
| M-088 | Advocacia | P1 | MVP | P | E | Legal BR é proposta; não anunciar pack instalado ou módulo pronto. |
| M-089 | Impressão 3D | P1 | MVP | C | D | Piloto impressao-3d-br@1; simulação de impressora não comprova Device Host. |

## Store

Owner: App Store/Component Manager/Trust. Referências: `system/contracts/app-store.mjs`, `system/contracts/app-activation.mjs`, `system/contracts/component-update-compatibility.mjs`, `docs/contracts/verified-app-install-identity.json`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-090 | home | P1 | MVP | E | D | Descobrir com catálogo real e estados de indisponibilidade. |
| M-091 | busca | P1 | MVP | E | D | Busca/filtro com vazio e contexto de compatibilidade. |
| M-092 | categorias | P1 | MVP | C | D | Usar taxonomia/versionamento do catálogo; labels não definem packages. |
| M-093 | detalhes | P0 | MVP | E | D | Publisher, versão, origem, compatibilidade, trust e permissões. |
| M-094 | apps | P0 | MVP | E | D | Identidade verificada vinculada ao app e artefato. |
| M-095 | Spaces | P1 | MVP | C | E | Representar composição/modelo, sem dar à Store autoridade de membership. |
| M-096 | perfis | P1 | MVP | C | E | Profile Pack versionado e requisitos da ativação. |
| M-097 | módulos | P1 | MVP | C | E | Componente com lifecycle, dependências e releaseMode. |
| M-098 | extensões | P2 | pós-MVP | P | E | Contrato de extensão e isolamento antes de oferecer instalação. |
| M-099 | temas | P2 | pós-MVP | P | E | Separar material da prévia e pacote de tema; preservar perfis atuais. |
| M-100 | integrações | P1 | MVP | C | E | Consentimento/credencial no owner, sem segredo na Surface. |
| M-101 | instalação | P0 | MVP | E | D | Gerenciador decide; simular adição não representa instalação. |
| M-102 | progresso | P0 | MVP | E | A | Download, verificação, staging, ativação, falha e retenção. |
| M-103 | permissões | P0 | MVP | C | E | Revisar alcance e negar sem instalar/autorizar silenciosamente. |
| M-104 | atualização | P0 | MVP | E | A | Compatibilidade, canal, pending health, conhecido-bom e rollback. |
| M-105 | remoção | P0 | MVP | E | A | Impacto/dados dependentes, confirmação e falha preservando trabalho. |

## Conta e identidade

Owner: Identity/Account/Sync. Referências: `system/contracts/identity-session.mjs`, `system/contracts/identity-credentials.mjs`, `system/contracts/account-lifecycle.mjs`, `system/services/account/`, `system/services/sync/`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-106 | login | P0 | MVP | E | E | Formulário real, erros, cancelamento e estado do gateway; separado da sessão local. |
| M-107 | cadastro | P0 | MVP | E | E | Aceite e política vigente no owner; não recolher credenciais no estudo. |
| M-108 | continuar sem conta | P0 | MVP | E | D | Uso local sem pressão de login; indicar limites remotos. |
| M-109 | sessão | P0 | MVP | E | E | Expiração, revogação, offline e reautenticação. |
| M-110 | perfil pessoal | P1 | MVP | E | E | Dados mínimos, edição validada e confirmação. |
| M-111 | sincronização | P0 | MVP | C | E | Escolha, fila, erro, conflito e pausa por sessão/capacidade. |
| M-112 | privacidade | P0 | MVP | C | E | Exportação, exclusão e escolhas com evidência e estado real. |
| M-113 | dispositivos associados | P1 | MVP | C | E | Inventário autorizado, sessão, revogar e indisponível. |
| M-114 | troca de conta | P0 | MVP | C | A | Limpar/segregar estado autorizado; não reutilizar rascunhos de outra identidade. |
| M-115 | logout | P0 | MVP | E | A | Fila pendente e revogação; sessão local pode continuar sem cloud. |
| M-116 | recuperação de acesso | P0 | MVP | C | A | Estados disponíveis apenas quando o owner habilitar o fluxo público. |

## Dispositivos

Owner: Device Host/Runtime; Platform para descoberta. Referências: `system/contracts/device-agent.mjs`, `system/contracts/device-capabilities.mjs`, `system/contracts/mobile-companion.mjs`, `docs/REMOTE-CONTROL.md`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-117 | PC | P1 | MVP | C | E | Host, modo, capabilities e atualidade da consulta. |
| M-118 | celular | P1 | MVP | C | E | Companion iniciado/contratado não equivale a APK ou serviço disponível. |
| M-119 | câmera | P1 | MVP | C | E | Selecionar fonte, visualizar consentimento e interrupção. |
| M-120 | microfone | P1 | MVP | C | E | Alvo, nível/estado se disponível, consentimento e revogação. |
| M-121 | webcam | P1 | MVP | C | A | Distinguir câmera local, webcam e câmera remota; falha/desconexão. |
| M-122 | impressoras | P2 | pós-MVP | P | A | Descoberta/driver/fila requerem contrato e prova próprios. |
| M-123 | impressão 3D | P1 | MVP | C | E | Revisão do trabalho/alvo e execução governada; não disparar pelo card. |
| M-124 | periféricos | P1 | MVP | C | E | Capacidades presentes/ausentes e suporte por hardware. |
| M-125 | pairing | P0 | MVP | C | E | Descobrir → confirmar em ambos → escopo → expiração → revogar. |
| M-126 | status | P0 | MVP | C | D | Online/offline/indeterminado/obsoleto; não pintar todos os indicadores verdes. |
| M-127 | permissões | P0 | MVP | C | E | Por capability, alvo e sessão; aparelho conhecido não autoriza ação. |

## Sistema

Owner: Ajustes/Sistema/host adapters. Referências: `PLANO-FUNCIONAL-SURFACE-E-APPS.md`, `system/contracts/network-management.mjs`, `system/contracts/power-status.mjs`, `system/contracts/preference-runtime.mjs`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-128 | Wi-Fi | P0 | MVP | E | E | Redes, credencial, conexão, erro e esquecer via adapter público. |
| M-129 | Bluetooth | P2 | pós-MVP | P | A | Adapter/pareamento/prova antes de oferecer toggle. |
| M-130 | áudio | P1 | MVP | C | E | Volume/mudo/saída suportados; slider de exemplo não é mixer. |
| M-131 | display | P1 | MVP | C | E | Brilho/resolução/escala conforme capability; filtro CSS é apenas prévia. |
| M-132 | teclado | P0 | MVP | E | A | Layout e atalhos legíveis/localizados; estado real de aplicação. |
| M-133 | idioma | P0 | MVP | E | A | Catálogo canônico pt-BR/en-US, formatação e fallback; não duplicar strings. |
| M-134 | região | P1 | MVP | E | A | Locale, fuso e formatos consistentes. |
| M-135 | bateria | P0 | MVP | E | E | Bateria ausente, carregando, baixa e informação desconhecida. |
| M-136 | energia | P0 | MVP | E | E | Desligar/reiniciar; suspensão só quando suportada e provada. |
| M-137 | armazenamento | P0 | MVP | C | E | Volumes e uso real, erro/read-only/cheio; não somar bytes lógicos duplicados. |
| M-138 | usuários | P1 | MVP | E | A | Sessão local e conta cloud explicitamente separadas. |
| M-139 | privacidade | P0 | MVP | C | E | Histórico de acesso, escopo e revogação reais. |
| M-140 | segurança | P0 | MVP | C | A | Bloqueio/trust/atualidade/limites do host e ação de recuperação. |
| M-141 | atualização | P0 | MVP | E | E | Consultar estado do owner e abrir detalhe; não 'nenhuma atualização' fictícia. |
| M-142 | acessibilidade | P0 | MVP | E | D | Teclado, labels, contraste, texto ampliado e reduced motion em todas as rotas. |
| M-143 | data/hora | P0 | MVP | E | E | Usar relógio/fuso reais; datas editoriais ficam explicitamente fictícias. |

## Arquivos

Owner: Files/Runtime; referências públicas. Referências: `system/apps/files/`, `system/contracts/recent-files.mjs`, `system/contracts/project-catalog.mjs`, `PLANO-FUNCIONAL-SURFACE-E-APPS.md`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-144 | explorer | P0 | MVP | E | E | Navegação, seleção e operações reais via Files, não nova implementação Meridian. |
| M-145 | recentes | P0 | MVP | E | D | Origem, disponibilidade e referência autorizada para abrir. |
| M-146 | favoritos | P1 | MVP | E | A | Fixar/remover, destino ausente e conservação do escopo. |
| M-147 | dispositivos | P1 | MVP | C | A | Fonte local/remota/USB sem confundir capacidade com grant. |
| M-148 | volumes | P0 | MVP | C | A | Montado/ausente/read-only/cheio e retirada segura quando suportada. |
| M-149 | busca | P1 | MVP | E | D | Filtro visual não equivale a indexação; definir escopo e falha. |
| M-150 | preview | P1 | MVP | E | E | Tipos suportados, indisponível e conteúdo não confiável isolado. |
| M-151 | ações | P0 | MVP | E | E | Criar, renomear, mover, copiar, lixeira e restaurar sem clobber. |
| M-152 | compartilhamento | P1 | MVP | C | A | Destino, grant, expiração, revogar e confirmação. |
| M-153 | Spaces | P0 | MVP | E | D | Referências/projetos no Space correto; trocar contexto não move bytes. |

## Comunicação

Owner: Notifications/Network. Referências: `system/contracts/notifications.mjs`, `system/contracts/notification-store.mjs`, `system/contracts/network-transport-v2.mjs`, `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-154 | notificações | P0 | MVP | E | D | Centro único com ações, dispensar, histórico e Não perturbe. |
| M-155 | mensagens | P1 | MVP | C | D | Rascunho → enviar → pendente → entregue/falhou; retry sem duplicar. |
| M-156 | grupos | P1 | MVP | C | E | Descoberta, adesão, membros, sair e moderação. |
| M-157 | networking | P1 | MVP | C | E | Diretório opt-in por Space/segmento e bloqueio/denúncia. |
| M-158 | colaboração | P1 | MVP | C | E | Permissão e contexto compartilhado; chat não concede edição de arquivo. |
| M-159 | presença | P2 | pós-MVP | P | A | Consentimento/atualidade e modo invisível antes de anunciar disponibilidade. |

## Privacidade e segurança

Owner: Grants/Identity/Memory/Device Host. Referências: `system/contracts/intelligence-tool-grant-authority.mjs`, `system/contracts/identity-session.mjs`, `docs/contracts/memory.json`, `docs/contracts/device-agent.json`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-160 | permissões | P0 | MVP | C | E | Solicitação, negar, limitar, revogar e auditar por autoridade. |
| M-161 | câmera | P0 | MVP | C | E | Indicador de uso, origem, duração e parada imediata. |
| M-162 | microfone | P0 | MVP | C | E | Consentimento por sessão, negado/ausente e encerramento. |
| M-163 | localização | P1 | MVP | C | A | Estado indisponível/negado; não inventar provider de geolocalização. |
| M-164 | arquivos | P0 | MVP | C | E | Seleção e autorização distintas; sem caminhos brutos como credencial. |
| M-165 | Intelligence | P0 | MVP | C | E | Fontes/modelo/retention e consentimento antes de saída ao provider. |
| M-166 | apps | P0 | MVP | C | E | Trust/manifest/grants/executor separados; instalação não concede execução. |
| M-167 | Spaces | P0 | MVP | C | E | Membership/roles, exclusão de outros Spaces e erro fail-closed. |
| M-168 | perfis | P0 | MVP | C | E | Ativação não concede automaticamente câmera, arquivos ou ação remota. |
| M-169 | dispositivos | P0 | MVP | C | E | Pairing, alvo, capability, revogar e chave/sessão expiradas. |
| M-170 | sessões | P0 | MVP | E | A | Bloqueio local, expiração cloud e troca sem vazamento de dados. |

## Update e Recovery

Owner: Release/Component Manager/Base. Referências: `system/contracts/update-status.mjs`, `system/contracts/update-history.mjs`, `system/contracts/recovery-status.mjs`, `docs/UPDATE-NOMENCLATURE.md`, `docs/PROMOTION-GATES.md`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-171 | update | P0 | MVP | E | A | Canal/artefato/compatibilidade e ação permitida. |
| M-172 | progresso | P0 | MVP | E | A | Baixar → verificar → preparar → ativar → health. |
| M-173 | known-good | P0 | MVP | E | A | Versão local recuperável e identidade legível. |
| M-174 | rollback | P0 | MVP | E | A | Motivo, alvo conhecido-bom, progresso, resultado e trabalho preservado. |
| M-175 | recovery | P0 | MVP | E | A | Entrada independente da Surface normal e opções aplicáveis. |
| M-176 | falha | P0 | MVP | E | A | Classificar rede/integridade/espaço/health; ação segura específica. |
| M-177 | versão | P0 | MVP | E | A | Produto/componente/Entrega/SHA segundo nomenclatura, nunca número de PR. |
| M-178 | reinício | P0 | MVP | E | A | Necessidade, adiamento quando permitido e trabalho pendente. |
| M-179 | recuperação USB | P0 | MVP | E | A | Boot offline conhecido-bom e orientação de mídia sem regravação automática. |

## Estados especiais

Owner: Cada owner; Surface para apresentação. Referências: `MVP.md`, `docs/CURRENT-STATE.md`, `system/surface/experiments/meridian/catalog.mjs`.

| ID | Item | Prioridade | Horizonte | Source | Meridian | Próximo critério de aceite |
|---|---|---|---|---|---|---|
| M-180 | offline | P0 | MVP | E | P | Aviso atual não desliga dispositivos nem suspende visualmente todos os fluxos remotos. |
| M-181 | sem conta | P0 | MVP | E | P | Guest muda alguns textos, mas mensagens/atividades continuam globais na fixture. |
| M-182 | sem rede | P0 | MVP | E | P | Separar offline voluntário, desconectado, sem internet e serviço inacessível. |
| M-183 | erro | P0 | MVP | E | P | Cenário global não substitui erros por operação/controle. |
| M-184 | loading | P0 | MVP | E | P | Skeleton da Central existe; catálogos/painéis/progresso assíncrono faltam. |
| M-185 | vazio | P0 | MVP | E | P | Primeiro dia existe; vazio por Space/filtro/conta precisa de causas diferentes. |
| M-186 | indisponível | P0 | MVP | E | P | Erro contextual com retry/fallback e capability ausente. |
| M-187 | bateria baixa | P0 | MVP | E | A | Aviso útil, economia e ação compatível com o host. |
| M-188 | update pendente | P0 | MVP | E | A | Aviso persistente com detalhe/adiar/aplicar conforme política. |
| M-189 | storage cheio | P0 | MVP | C | A | Falha de escrita explícita, preservar rascunho e recuperação guiada. |
| M-190 | dispositivo desconectado | P0 | MVP | C | P | Card câmera existe; invalidar ações/painéis ao desconectar. |
| M-191 | Space ausente ou revogado | P0 | MVP | E | A | Não usar spaces[0] como fallback de autorização; seleção deliberada. |
| M-192 | sem permissão/recurso bloqueado | P0 | MVP | C | A | Motivo/capability e caminho legítimo; não oferecer ação vazia. |
| M-193 | serviço indisponível | P0 | MVP | E | P | Diferenciar falha temporária, port ausente e configuração incompleta. |

## Exploração futura

Hipóteses adicionais de UX não encontradas como fluxos completos nos documentos consultados. Validar sua novidade e necessidade com os owners antes de planejar. Não implementadas.

| ID | Ideia | Problema | Benefício | Posição e limite | Prioridade / horizonte |
|---|---|---|---|---|---|
| M-194 | Antecipação de perda de rede | A pessoa descobre tarde que uma etapa depende de internet. | Mostrar, antes de sair da rede, quais passos poderão continuar e quais ficarão pendentes. | Sistema/continuidade, como projeção read-only de capacidades dos owners; sem prever autoridade ou criar fila paralela. | P3 / futuro-experimental |
| M-195 | Comparação antes de trocar contexto | Não fica claro o que muda entre dois Spaces e o que permanece aberto. | Prévia de mudanças em janelas/fontes/ferramentas, com impacto compreensível. | Surface workspace + Space selection; consumir a política existente, sem recriar membership ou Memory. | P3 / futuro-experimental |
| M-196 | Ensaio explicativo de recovery | O primeiro contato com recovery costuma ocorrer durante uma falha. | Um percurso guiado e não destrutivo explica conhecido-bom e opções reais. | Ajuda/Sistema/Recovery, usando estados e receitas do owner; nunca executar rollback no ensaio. | P3 / futuro-experimental |

Total: **196 itens**, 17 categorias. P0/P1/P2: P0=118, P1=66, P2=9; P3=3. Horizonte: MVP=184, pós-MVP=9; futuro/experimental=3.

## Ordem recomendada para a próxima rodada

1. P0: estados de sessão local, lock, OOBE, USB, update/recovery e capacidades indisponíveis.
2. P0: transições completas e sem perda de contexto; erros/negação/progresso de Store, arquivos e Intelligence.
3. P0: fonte única de domínio antes de qualquer integração; mapear os view models às projeções autorizadas dos owners.
4. P1: retomar projetos, comunicação/Network, dispositivos e packs profissionais com estados verificáveis.
5. P2: composição de widgets, overview/snapping e capacidades ainda sem integração comprovada.
6. P3: validar as três hipóteses acima sem ampliar esta branch.

Os fluxos completos e seus pontos de interrupção estão em [fluxos.md](fluxos.md). Os achados, riscos e gates estão em [relatorio.md](relatorio.md).
