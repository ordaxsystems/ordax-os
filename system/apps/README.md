# Apps — ownership e catálogo atual

`system/apps/` contém somente as implementações first-party ainda pertencentes ao
OrdaX OS. Identidade, política de entrega e descoberta de aplicativos externos
podem existir sem um payload de aplicativo embutido.

Os módulos são compartilhados entre Web/Native/Desktop por contratos públicos e
portas de capacidade, nunca por cópias de UI específicas de cada host.

## Catálogo embutido

A fonte executável é `system/apps/catalog.mjs`, validada por
`system/contracts/first-party-app.mjs`. No estado atual da `main`, ela registra:

| App | Fonte local | Natureza / entrega |
| --- | --- | --- |
| Arquivos (`files`) | `system/apps/files/` | App removível, `bundled` enquanto não houver handoff bootstrap assinado |
| Studio (`studio`) | `system/apps/studio/` | Integração local `git-app`; produto portátil canônico em `ordax-apps/apps/studio` |
| Ajustes (`settings`) | `system/apps/settings/` | Superfície estrutural `bundled` |
| Conta (`account`) | `system/apps/account/` | Superfície estrutural `bundled` |
| Loja (`store`) | `system/apps/store/` | Superfície estrutural `bundled` |
| Sistema (`system`) | `system/apps/system/` | Superfície estrutural `bundled` |

Os manifestos do catálogo de componentes pertencem aos seus owners locais:
`system/apps/files/component.mjs`,
`system/apps/studio/component.mjs` e
`system/services/components/manifests/apps.mjs`. Não registrar um mesmo
`appId` simultaneamente como embutido e como `component-slot` externo:
`system/apps/runtime-catalog.mjs` rejeita a colisão em vez de esconder uma
segunda fonte.

Versão de app, versão do OrdaX e commit Git são identidades diferentes. Valores
correntes de SemVer/`releaseMode` devem ser lidos dos próprios manifestos;
não manter uma tabela manual de versões neste documento. `0.x` é a linha Beta,
não uma declaração de instalação independente ou homologação do MVP.

`system/services/components/update-presentation.mjs` apresenta separadamente
atualizações do sistema e dos aplicativos. `git-app` representa entrega de
desenvolvimento pelo Git, não updater autônomo. `component-slot` requer
assinatura, verificação, health, promoção e rollback comprovados pelo owner
de lifecycle antes de aparecer como instalado.

## Apps já externos e corte pendente

- **Internet, Assistente, Projetos, Atividade, Rede e Notas** já têm fonte
  canônica em `ordaxsystems/ordax-apps/apps/<id>/` e não possuem fonte
  em `system/apps/<id>/`. Os respectivos
  `ordax-apps/migrations/<id>.externalization.json` governam os gates:
  source cutover concluído não implica publicação/instalação ativada.
- **Arquivos** ainda tem fonte canônica no OS. A tentativa isolada de remoção
  (PR `ordax-os#1742`) não foi
  mesclada porque quebrava os gates do bootstrap USB. A
  issue `ordax-os#1743`
  exige fonte única, pacote assinado, slot verificado e interface funcional no
  boot antes do handoff. Uma prova de pacote efêmero não autoriza remoção
  prematura nem a criação permanente de `apps/files` em Apps.
- **Studio** tem código de produto portátil no owner Apps, mas a integração
  embutida do OS ainda existe. Seu corte depende de paridade Native/Web,
  instalação/ativação verificadas e ausência de caminho local residual;
  componentes host-owned continuam na plataforma.

Após a externalização, o OS conserva contratos e serviços públicos legítimos:
File Space, Project Catalog, Identity, Intelligence, Network e Native adapters.
Não apagar infraestrutura de rede por causa do app Rede (comunidades/mensagens);
não mover os engines, grants ou políticas do host junto com a UI Internet.

## Boundary

Apps não importam `system/surface/` ou adapters concretos como dependências
privadas; os contratos e a composição do host injetam capacidades. Não criar
`apps-web`, `apps-mobile`, `apps-desktop` ou catálogos de instalação
paralelos. `system/services/apps/delivery-policy.mjs` descreve elegibilidade;
inventário `current` verificado no Native é a evidência de instalação.

Consulte também
[`docs/APP-PORTFOLIO-AND-PREINSTALL.md`](../../docs/APP-PORTFOLIO-AND-PREINSTALL.md),
[`docs/contracts/module-boundaries.json`](../../docs/contracts/module-boundaries.json)
e o portfólio `ordaxsystems/ordax-apps/docs/PORTFOLIO-FIRST-PARTY.md`.
