# TALENT-001 — Identidade profissional, vagas e contratação

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P2
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** Account/Identity + OrdaX Network + future People/Workforce; hiring decisions remain human/domain-owned
- **Base factual:** `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`, Spaces membership contracts, IDENTITY-001, REL-001
- **Relatórios de apoio:** ACHEGUESE-001 quando criado
- **Dependências:** Network, IDENTITY-001, REL-001, Messaging, future People/Workforce, Notifications; optional Achegue-se publication boundary

`READY` descreve maturidade documental. Não autoriza implementação.

## Problema

O OrdaX já possui Account, Spaces e uma Network profissional centrada em Spaces, mas ainda não possui uma identidade profissional pessoal voltada a carreira, vagas, candidatura e contratação.

Usar Profile Pack para isso seria incorreto. Um `Profile Pack` configura um Space; não representa currículo, carreira ou reputação de uma pessoa.

## Objetivo

Criar uma camada de **Identidade Profissional** account-scoped e um domínio de **Jobs/Talent** conectado à Network:

```text
Pessoa / Account
 -> Identidade Profissional
     -> experiências
     -> competências
     -> formação/certificados
     -> portfólio
     -> disponibilidade

Space empregador
 -> Vaga
 -> candidatos
 -> conversa/processo
 -> contratação humana
 -> People/Workforce
 -> convite ao Space quando necessário
```

## Não objetivos

- não copiar LinkedIn integralmente;
- não criar feed infinito como centro do produto;
- não confundir identidade profissional com Profile Pack;
- não inferir saúde, religião, política, raça, vida sexual ou outros atributos sensíveis para seleção;
- não permitir decisão final de contratação totalmente automatizada;
- não transformar avaliação de IA em autoridade de emprego;
- não publicar automaticamente histórico interno de Spaces.

## Estado atual verificado

### Já implementado

- Account/Spaces;
- Network com diretório, comunidades, grupos e mensagens em arquitetura/backend;
- membership e papéis de Space;
- integração first-party planejada com Achegue-se.

### Parcialmente implementado

- Network publica identidade profissional do **Space**, não currículo pessoal;
- Messaging pode servir ao processo, mas não existe Hiring domain.

### Ausente

- professional identity account-scoped;
- vagas/ATS leve;
- candidatura;
- experiência verificável;
- portfolio consentido;
- passagem de contratado para People + Space membership.

## Decisões arquiteturais propostas

### 1. Identidade profissional fica fora do Space

A pessoa mantém sua identidade profissional mesmo ao sair de uma empresa. Spaces podem confirmar relações/experiências somente com consentimento e receipt.

### 2. Verificado e declarado são diferentes

Exemplo:

- `declarado pela pessoa`;
- `confirmado por organização autorizada`;
- `certificado por issuer aceito`.

A UI nunca mistura esses níveis.

### 3. Vaga pertence ao Space empregador

A empresa publica em nome de um Space explícito. Candidato pertence à sua conta/identidade profissional.

### 4. Contratação não equivale a membership

Após contratação:

```text
Hiring result
 -> People/Workforce cria vínculo quando aplicável
 -> IDENTITY-001 convida para o Space se o trabalho exigir acesso
```

### 5. Matching é explicável e limitado

IA pode resumir experiência e comparar requisitos objetivos declarados/comprovados. Não deve produzir score secreto de "qualidade humana" nem usar sinais sensíveis/protegidos.

### 6. Achegue-se pode ser canal territorial

Uma vaga pode ser projetada explicitamente para o Achegue-se como oportunidade local. Achegue-se continua dono da descoberta territorial; OrdaX continua dono da vaga/processo se a vaga nasceu no OrdaX.

## Caminhos/owners afetados

- Account/Identity;
- Network;
- Messaging/Notifications;
- People/Workforce futuro;
- Spaces/Entitlements;
- Achegue-se first-party boundary para publicação local opcional.

## Fases

### Fase 0 — auditoria/precondições

- privacy model;
- moderação/antifraude;
- ownership de certificados/verificações;
- matriz de atributos proibidos em matching.

### Fase 1 — fundação

- professional identity contract;
- visibility/consent;
- experience/skill/education/portfolio projections;
- verification receipts.

### Fase 2 — implementação mínima

- editar identidade profissional;
- publicar vaga por Space;
- candidatura;
- shortlist manual;
- Messaging;
- status de processo.

### Fase 3 — hardening

- anti-spam/fake jobs;
- block/report;
- data retention;
- candidate export/delete;
- audit trail;
- explainable matching assistivo.

### Fase 4 — integração/rollout

- People handoff;
- Space invite;
- Achegue-se territorial projection;
- certificados/issuers externos autorizados.

## Gates de aceite

- Profile Pack nunca vira currículo;
- vaga tem Space owner explícito;
- candidato controla visibilidade;
- empresa não vê dados privados não compartilhados;
- IA não decide contratação;
- contratação não concede membership automaticamente;
- experiência "verificada" exige issuer/receipt real.

## Segurança/privacidade

Dados de carreira são pessoais. Minimização, consentimento, export/delete e visibilidade granular são obrigatórios. Matching não pode usar atributos sensíveis nem proxies deliberados para discriminação.

## Custos/limites

Custos de mensagens/notificações, storage de portfólio e inference opcional. Matching deve funcionar de forma degradada sem LLM.

## Testes/evidências

- visibilidade pública/privada;
- employer A não acessa candidatura privada de employer B;
- verification não pode ser forjada pelo cliente;
- consent revoke remove projeção futura;
- hiring handoff não concede role indevido.

## Rollback/degradação

Sem Talent/Jobs, Network e People continuam independentes. Vagas não devem bloquear o funcionamento dos Spaces.

## Próxima ação documental

Revalidar após Network pública e People/Workforce terem owners estáveis.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Construir como extensão da Network/Identity, não como clone de LinkedIn nem como Profile Pack. Publicação territorial no Achegue-se é uma projeção explícita. **DEFERRED FOR EXECUTION**.
