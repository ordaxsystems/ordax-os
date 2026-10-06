# Manifesto de Inteligência de Apps

Status: **contrato público v1**

O `ordax.app-intelligence-manifest/1` define como um app descreve ao OrdaX Intelligence o que ele é, como deve ser interpretado e quais intenções de alto nível oferece.

## Objetivo

O manifesto permite que o OrdaX/Jarvis descubra semanticamente um app instalado sem depender do conhecimento congelado do modelo local.

Ele é a fonte operacional atual para:

- instruções específicas do app;
- intenções que o usuário pode expressar por texto ou voz;
- parâmetros esperados;
- classificação do efeito da intenção;
- política de confirmação.

O treinamento do modelo pode ajudar no conhecimento geral, mas não substitui esse contrato.

## Limite de autoridade

O manifesto é **declarativo e não autoritativo**:

```text
execution = declarative-only
authority = none
```

Um app não ganha permissão para executar ações porque declarou uma intenção. A execução futura precisa ser ligada por um contrato público de runtime, passar pelas permissões do OrdaX e respeitar confirmação/política.

`ordax.intelligence/1` continua consultativo e com `toolExecution=false`.

## Apps oficiais

Todo app first-party distribuível deve possuir:

```text
apps/<app-id>/
  app.json
  ai/
    manifest.json
  src/
  assets/
  tests/
```

O `appId` e o `appVersion` do manifesto devem corresponder ao `app.json`.

Intents precisam ser namespaced pelo app:

```text
notes.create-note
studio.open-project
commerce.publish-product
```

## Apps externos

Instagram, Shopee, Photoshop e outros produtos externos não precisam implementar um arquivo do OrdaX.

O conector/adapter OrdaX correspondente é responsável por expor uma descrição compatível com este contrato. Assim, o modelo local usa o mesmo modelo mental para apps first-party e integrações externas, sem tratar software de terceiros como trusted first-party.

## Voz

Exemplo futuro:

```text
"ORDAX, publique o Homem de Ferro por 200 reais."
        ↓
speech-to-text
        ↓
OrdaX Intelligence
        ↓
intent: commerce.publish-product
parameters:
  product = "Homem de Ferro"
  price = 200
        ↓
runtime binding autorizado
        ↓
permission/confirmation gate
        ↓
execução
```

A etapa de runtime binding não faz parte deste manifesto v1.

## Efeitos

Os efeitos permitidos são:

- `none`: orientação sem leitura/escrita;
- `read`: leitura de dados;
- `write`: alteração interna do app;
- `external-write`: alteração em serviço externo;
- `destructive`: ação destrutiva.

`external-write` e `destructive` não podem declarar `confirmation=none`.

## Segurança

Instruções do app ficam abaixo das políticas do sistema e do usuário. Um manifesto nunca pode:

- elevar privilégios;
- ignorar confirmação;
- conceder acesso a arquivos, rede ou contas;
- substituir regras do OrdaX Intelligence;
- transformar texto do app em autoridade.

A instalação/assinatura do app e a autorização de uma ação continuam sendo decisões separadas.
