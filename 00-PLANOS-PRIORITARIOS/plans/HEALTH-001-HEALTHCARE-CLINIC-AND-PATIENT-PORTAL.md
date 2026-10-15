# HEALTH-001 — Healthcare, Clínica e Portal do Paciente

- **Tipo:** PLAN / ROADMAP
- **Status documental:** TRIAGED
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION
- **Prioridade:** P3
- **Criado:** 2026-10-15
- **Atualizado:** 2026-10-15
- **Owner canônico:** ainda não definido; futuro Healthcare domain + REL-001 para portal externo
- **Base factual:** REL-001, Account/Spaces/Identity, Web/Mobile e boundaries de privacidade atuais
- **Relatórios de apoio:** nenhum; exige pesquisa jurídica, clínica e de segurança antes de promoção para READY
- **Dependências:** REL-001, IDENTITY-001, Notifications, Payments/Finance; pesquisa LGPD/dados de saúde, interoperabilidade e requisitos regulatórios

`TRIAGED` preserva a direção sem declarar o plano maduro. Este item não autoriza qualquer handling real de dados de saúde.

## Problema

O modelo Space + Portal pode futuramente atender clínicas, laboratórios e outros prestadores de saúde, mas dados de saúde são sensíveis e não podem ser tratados como simples variação de Escola, Food ou CRM.

Também existe interesse futuro em farmácias, porém dispensação, prescrição, medicamentos controlados, integrações clínicas e advertising em saúde exigem boundaries e pesquisa próprios.

## Objetivo

Preservar a direção de um **Healthcare Space** com Portal do Paciente, sem antecipar decisões regulatórias:

```text
Space Clínica
 -> equipe autorizada
 -> pacientes/relações clínicas
 -> agenda/atendimento
 -> documentos disponibilizados
 -> pagamentos autorizados
 -> Portal do Paciente via REL-001
```

A primeira versão futura, se promovida, deve priorizar relacionamento administrativo e acesso autorizado, não diagnóstico autônomo.

## Não objetivos

- não armazenar prontuário real antes de owner/security/compliance aprovados;
- não usar IA para diagnóstico ou prescrição autônoma;
- não transformar dados de saúde em Memory geral sem policy específica;
- não usar dados clínicos para anúncios/targeting;
- não expor condição de saúde no Network/Achegue-se;
- não construir farmácia/dispensação/prescrição apenas reutilizando catálogo de varejo;
- não assumir FHIR ou outro padrão como obrigatório sem pesquisa de integração real.

## Estado atual verificado

### Já implementado

- Account/Spaces;
- membership básico;
- Web/Mobile architecture;
- REL-001 documentado como futura foundation de portal externo.

### Parcialmente implementado

- nenhuma capability atual equivale a Healthcare domain pronto;
- Payments/Notifications/Files podem ser reutilizáveis, mas não concedem semântica clínica.

### Ausente/não provado

- Healthcare domain owner;
- data classification específica;
- legal/compliance research;
- clinical authorization matrix;
- patient relationship model;
- healthcare retention/audit policy;
- interoperability boundary;
- pharmacy/medication safety owner.

## Decisões arquiteturais propostas

### 1. Saúde é domínio próprio

Healthcare não deve ser implementado como templates genéricos sobre CRM. Prontuário, atendimento, prescrições e dados clínicos exigem contratos próprios.

### 2. Portal usa REL-001, sem membership interno

Paciente é relação externa autenticada/autorizada, não `member` do Space da clínica.

### 3. Informação pública e clínica são separadas

Achegue-se pode futuramente exibir página pública da clínica, localização, contato e serviços públicos. Relação paciente-clínica, consultas e documentos permanecem privados no OrdaX.

### 4. IA é assistiva e gated

Qualquer inteligência clínica futura precisa de políticas de uso, provenance, revisão humana e validação regulatória. O plano não autoriza diagnóstico, triagem crítica ou prescrição autônoma.

### 5. Farmácia exige subplano antes de execução

Catálogo público e ofertas não equivalem a dispensação farmacêutica. Receitas, medicamentos controlados, validação profissional, estoque regulado e entrega exigem pesquisa/owner específicos antes de um plano executável.

## Caminhos/owners afetados

Ainda não fixar paths de domínio. Quando houver prioridade real, auditar:

- Account/Spaces/Identity;
- REL-001;
- Files/Documents;
- Notifications/Calendar;
- Payments/Finance;
- security/audit;
- Web/Mobile;
- Product OAuth/Achegue-se somente para projeções públicas não sensíveis.

## Fases

### Fase 0 — pesquisa obrigatória

- LGPD e dados sensíveis;
- requisitos brasileiros aplicáveis a clínicas/laboratórios/farmácias;
- threat model;
- retenção/auditoria;
- interoperabilidade;
- responsabilidades clínicas e humanas.

### Fase 1 — fundação

Somente após pesquisa: definir Healthcare domain, patient relationship, consent/access matrix e data classification.

### Fase 2 — implementação mínima

Se promovido: agenda, documentos liberados, mensagens/notifications apropriadas e Portal do Paciente, sem decisões clínicas autônomas.

### Fase 3 — hardening

Security review dedicado, export/delete/retention, audit, incident response e provas multi-tenant.

### Fase 4 — expansão

Somente depois: integrações clínicas específicas, laboratórios e eventual Pharmacy subplan.

## Gates de aceite

Ainda não definidos; promoção para `READY` exige pesquisa jurídica/segurança/produto específica.

## Segurança/privacidade

Dados de saúde são tratados como sensíveis. Proibir uso para publicidade, recomendação comercial baseada em condição clínica e exposição pública indireta. Consentimento não substitui minimização nem authorization server-side.

## Custos/limites

Desconhecidos. Não escolher provider de healthcare, storage ou interoperability antes da pesquisa.

## Testes/evidências

A definir após threat model e owner canônico.

## Rollback/degradação

Healthcare nunca pode ser dependência de boot/uso geral do OrdaX. Qualquer futura integração degrada isoladamente.

## Próxima ação documental

Somente quando Healthcare ganhar prioridade real: produzir pesquisa regulatória/segurança e promover ou rejeitar este plano com owner explícito.

## Próxima ação de execução

DEFERRED.

## Handoff para outro chat/agente

Este é um placeholder arquitetural deliberadamente `TRIAGED`, não um plano pronto. Não implementar prontuário, prescrição, farmácia ou IA clínica a partir deste arquivo. Primeiro fazer pesquisa dedicada e definir owner/compliance. **DEFERRED FOR EXECUTION**.
