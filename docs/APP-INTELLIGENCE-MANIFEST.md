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


## Consumo pelo Application Awareness

O serviço `system/services/intelligence/application-awareness.mjs` é o consumidor semântico do manifesto.

A composição confiável pode fornecer ao serviço apenas manifests first-party provenientes de um pacote já verificado. O serviço:

- revalida `appId` e `appVersion` contra a identidade first-party conhecida;
- rejeita manifests órfãos, duplicados ou associados a apps externos;
- projeta instruções e intents para o contexto consultivo do Intelligence;
- não expõe método de execução;
- mantém `actionExecutionAuthorized=false`, `modelToolExecutionAuthorized=false` e `toolExecution=false`.

Isso separa duas responsabilidades:

```text
pacote verificado
    ↓
application-awareness
    ↓
contexto semântico consultivo
    ↓
Ordax Intelligence

execução
    ↓
contrato/binding separado
    ↓
permission + confirmation gates
```

A leitura física de `ai/manifest.json` do slot instalado pertence à composição/runtime confiável e não ao modelo, ao Studio ou ao próprio app.


## Leitura do slot verificado no Native

No Native/Stable, a composição não lê o pacote diretamente e o modelo nunca recebe acesso ao diretório de component slots.

O Native Host expõe somente uma projeção dedicada:

```text
GET /__ordax/native/app-intelligence-manifest?component=<app-id>
```

A implementação:

- resolve o `current` pelo helper assinado do lifecycle de componentes;
- exige fonte `SLOT` ativa;
- prende a leitura a `version + sourceCommit` exatos;
- lê somente `system/apps/<app-id>/ai/manifest.json`;
- rejeita schema, identidade, versão, autoridade ou modo de execução divergentes;
- retorna `404` quando não há slot ativo;
- nunca oferece caminho de arquivo arbitrário ao consumidor de Intelligence.

A composição Native revalida novamente o manifesto pelo contrato público e só então o fornece ao `application-awareness`.

## Injeção no Intelligence real

O wrapper `application-context.mjs` adiciona o item de Application Awareness às requisições consultivas do usuário quando houver orçamento de contexto.

Ele não substitui contexto existente, não remove limites e não expõe `execute`, `run` ou `invoke`.

A ordem é:

```text
slot assinado atual
   ↓
Native Host (leitura exata do manifesto)
   ↓
adapter Native
   ↓
application-awareness
   ↓
application-context
   ↓
Profile/Memory context
   ↓
Ordax Intelligence
```

Rotinas internas de extração de Memory continuam usando o Intelligence base sem o catálogo de apps, evitando contexto irrelevante e dependências circulares.

Apps sem slot verificado continuam conhecidos apenas pela identidade first-party já disponível; eles não recebem semântica inventada. Produtos externalizados como Notes só entram na projeção completa quando o lifecycle/Store fornecer uma identidade first-party instalada canônica.


## Identidade first-party instalada

Para apps externalizados, a semântica não pode depender do catálogo local de código-fonte.

Quando existe um `current` component-slot verificado, a composição Native usa dois arquivos do mesmo pacote e da mesma identidade `version + sourceCommit`:

```text
system/apps/<app-id>/app.json
system/apps/<app-id>/ai/manifest.json
```

O primeiro fornece a identidade do componente instalado; o segundo fornece sua semântica consultiva. Ambos são lidos pelo helper do lifecycle, que revalida assinatura, package manifest e SHA-256 antes de devolver bytes.

A lista de ids que podem ser sondados vem do registro de delivery first-party, não de diretórios encontrados no disco. Um slot desconhecido não se torna produto OrdaX apenas por existir.

Na composição, a identidade instalada verificada pode substituir a identidade de apresentação local de mesmo `appId`. Isso permite que produtos externalizados, como Notes e futuramente Commerce, apareçam no Application Awareness somente quando estiverem realmente instalados e verificados.

O Component Manager continua sendo saúde/versão de composição; ele não é promovido artificialmente a fonte criptográfica da instalação.
