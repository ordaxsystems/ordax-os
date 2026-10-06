# Fonte verificada de semântica de apps

Status: **fundação read-only**

Este documento descreve como a composição nativa pode obter semântica de um app first-party externo sem confiar em arquivos soltos e sem conceder execução ao OrdaX Intelligence.

## Fluxo

```text
activation state
    ↓
ordax-runtime-component-channel resolve-current
    ↓
identidade exata do slot
  component + version + source commit
    ↓
ordax-runtime-component-channel read-runtime-file
    ↓
system/apps/<app-id>/app.json
  + system/apps/<app-id>/ai/manifest.json
    ↓
validação conjunta:
  component id/version/releaseMode/owner
  + app intelligence manifest
    ↓
Application Intelligence Awareness
    ↓
contexto consultivo do Intelligence
```

O arquivo não é lido diretamente do filesystem pelo modelo, Studio ou app.

## Boundaries

A fonte `ordax.verified-component-package-source/1` é read-only. Ela não expõe:

- execução;
- instalação/desinstalação;
- promoção/rollback;
- escrita de arquivos.

A URL de arquivo é vinculada ao estado, versão, source commit e caminho de pacote exatos.

O host nativo continua sendo responsável por revalidar assinatura, trust anchor, manifest do pacote e hashes antes de devolver bytes.

## Estado ausente

Apps externos não instalados são representados por `SOURCE=ABSENT`.

Nesse caso nenhum `ai/manifest.json` é lido e nenhuma semântica é inventada.

## Separação de autoridade

Conhecer um intent não autoriza executá-lo.

```text
semântica verificada
    → entendimento

runtime binding + grants + policy + confirmação
    → execução futura
```

Essas etapas permanecem separadas por contrato.


## Identidade do app externalizado

A semântica não é aceita isoladamente.

Para um app first-party vindo de `ordax-apps`, a mesma identidade de slot precisa fornecer:

- `system/apps/<app-id>/app.json`;
- `system/apps/<app-id>/ai/manifest.json`.

O `app.json` deve validar como:

- `kind=app`;
- `releaseMode=component-slot`;
- `owner=washingtonmsdj/ordax-apps`;
- mesmo `appId` e versão da resolução verificada.

O manifesto de Intelligence é então validado contra essa identidade de componente.

Isso permite que um produto externalizado como Notes exista semanticamente sem reintroduzir seu payload no `system/`, e impede que uma representação de desenvolvimento `git-app` seja confundida com um pacote externo instalado.


## Overlay sobre o catálogo local

A composição pode possuir uma representação local de desenvolvimento para um app que também foi instalado como componente externo.

A regra é determinística:

1. uma identidade externa verificada com o mesmo `appId` substitui a representação local apenas para o catálogo semântico do Intelligence;
2. um app externalizado que não exista mais no catálogo local, como Notes, é acrescentado a esse catálogo semântico;
3. IDs duplicados em qualquer fonte falham fechado;
4. o overlay não instala, ativa, promove nem altera o app.

Isso impede que o Intelligence misture, por exemplo, a identidade Studio `git-app` de desenvolvimento com o Studio `component-slot` instalado.


## Composição Native real

A composição Native consome esta fonte depois de criar o `ordax.intelligence/1` base.

O fluxo real é:

```text
createNativeVerifiedComponentPackageSource
        ↓
loadVerifiedFirstPartyApplicationSemantics
        ↓
overlayVerifiedFirstPartyApplications
        ↓
createApplicationIntelligenceAwareness
        ↓
createApplicationAwareIntelligence
        ↓
Profile content autorizado
        ↓
Memory autorizada
        ↓
Assistant / Personal OrdaX / explicações ao usuário
```

A leitura de semântica é fail-soft para disponibilidade: se a fonte Native verificada estiver indisponível, a composição continua com o catálogo local e sem inventar Notes ou qualquer semântica externa.

Falha de disponibilidade não concede fallback para arquivo solto, diretório local ou payload não verificado.

O wrapper `application-context.mjs` acrescenta somente o item de contexto produzido por Application Awareness quando houver orçamento de itens e caracteres. Ele não remove contexto do chamador e não expõe métodos de execução.

Rotinas internas de extração automática de Memory continuam usando o Intelligence base, sem o catálogo de apps. Isso evita que semântica de aplicação contamine tarefas internas de classificação/extração e mantém o caminho de consumo do usuário explicitamente separado.

Conhecimento continua sem autoridade:

```text
Application Awareness
authority = none
toolExecution = false
        ↓
Intelligence entende intent/parâmetros

≠ execução
```

Runtime binding, grants, policy, confirmação e receipt continuam sendo um gate separado.


## Composição Native consumidora

A fonte verificada só produz contexto útil quando a composição Native a liga explicitamente ao Intelligence usado pelos consumidores.

O fluxo autoritativo é:

```text
verified-component-package-source
        ↓
loadVerifiedFirstPartyApplicationSemantics()
        ↓
overlayVerifiedFirstPartyApplications()
        ↓
createApplicationIntelligenceAwareness()
        ↓
createApplicationAwareIntelligence()
        ↓
Profile / Space / Memory wrappers
        ↓
Assistant + consumidores consultivos
```

A leitura de semântica externalizada é fail-soft: se o component-slot não estiver disponível ou falhar como capacidade opcional, a composição mantém o catálogo local sem inventar Notes/Studio instalados.

O wrapper `createApplicationAwareIntelligence()` acrescenta apenas o item de contexto `ordax-application-catalog` quando houver orçamento de itens e caracteres suficiente. Ele não substitui contexto fornecido pelo chamador e não expõe `execute`, `invoke` ou `run`.

A cadeia preserva:

```text
authority = none
toolExecution = false
```

O Intelligence base continua sendo usado para coordenação interna onde Application Awareness não é necessário, como captura/coordenação de Memory. O caminho voltado ao usuário recebe Application Awareness antes dos wrappers de Profile, Space e Memory.

Esta composição não implementa runtime binding de intents, grants, policy gate, confirmação ou App Action Broker. Conhecer `notes.create-note` continua sendo somente conhecimento operacional declarativo.
