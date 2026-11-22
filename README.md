# OrdaX OS

Repositório oficial e canônico do sistema operacional OrdaX em `ordaxsystems/ordax-os`. A `main` é a autoridade do código; os limites entre OS, Apps, Runtime e Platform seguem `docs/contracts/repository-ownership.json`.

> **Status do repositório:** oficial, com migração concluída conforme `docs/contracts/repository-migration-status.json`.
>
> **Status do produto:** MVP em desenvolvimento/homologação. Uma release pública Stable/MVP, a aprovação de assinatura e a gravação física de USB/HD/SSD **não são autorizadas** pela promoção do repositório. Consulte `MVP.md` e `docs/PROMOTION-GATES.md` para os gates independentes.
>
> `washingtonmsdj/novo-ordax-os` permanece referência histórica, não uma segunda fonte de verdade ou destino de publicação.

**Acesso rápido:** [por onde começar](#leia-primeiro) · [documentação por assunto](docs/README.md) · [estado comprovado](docs/CURRENT-STATE.md) · [owner de cada repositório](docs/REPOSITORY-OWNERSHIP.md) · [planos classificados](00-PLANOS-PRIORITARIOS/REGISTRY.md).

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

A consolidação estrutural está registrada em [`URGENTE-CONSOLIDACAO-ORDAX.md`](URGENTE-CONSOLIDACAO-ORDAX.md). Para localizar planos ativos, adiados ou históricos, consulte o [registro único de planos](00-PLANOS-PRIORITARIOS/REGISTRY.md) e, quando necessário, o [roteiro de planejamento](00-PLANOS-PRIORITARIOS/ROADMAP.md). Os snapshots Git dos planos retirados da árvore ativa permanecem vinculados no registro, sem reproduzir o arquivo histórico nesta entrada.

Planos não definem estado nem autorizam implementação por si: prevalecem código, contratos, [estado atual](docs/CURRENT-STATE.md), [MVP](MVP.md) e [índice canônico de documentação](docs/README.md). Não criar planos `v2`, `final` ou `novo` para responsabilidades já existentes.

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

- `ordax-os/main` e a source authority **do código/contratos/composição pertencentes ao OS**; Creator, Desktop, Site e Surface pertencem ao OS; Runtime e Platform permanecem independentes conforme `docs/contracts/repository-ownership.json`.
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

Não existe leitura obrigatória dos 19 documentos para cada alteração. Comece pelo menor conjunto aplicável:

1. [`AGENTS.md`](AGENTS.md) — regras de trabalho e segurança; identifique o **owner** e o contrato afetado.
2. [`docs/README.md`](docs/README.md) — índice canônico por responsabilidade; abra apenas os documentos do domínio envolvido.
3. [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md) e [`MVP.md`](MVP.md) — consulte para decisões dependentes do estado comprovado, da entrega ou dos gates de lançamento.

Para mudanças entre repositórios, use [`docs/REPOSITORY-OWNERSHIP.md`](docs/REPOSITORY-OWNERSHIP.md) e [`docs/contracts/repository-ownership.json`](docs/contracts/repository-ownership.json). Para planejar, use [`00-PLANOS-PRIORITARIOS/REGISTRY.md`](00-PLANOS-PRIORITARIOS/REGISTRY.md); para consolidar estruturas, use [`URGENTE-CONSOLIDACAO-ORDAX.md`](URGENTE-CONSOLIDACAO-ORDAX.md). Nenhum destes roteadores substitui código, contratos, estado ou gates.

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
  desktop/                 # host Electron/NSIS Windows, mesma main/composição OS
  tools/                   # producers/verifiers do OS
  docs/contracts/          # ownership, locks, distribuição e trust
  tests/

owners externos consumidos por contrato/artefato:
  ordax-surface            # UI visual
  ordax-apps               # apps removíveis + Forge/Studio
  ordax-intelligence       # source portátil de Intelligence
  creator/                 # Creator Core/UI/media consumer no mesmo commit OS
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

O Creator é um módulo único do OS, separado funcionalmente do Desktop:

```text
ordax-os
 -> produz/autoriza candidato de mídia verificável
 -> creator/ (mesmo commit do OS)
    -> verifica artefato/proveniência
    -> confirma target removível
    -> grava + readback
 -> USB OrdaX verificado
```

O módulo `desktop/` pode apresentar ou lançar essa experiência, mas não mantém um segundo Creator Core nem autoridade genérica de raw disk. O Creator não compila kernel no Windows; consome artefatos já gerados e verificados pelos producers do OS.

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
