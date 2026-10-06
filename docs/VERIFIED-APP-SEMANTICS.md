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


## Composição Native

A fonte verificada é consumida pela composição Native sem criar endpoint semântico paralelo.

A cadeia consultiva é:

```text
Local AI
  -> Intelligence base
  -> Profile Content (quando disponível)
  -> Application Context
  -> Memory / Identity / Space
  -> Personal OrdaX / consumidores
```

O `Intelligence base` continua sendo o owner de health e de inferência. O Application Context apenas acrescenta o catálogo confiável ao contexto de uma requisição e preserva `authority=none` e `toolExecution=false`.

A composição usa uma única factory, `createNativeVerifiedApplicationContextIntelligence()`, para evitar que o wiring real e os testes mantenham duas implementações do mesmo fluxo. Internamente ela:

1. cria a fonte verificada de component packages;
2. carrega somente `EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS`, isolando falhas por app;
3. aplica o overlay verificado sobre o catálogo first-party local;
4. constrói o Application Intelligence Awareness a partir das mesmas entries verificadas;
5. envolve o port que já passou por Profile Content com o Application Context;
6. mantém explicitamente `actionCapabilityRegistryPort=null` até existir catálogo real e autoritativo de capabilities.

Memory/Identity/Space continuam como wrapper externo final.

Se a fonte verificada estiver indisponível ou falhar, a composição preserva o catálogo local e não inventa semântica externa.

Não existem rotas dedicadas `/__ordax/native/app-intelligence-manifest` ou `/__ordax/native/app-intelligence-awareness`. A leitura continua reutilizando o namespace verificado de component packages já existente.
