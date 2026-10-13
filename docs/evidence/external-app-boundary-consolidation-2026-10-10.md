# Fronteira de aplicativos externos — auditoria de 10/10/2026

Owner canônico: `system/composition/native/verified-installed-apps.mjs`.
Esta integração é **incremental** e não substitui a PR
[#1345](https://github.com/ordaxsystems/ordax-os/pull/1345) por completo.

## Código atual prevalece sobre host obsoleto

A PR antiga inclui `verified-external-app-host.mjs` com carregamento de
módulo diretamente de `packageSource.fileUrl()`, sem a revalidação
obrigatória do `current` imediatamente antes e depois da montagem.
Esse arquivo **não foi importado** e não foi criado um segundo executor.

A `main` já utiliza `verified-external-app-catalog.mjs` apenas para
descoberta descritiva; `createNativeVerifiedInstalledAppCatalog()`
exige escopo Native para o componente, e
`loadVerifiedCurrentComponentRuntime()` verifica metadados de slot,
origem loopback, identidade esperada e App Data vinculada pelo broker.

## Correção adicional no owner atual

A API `mountNativeVerifiedInstalledApps` aceita no contexto fornecido
pela composição apenas `root` e o objeto projetado
`surfaceLifecycle`. Nenhum `fileSpace`, `appActivation`, `intelligence`,
`identitySessionPort` ou `appData` passado pelo chamador atravessa
o limite. Campos herdados, símbolos, campos ocultos e getters são
rejeitados antes de executar código ou tocar no broker.

Quando presente, `surfaceLifecycle` deve satisfazer o contrato
`ordax.surface-render-lifecycle/5` e possuir apenas seus cinco
campos permitidos; não aceita o objeto Surface completo contendo
preferências ou administração do catálogo. A App Data continua vindo
exclusivamente de `composeTrustedComponentContext`.

A validação de owner do app instalado agora usa
`EXTERNAL_FIRST_PARTY_OWNER`, gerada a partir do mapa canônico de
pacotes, sem outra string de proprietário duplicada.

## Raiz DOM dedicada para runtime externo — 13/10/2026

A composição Native passa ao carregador a raiz compartilhada da Surface. Essa raiz é o pai de montagem do host, não o container de um aplicativo individual. O carregador de slot atual agora valida esse pai antes de fetch/import e, somente após revalidar a identidade do slot e obter o contexto confiável, cria um `div` vazio por componente com `data-ordax-component-root` e `display: contents`. Apenas esse elemento é passado como `context.root` ao runtime.

O ciclo de vida do elemento acompanha o runtime: ele é removido em `destroy()`, falha de montagem, timeout ou divergência de identidade detectada na revalidação pós-mount. Isso faz o contrato de raiz vazia respeitado por Files funcionar sem pedir ao aplicativo que limpe a Surface compartilhada e sem modificar a política de confiança, ativação de slot ou ownership bundled de Files. Este é um limite de montagem DOM, não um sandbox contra código externo hostil.

A regressão usa a Surface já ocupada, verifica que o runtime recebe um filho vazio por componente e comprova a limpeza em destroy, timeout e mudança de identidade. Os testes Native/Files relevantes passam juntos: **40/40 PASS**; `node --check` e `git diff --check` também passaram.

## Provas

- 30 testes JS com Node PASS: Native installed apps, catálogo Surface,
  descoberta de slots e registry de associação de arquivos.
- Os testes novos verificam tentativa de injetar portas privilegiadas,
  símbolos, getters/anexos ocultos, herança prototípica, objeto Surface
  excessivo e montagem legítima contendo somente `root`,
  `surfaceLifecycle` e App Data fornecida pelo broker.
- `node --check` e `git diff --check` PASS.
- Os gates existentes `first-party-app-delivery.yml` e
  `runtime-component-candidate.yml` já incluem
  `test_native_verified_installed_apps.mjs` e observam o caminho
  alterado. Não foi criado um terceiro workflow duplicado.

## Escopo ainda aberto

Associações de arquivo estão validadas como metadados e resolvidas
pelo registry canônico, **mas não são atualmente autorização de leitura**
do arquivo por apps externos. O módulo Native intencionalmente
não recebe File Space irrestrito; somente o broker poderá conceder
uma capacidade limitada ao arquivo explicitamente aberto pelo usuário.

Sem essa ponte restrita, seria incorreto simular sucesso da associação
com um simples `appActivation.publish({target:path})`, pois o app
poderia não ter autorização para ler o conteúdo. Essa parte e os
conflitos restantes da PR #1345 permanecem a resolver.
Não houve criação de novo host, elevação de privilégio nem ativação
de app sem slot verificado.
