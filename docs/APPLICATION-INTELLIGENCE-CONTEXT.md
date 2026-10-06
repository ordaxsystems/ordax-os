# Contexto de aplicações no OrdaX Intelligence

Status: **wrapper consultivo**

O OrdaX adiciona contexto de aplicações ao Intelligence por composição, seguindo o mesmo padrão usado por Memory e Profile Content.

O runtime base de Intelligence permanece independente.

## Fluxo

```text
request do usuário
    ↓
Application Context Intelligence
    ├─ contexto original autorizado
    ├─ Application Awareness
    └─ Application Action Capabilities (quando presentes)
    ↓
validateIntelligenceRequest
    ↓
Intelligence base
```

## IDs reservados

Os seguintes IDs pertencem à composição confiável e não podem ser fornecidos pelo chamador:

- `ordax-application-catalog`
- `ordax-application-action-capabilities`

Isso impede que contexto comum imite catálogo/capabilities do sistema.

## Orçamento

O wrapper respeita os limites globais de itens e caracteres do contrato de Intelligence.

Contexto estruturado de aplicações não é truncado. Se não houver espaço, a entrada inteira é omitida, preservando JSON válido e o contexto fornecido pelo usuário.

## Autoridade

O wrapper não adiciona métodos de execução.

O snapshot continua com:

```text
authority = none
toolExecution = false
```

Capabilities, quando disponíveis, continuam sendo somente descrição/proposta. Execução pertence a um broker futuro e separado.
