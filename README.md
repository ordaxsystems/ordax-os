# OrdaX OS

Repositório oficial e canônico do sistema operacional OrdaX em `ordaxsystems/ordax-os`. A `main` é a autoridade do código; os limites entre OS, Apps, Runtime e Platform seguem `docs/contracts/repository-ownership.json`.

> **Status do repositório:** oficial, com migração concluída conforme `docs/contracts/repository-migration-status.json`.
>
> **Status do produto:** MVP em desenvolvimento/homologação. Uma release pública Stable/MVP, a aprovação de assinatura e a gravação física de USB/HD/SSD **não são autorizadas** pela promoção do repositório. Consulte `MVP.md` e `docs/PROMOTION-GATES.md` para os gates independentes.
>
> `washingtonmsdj/novo-ordax-os` permanece referência histórica, não uma segunda fonte de verdade ou destino de publicação.

## Integração dos repositórios

O OrdaX é um produto modular, não um conjunto de forks. Cada repositório possui uma responsabilidade; a composição Native é feita no `ordax-os` por contratos, locks e artefatos verificados. Consumidores não repetem pins transitivos: o Desktop consome uma composição OrdaX/OS, o Creator consome mídia verificada, a Surface consome ports e Apps publica componentes/catálogo.

A regra operacional completa está em [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md#integração-multi-repositório--composição-do-produto-2026-11-13) e a decisão em ADR-031 de [docs/DECISIONS.md](docs/DECISIONS.md). Owners independentes avançam em paralelo e só sincronizam quando uma nova revisão/artefato realmente precisa ser adotada.

## MVP e canais de produto

O alvo de lançamento, a divisão **Owner/Development vs Stable/MVP**, o modelo de atualização sem Git para usuário final e os gates mínimos de produto estão documentados em [MVP.md](MVP.md). Leia esse arquivo antes de trabalhar em pendrive público, Creator, releases, site, conta ou lançamento.

A candidata Stable atualmente habilitada continua USB-only para uso físico; o ciclo de desenvolvimento/homologação pode abranger capacidades Native conforme `MVP.md` e seus owners, sem transformar isso em autorização para instalar ou escrever em SSD/NVMe/HD.

## Continuidade do Intelligence entre OS, Web e aplicativos

Para trabalho em **OrdaX Intelligence**, comece por `docs/INTELLIGENCE.md`, `docs/CURRENT-STATE.md`, contracts e `docs/contracts/repository-ownership.json`. Para provenance dos checkpoints antigos de ChatGPT/plugin MCP, use o [snapshot histórico](https://github.com/ordaxsystems/ordax-os/blob/d4027cd6d4c2458b735946767043d6ba49526dad/INTELLIGENCE-HANDOFF.md); ele não é roteiro operacional. O chat dentro do Web e o conector usado no ChatGPT externo continuam fluxos distintos; source experimental não confirma disponibilidade real.

**Capability Fabric v1 já integrado:** para descobrir exatamente o que a Aura/Personal já consomem, como a Store `CURRENT` invalida ações e por que isso não autoriza ferramentas MCP, consultar [docs/CAPABILITY-FABRIC.md](docs/CAPABILITY-FABRIC.md) antes de iniciar qualquer nova implementação. O estado atual e as pendências de UX/Runtime/Platform são separados no mesmo guia.

## Planejamento e referências históricas

**Consolidação estrutural em execução:** [`URGENTE-CONSOLIDACAO-ORDAX.md`](URGENTE-CONSOLIDACAO-ORDAX.md) acompanha a simplificação de documentação, workflows e duplicações comprovadas. É um roteiro de execução, não outra fonte de verdade; o índice canônico de documentação continua em [`docs/README.md`](docs/README.md).

O roteador de planejamento fica em [`00-PLANOS-PRIORITARIOS/`](00-PLANOS-PRIORITARIOS/README.md). Antes de interpretar ou retomar qualquer `PLANO-*`, consulte também:

1. [`00-PLANOS-PRIORITARIOS/ROADMAP.md`](00-PLANOS-PRIORITARIOS/ROADMAP.md);
2. [`00-PLANOS-PRIORITARIOS/REGISTRY.md`](00-PLANOS-PRIORITARIOS/REGISTRY.md).

Prioridades operacionais não são fixadas neste README. Consulte `MVP.md`, `docs/CURRENT-STATE.md`, PRs/branches atuais e os owners canônicos antes de retomar trabalho. Texto datado em planos, handoffs ou evidências é contexto histórico; não cria fila global nem bloqueia owners independentes. `READY` documental não significa `EXECUTION-ELIGIBLE`.

Os planos ainda presentes na raiz são referências de escopo futuro, não autoridades de implementação. Planos históricos já retirados da árvore ativa continuam acessíveis pelos snapshots do Git e classificados em `00-PLANOS-PRIORITARIOS/REGISTRY.md`. Todos permanecem subordinados a `docs/README.md`, `docs/CURRENT-STATE.md`, `MVP.md`, contratos, ADRs e owners canônicos.

- A antiga referência funcional acumulada de Surface/apps foi retirada da árvore ativa e permanece no [snapshot Git histórico](https://github.com/ordaxsystems/ordax-os/blob/3f304b05af33e40658025ff289523560b298153c/PLANO-FUNCIONAL-SURFACE-E-APPS.md); owners atuais estão em `ordax-surface`, `ordax-apps`, contratos e `docs/CURRENT-STATE.md`.
- [`docs/SOURCE-MIGRATION.md`](docs/SOURCE-MIGRATION.md) é o ledger canônico de decisões de migração/reimplementação; a análise comparativa antiga foi retirada da árvore ativa e permanece no histórico Git.
- O antigo baseline pré-USB foi retirado da árvore ativa e permanece no [snapshot Git](https://github.com/ordaxsystems/ordax-os/blob/0f8749e8ccfa004628fec2dd59c5218aba331de2/PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md); gates vivos estão em `docs/PROMOTION-GATES.md`, contratos e owners canônicos.
- [docs/SPACES-AND-PROFILES.md](docs/SPACES-AND-PROFILES.md) é a autoridade única de experiência de Spaces e composição profissional; [docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md](docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md) governa conhecimento e Intelligence dos Profiles. O plano duplicado foi retirado do source após migrar seus consumidores.
- [PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md](PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md) preserva fases futuras; o owner canônico é [`docs/PERSONAL-ORDAX.md`](docs/PERSONAL-ORDAX.md).
- [PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md](PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md) é referência de produto; qualquer texto histórico de “canônico” não altera a hierarquia documental.

Não criar `v2`, `final`, `novo` ou outro plano paralelo para a mesma responsabilidade. Atualize o owner existente ou registre uma decisão arquitetural.

## Um produto, modos evolutivos

**Família oficial de nomes:** OrdaX Web (navegador), OrdaX Mobile (Android/iOS, com layout para tablet), OrdaX Desktop (aplicativo para PC) e **OrdaX OS** (variantes USB e Nativo). OrdaX Studio é aplicativo, não uma sexta edição. O owner executável de nomes e versões por modo é [`system/contracts/product-family.mjs`](system/contracts/product-family.mjs); a política de disponibilidade e releases continua separada em seus contratos próprios. Não atribuir a clientes ainda não publicados uma versão imaginária.

A arquitetura continua preparada para Web, Mobile, Desktop, USB e Native sem forks de produto.

```text
MVP físico habilitado atualmente -> OrdaX USB
Ciclo de integração/homologação -> pode incluir capacidades Native conforme owners canônicos
Outros modos                   -> conforme disponibilidade/release autorizada
```

Instalação Native e escrita destrutiva em disco interno continuam dependentes de seus próprios contratos, homologação física, recovery e autorização. Documentação, UI ou uma capacidade implementada não promovem esse caminho por conta própria.

## Site publico

O site público pertence exclusivamente a [`ordaxsystems/ordax-site`](https://github.com/ordaxsystems/ordax-site), com landing, catálogo visual de downloads, login/cadastro, Conta e páginas legais. A revisão consumida pelo OS em **Dev** é fixada por `docs/contracts/public-site-source.json`; builds OS/Vercel verificam o source independente e não mantêm cópias em `sites/public/`. O OS conserva gateway de Identity, autorizações e publicação de releases. OrdaX Web é outro produto e consome apenas a apresentação de login necessária do bundle verificado. Esta migração não autoriza release pública ou Stable.

Enquanto identidade e catalogo de releases nao estiverem configurados, essas integracoes falham fechado e mostram estado indisponivel sem formularios ou downloads ficticios. Ver `docs/PUBLIC-SITE.md` e `docs/contracts/public-site.json`.

## Ownership dos repositórios

A divisão canônica entre **sistema, apps, runtime e infraestrutura remota** está em [docs/REPOSITORY-OWNERSHIP.md](docs/REPOSITORY-OWNERSHIP.md). Esse documento e o contrato `docs/contracts/repository-ownership.json` são a fonte única para decidir onde uma responsabilidade deve viver. Antes de mover código entre repositórios, criar novos serviços, connectors ou adapters, valide esse ownership.

## Principios

- `ordax-os/main` e a source authority **do código/contratos/composição pertencentes ao OS**; Surface, Apps, Desktop, Creator, Intelligence, Runtime, Platform e Site mantêm suas próprias autoridades de source conforme `docs/contracts/repository-ownership.json`.
- Pendrive/notebook sao alvos materializados.
- Codex e parceiro opcional, nunca requisito de source/build/release/instalacao.
- Builds nascem de receitas versionadas + CI + provenance/hash.
- Kernel e initramfs sao artefatos normais do pipeline canonico.
- O seed bootstrap e o USB fisico final preparado sao artefatos diferentes; use os contratos e `docs/CURRENT-STATE.md` para a geometria corrente.
- No estado corrente, o seed possui `ORDAX-ESP + ORDAX` e o USB preparado pelo Creator possui `ORDAX-ESP + ORDAX + ORDAX-DATA`.
- HOME e estado de usuario sao logicos; nao reintroduzir `ORDAX-HOME` como particao separada.
- O primeiro USB e minimo: boot + kernel/initramfs + rede + aquisicao/verificacao de release + recovery.
- SSH, Remote Core e Control Plane nao sao requisitos do bootstrap nem do desenvolvimento diario.
- WSL, QEMU e toolchains locais nao sao requisitos do usuario final.
- Nada do repositorio antigo entra por copia em massa.
- Segredos/chaves privadas nunca sao versionados.
- Criptografia caseira e proibida.
- Escrita fisica exige gates, hashes, identidade de target e autorizacao explicita.

## Leia primeiro

1. `AGENTS.md`
2. `MVP.md`
3. `docs/README.md`
4. `docs/CURRENT-STATE.md`
5. `docs/ARCHITECTURE.md`
6. `docs/BUILD-AUTONOMY.md`
7. `docs/PRODUCT-MODES.md`
8. `docs/ACCOUNT-SYNC-AND-PLANS.md`
9. `docs/MINIMAL-USB-BOOTSTRAP.md`
10. `docs/CREATOR-INSTALLATION.md`
11. `docs/HOST-INDEPENDENCE.md`
12. `docs/REMOTE-CONTROL.md`
13. `docs/PHYSICAL-MEDIA.md`
14. `docs/DEVELOPMENT-WORKFLOW.md`
15. `docs/RELEASE-CHANNEL.md`
16. `docs/SOURCE-MIGRATION.md`
17. `docs/PROMOTION-GATES.md`
18. `docs/DECISIONS.md`
19. `00-PLANOS-PRIORITARIOS/README.md` quando a intenção for planejar/retomar trabalho futuro

## Estrutura principal e owners externos

```text
ordaxsystems/ordax-os
  boot/ + bootstrap/       # boot, kernel/base, acquisition, recovery
  system/
    contracts/             # contratos públicos/sistêmicos
    surface/               # host/runtime Native; visual source é externo
    apps/                  # catálogos/projeções/integração, não app source
    services/              # serviços/lifecycle do OS
    adapters/              # capability boundaries
    composition/           # composição verificada
  tools/                   # producers/verifiers do OS
  docs/contracts/          # ownership, locks, distribuição e trust
  tests/

owners externos consumidos por contrato/artefato:
  ordax-surface            # UI visual
  ordax-apps               # apps removíveis + Forge/Studio
  ordax-intelligence       # source portátil de Intelligence
  ordax-desktop            # host/packaging Windows
  ordax-creator            # Creator Core/UI/media consumer
  ordax-runtime            # Runtime/Device Host local
  ordax-platform           # Control Plane/Product MCP/grants remotos
  ordax-site               # apresentação/distribuição pública
```

Esta árvore é de **ownership/composição**, não uma exigência de checkout monorepo. Paths externos podem aparecer materializados no staging/release sem mudar de owner.
## Build autonomo

```text
alteração no owner correto
 -> integrar/testar proporcionalmente naquele repo
 -> produzir source/artefato verificável
 -> consumidor direto adota revisão apenas quando necessário
 -> composição CI resolve pins/locks exatos
 -> build apenas do impacto causal
 -> provenance + SHA-256
 -> artefato/candidato/release
```

O objetivo é que ChatGPT, outra IA ou qualquer desenvolvedor mantenha cada componente pelo seu owner/pipeline canônico sem depender de Codex e sem reconstruir dependências transitivas por rotina.

## Pendrive inicial

O bootstrap seed e a midia final preparada nao devem ser confundidos. A geometria exata deve sempre ser lida dos contratos atuais.

```text
USB minimo
 -> UEFI
 -> kernel/initramfs
 -> /ordax/bootstrap/entrypoint
 -> se current conhecido existe: boot offline
 -> senao: rede minima
 -> release HTTPS assinada
 -> verificar
 -> releases/<commit>
 -> current
 -> OrdaX completa
```

## Instalação sem Codex

O Creator é um **produto/owner independente**, não um Core a ser absorvido pelo Desktop:

```text
ordax-os
 -> produz/autoriza candidato de mídia verificável
 -> ordax-creator
    -> verifica artefato/proveniência
    -> confirma target removível
    -> grava + readback
 -> USB OrdaX verificado
```

`ordax-desktop` pode apresentar ou lançar essa experiência, mas não mantém um segundo Creator Core nem autoridade genérica de raw disk. O Creator não compila kernel no Windows; consome artefatos já gerados e verificados pelos producers do OS.

Estado atual deve ser lido de `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md` e contratos correspondentes; este README não replica flags de autorização física para evitar drift.
## Desenvolvimento

```text
editar no owner correto
 -> validar proporcionalmente
 -> integrar na main daquele owner
 -> produzir revisão/artefato
 -> continuar sem tocar consumidores compatíveis

quando um produto/canal precisar da mudança:
 -> consumidor direto adota revisão exata
 -> composição verifica contratos/proveniência
 -> somente os gates causais são executados
 -> destino recebe candidato verificado
```

Uma mudança de Surface não deve reconstruir kernel nem abrir PR Desktop/Creator por bookkeeping. Uma mudança de kernel não deve reconstruir Surface sem dependência real. Um app/Forge compatível pode avançar no `ordax-apps` sem alterar o OS até existir adoção real.

## Promocao

Promoção não é inferida de plano, README, build verde ou artefato existente. Os critérios vivos são exclusivamente os owners canônicos, contratos e evidências exigidas por eles.

O caminho esperado continua incluindo, conforme o modo e gate aplicável:

```text
source/build reproduzivel
 -> Creator seguro
 -> mídia conforme contrato corrente
 -> UEFI/boot
 -> rede quando necessária
 -> aquisicao/verificacao de release
 -> known-good/rollback
 -> Surface compartilhada
 -> evidência física quando exigida
```

Até que cada gate seja promovido pelo owner correto, capacidades históricas ou futuras permanecem referência, não autorização.
