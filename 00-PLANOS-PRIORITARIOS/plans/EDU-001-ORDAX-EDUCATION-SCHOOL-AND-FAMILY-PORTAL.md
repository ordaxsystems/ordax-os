# EDU-001 — OrdaX Education, Escola e Portal da Família

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P2
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** future Education domain; Account/Spaces/Identity e REL-001 para acesso externo
- **Base factual:** Education já existe como direção de Profile/Network, Spaces/Identity atuais e REL-001
- **Relatórios de apoio:** IDENTITY-001, REL-001, ACHEGUESE-001 quando criado
- **Dependências:** REL-001, IDENTITY-001, Web/Mobile, Notifications, Payments/Finance owners quando aplicável, People/Workforce para equipe; Achegue-se opcional para página pública territorial

`READY` descreve maturidade documental. Não autoriza implementação.

## Problema

Escolas precisam operar internamente e se relacionar com alunos/responsáveis sem transformar todos em membros do Space. Além disso, a experiência para responsáveis deve funcionar bem no Web/Mobile e pode ser uma forte porta de entrada para o ecossistema OrdaX.

Sem uma arquitetura explícita, existe risco de misturar página pública da escola, gestão acadêmica, employee access e dados sensíveis de menores.

## Objetivo

Definir **OrdaX Education** como vertical de operação escolar sobre a plataforma OrdaX, com School Space privado e Portal da Família por REL-001.

```text
Space Escola
├── equipe interna
├── alunos
├── responsáveis autorizados
├── turmas/disciplinas
├── presença
├── avaliações/notas/boletim
├── atividades/calendário
├── autorizações/retirada
├── reuniões
├── documentos/comunicados
├── cobranças/pagamentos quando integrados
└── transporte escolar autorizado

Responsável/Aluno
 -> Portal Web/Mobile
 -> somente projections/actions autorizadas
```

## Não objetivos

- não colocar dados privados escolares no Achegue-se;
- não transformar responsáveis/alunos em `member` interno por padrão;
- não usar rastreamento contínuo e irrestrito de crianças;
- não oferecer câmera de sala 24/7 como recurso padrão;
- não reutilizar dados de menores para publicidade;
- não substituir sistemas legais/fiscais/financeiros sem owner e compliance específicos;
- não criar Healthcare por analogia.

## Estado atual verificado

### Já implementado

- Account/Spaces;
- membership básico;
- Web/Mobile/Native como modos arquiteturais;
- Notifications e Network como capacidades horizontais;
- categorias/afinidades Education aparecem em contratos/testes de Network.

### Parcialmente implementado

- Education existe como direção de produto/Profile, mas não como domínio escolar operacional completo;
- Achegue-se já reconhece Education como vertical futura própria para descoberta territorial, separada da operação interna.

### Ausente

- Education Core;
- Student/Guardian/Class/Enrollment models;
- attendance/grade/report-card;
- family portal;
- authorization/pickup workflow;
- meetings;
- transport tracking policy;
- dedicated privacy model for minors.

## Decisões arquiteturais propostas

### 1. Escola pública e Escola operacional são separadas

- **Achegue-se:** descoberta, página pública, território, matrícula/eventos públicos quando ativados.
- **OrdaX Education:** operação privada, alunos, responsáveis, equipe e dados acadêmicos.

Nunca projetar boletim, faltas, localização de criança ou dados privados para Achegue-se.

### 2. Aluno e responsável são relações de domínio

Education é SSOT de matrícula e vínculo responsável-aluno. REL-001 concede acesso ao portal; não redefine o vínculo acadêmico.

### 3. Equipe usa People + Membership

Professor/secretaria/direção podem ser People/Workforce e membros do Space conforme necessidade. Emprego e login permanecem separados.

### 4. Autorização de retirada é uma ação auditável

Exemplo:

```text
Responsável autenticado
 -> autoriza retirada específica
 -> sujeito + janela + pessoa autorizada + policy
 -> receipt server-authoritative
 -> portaria verifica estado atual
 -> retirada/encerramento auditado
```

Sem autorização por texto solto como authority.

### 5. Localização somente por finalidade delimitada

Priorizar:

- embarque/desembarque;
- veículo escolar/rota autorizada;
- excursão/evento temporário;
- check-in/check-out.

Não criar rastreamento pessoal permanente fora da finalidade escolar.

### 6. Câmera é capacidade separada e de alto risco

Qualquer vídeo ao vivo/gravação envolvendo menores/professores exige plano próprio de privacidade, consentimento, retenção, acesso, segurança e base legal. Não entra no primeiro EDU-001 operacional.

## Caminhos/owners afetados

- future Education domain;
- Account/Spaces/Identity;
- REL-001 external portal;
- Notifications/Calendar;
- Files/Documents;
- People/Workforce;
- Payments/Finance;
- Mobile location/capabilities somente por policy;
- Achegue-se first-party integration para projeção pública opcional.

## Fases

### Fase 0 — auditoria/precondições

- LGPD/minors threat model;
- matriz de dados por papel;
- consent/guardian proof;
- requisitos legais de escola/pagamentos/documentos;
- boundary com Achegue-se.

### Fase 1 — fundação

- School Space composition;
- Student, Guardian, Enrollment, Class, Subject;
- access policies;
- family relationship projection via REL-001.

### Fase 2 — implementação mínima

- alunos/responsáveis;
- turmas;
- frequência;
- notas/boletim;
- calendário/atividades;
- comunicados;
- Portal da Família Web responsivo.

### Fase 3 — operação ampliada

- autorizações/retirada;
- reuniões/agendamento;
- documentos;
- cobranças via Payments/Finance;
- transport check-in/route tracking limitado e consentido.

### Fase 4 — hardening/rollout

- Mobile;
- audit/security;
- export/delete/retention;
- integração pública Achegue-se somente para campos aprovados;
- Intelligence consultiva com escopo e privacidade explícitos.

## Gates de aceite

- responsável A não vê aluno B sem vínculo autorizado;
- professor não recebe acesso financeiro apenas por ser professor;
- aluno/responsável não vira admin/membro interno por default;
- autorização de saída possui actor/time/policy receipt;
- tracking é temporário/finalidade específica;
- câmera permanece fora até plano dedicado;
- dados de menores nunca alimentam ads.

## Segurança/privacidade

Prioridade máxima para dados de menores. Exigir minimização, access control server-side, consentimento apropriado, logs de auditoria sem conteúdo excessivo, retenção definida, revogação e export/delete conforme política aplicável.

## Custos/limites

Web pode ser porta de entrada de baixo atrito; Mobile é opcional. Custos futuros incluem notificações, storage/documentos, pagamentos e eventualmente mapas/localização. Nenhum fornecedor específico é obrigatório.

## Testes/evidências

- isolamento entre famílias;
- isolamento entre escolas/tenants;
- role matrix de professor/secretaria/admin/responsável/aluno;
- stale authorization rejeitada;
- revoke de guardian access;
- pagamento sem exposição cruzada;
- localização limitada à sessão autorizada.

## Rollback/degradação

Falhas em Portal/Mobile não podem corromper dados acadêmicos. Escola deve continuar operando internamente; recursos de tracking/pagamento/notificação degradam separadamente.

## Próxima ação documental

Revalidar somente depois de REL-001 e Identity/Spaces estarem maduros o suficiente e de o roadmap pós-MVP abrir Education.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Education é operação privada da escola. Achegue-se continua produto territorial público. Pais/alunos usam REL-001; equipe usa membership/People. Rastreamento contínuo e câmeras não fazem parte do primeiro rollout. **DEFERRED FOR EXECUTION**.
