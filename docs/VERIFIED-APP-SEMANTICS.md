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
system/apps/<app-id>/ai/manifest.json
    ↓
validateAppIntelligenceManifest(...)
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
