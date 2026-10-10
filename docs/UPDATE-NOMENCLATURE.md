# Nomenclatura de entrega e atualização

Status: CANÔNICO PARA O PROTÓTIPO

Este documento separa os identificadores internos de desenvolvimento dos identificadores que aparecem para quem usa o OrdaX. **Versão própria de um componente e capacidade de atualizá-lo independentemente são eixos diferentes.**

## Regra principal

```text
PR do GitHub
  -> mudança de desenvolvimento
  -> merge / commit SHA
  -> classificação do impacto
  -> Entrega OrdaX, somente quando há efeito no dispositivo
  -> aplicação no notebook
  -> Atualização aplicada
```

Um número de PR nunca é o número de uma atualização do notebook.

## Identidades

| Conceito | Exemplo atual | Uso |
|---|---|---|
| PR | `#369` | revisão e integração de desenvolvimento no GitHub; não é identidade de produto |
| Commit técnico | SHA Git de 40 hex | identidade exata do código-fonte |
| Entrega | `Entrega N` | sequência humana das mudanças aplicáveis ao dispositivo |
| Aplicação | `Entrega N · Aplicada` | registro local de quando aquele dispositivo aplicou a entrega |
| Versão de produto | `OrdaX Prototype v0.1.0` | marco humano do produto; não é inferido de PR nem de Entrega |
| Versão de componente/app | SemVer próprio | identidade daquele componente; não implica atualização independente |
| Maturidade de app | `Beta` para first-party `0.x` | estágio do app; `1.0.0` fica reservado para a primeira versão estável daquele app |

A versão do produto, a Entrega, o SHA técnico e a versão de cada componente **não devem ser colapsados em um único número**.

## Família OrdaX e versão por plataforma

Os nomes públicos são resolvidos exclusivamente pelo contrato executável `system/contracts/product-family.mjs`, referenciado por `docs/contracts/branding.json` e conferido contra os cinco IDs do `foundation.json`. Não renomear os IDs técnicos `web`, `mobile`, `desktop`, `usb` e `native-disk` ou criar árvores de apps por plataforma.

| Identidade pública | Versão e atualização |
|---|---|
| **OrdaX Web** | release/deploy Web próprio; sem versão declarada até existir publicação verificável |
| **OrdaX Mobile** | aplicativo Android/iOS; versão do pacote/app próprio, sem presumir APK publicado |
| **OrdaX Desktop** | app instalado no host, com pacote/atualizador próprio e assinatura quando houver release |
| **OrdaX OS — USB** | versão do produto OS; Entrega, Base e release assinada continuam identidades diferentes |
| **OrdaX OS — Nativo** | **a mesma versão de OrdaX OS do USB**, pois compartilham sistema/release; modo de instalação distinto |

O `OrdaX Tablet` é layout da modalidade Mobile, não versão ou artefato independente; `OrdaX Studio` é um app com seu próprio owner/manifests e não um modo adicional. A mesma Conta e Surface não forçam o mesmo SemVer de todos os clientes. A versão atual `0.1.0` é **do protótipo de OS**, não uma versão implicitamente publicada de Web, APK ou Desktop. Não prefixar `v1.0` por marketing, não reutilizar números de PR e não derivar a presença de download da definição de marca.


## Sequência de Entrega

Enquanto o protótipo usa a `main` como fonte de atualização do notebook Owner/Development, o número de Entrega é derivado da sequência first-parent de mudanças que realmente atingem o dispositivo.

A sequência atual tem uma âncora explícita: o commit `2361b9e7…` é **Entrega 220**. Depois dessa âncora, contam mudanças em `system/`, `boot/` e `bootstrap/`, mas não contam:

- arquivos Markdown nesses owners;
- scripts `prove_*` usados apenas para evidência/CI em `boot/` ou `bootstrap/`;
- site público, documentação geral, testes, CI ou compliance sem efeito nos bytes/runtime do notebook.

A âncora preserva os números que já haviam sido observados fisicamente enquanto permite tornar a classificação mais precisa sem renumerar o histórico exibido ao usuário. Uma prova de CI não cria uma Entrega e também não deve marcar um novo boot como necessário.

A sequência não usa número de Pull Request.

O SHA continua sendo a identidade técnica exata. O número de Entrega existe apenas para leitura humana e histórico.

## Atualização

“Atualização” é o ato/estado no dispositivo, não um objeto do GitHub.

Exemplos:

```text
Entrega N disponível
Atualizando…
Entrega N aplicada
Entrega N revertida
```

Uma mudança em `sites/public/` pode avançar a `main` sem produzir uma nova Entrega para o notebook.

## Componentes e aplicativos

Todo componente pode ter uma versão SemVer própria mesmo quando ainda é distribuído junto com outro componente. O `releaseMode` diz **como ele é entregue/ativado**, não se ele merece ou não uma identidade de versão.

Modos atuais do contrato:

- `base-ab`: exclusivo da Base crítica, com semântica A/B e reboot;
- `bundled`: acompanha a entrega conjunta; ter versão própria não cria rollback individual;
- `git-app`: app com versão própria entregue diretamente pelo checkout/reconcile no perfil Owner/Development; **não é** Store/updater independente de produção;
- `component-slot`: caminho reservado para atualização independente de produção, com pacote verificado/assinado, candidato pendente, health, promoção e rollback individual.

### Apps first-party atuais

Os valores abaixo refletem os manifests/fontes da `main` e devem mudar junto com eles:

```text
Arquivos  0.1.0  Beta  bundled
Ajustes   0.1.0  Beta  bundled
Conta     0.1.0  Beta  bundled
Sistema   0.1.0  Beta  bundled
Internet  0.3.0  Beta  git-app
Notas     0.4.0  Beta  git-app
```

`Internet` e `Notas` já possuem versões próprias sem que isso declare atualização independente de produção. Arquivos, Ajustes, Conta e Sistema também possuem identidade de componente mesmo enquanto seguem `bundled`.

O estágio **Beta** vem da convenção first-party `0.x`; não vem do canal de entrega. `1.0.0` é reservado para a primeira versão estável daquele app.

O Stable/MVP deve evoluir componentes apropriados para `component-slot` somente depois que verificação assinada, pending health, promoção e rollback estiverem implementados e provados. Até lá, não apresentar `git-app` como mecanismo público de atualização independente.

## Fonte dos valores atuais e prevenção de documentação obsoleta

- `system/contracts/product-version.mjs` é a fonte runtime da versão do produto;
- os manifests/component owners em `system/` são a fonte das versões e `releaseMode` dos componentes;
- `docs/CURRENT-STATE.md` registra o snapshot humano canônico desses valores;
- `docs/contracts/update-nomenclature.json` registra as regras de identidade e distribuição;
- testes do Foundation devem falhar quando esses valores canônicos divergirem.

Uma alteração de versão/modo de release que deixe `CURRENT-STATE`, este documento ou o contrato de nomenclatura contraditórios é uma alteração incompleta.

## Compatibilidade do contrato atual

O campo legado `versionNumber` de `ordax.update-status/1` e `ordax.update-history/1` permanece temporariamente como alias de compatibilidade. A UI e o novo código usam `deliveryNumber`.

Nenhum código novo deve interpretar `versionNumber` como número de PR ou como versão comercial do OrdaX.
