# OrdaX OS

Repositório oficial e canônico do sistema operacional OrdaX em `ordaxsystems/ordax-os`. A `main` é a autoridade do código; os limites entre OS, Apps, Runtime e Platform seguem `docs/contracts/repository-ownership.json`.

> **Status do repositório:** oficial, com migração concluída conforme `docs/contracts/repository-migration-status.json`.
>
> **Status do produto:** MVP em desenvolvimento/homologação. Uma release pública Stable/MVP, a aprovação de assinatura e a gravação física de USB/HD/SSD **não são autorizadas** pela promoção do repositório. Consulte `MVP.md` e `docs/PROMOTION-GATES.md` para os gates independentes.
>
> `washingtonmsdj/novo-ordax-os` permanece referência histórica, não uma segunda fonte de verdade ou destino de publicação.

## MVP e canais de produto

O alvo de lançamento, a divisão **Owner/Development vs Stable/MVP**, o modelo de atualização sem Git para usuário final e os gates mínimos de produto estão documentados em [MVP.md](MVP.md). Leia esse arquivo antes de trabalhar em pendrive público, Creator, releases, site, conta ou lançamento.

A candidata Stable atualmente habilitada continua USB-only para uso físico; o ciclo de desenvolvimento/homologação pode abranger capacidades Native conforme `MVP.md` e seus owners, sem transformar isso em autorização para instalar ou escrever em SSD/NVMe/HD.

## Continuidade do Intelligence entre OS, Web e aplicativos

Para continuar a integração **OrdaX Intelligence + ChatGPT opcional + plugin MCP + ações nativas** leia [INTELLIGENCE-HANDOFF.md](INTELLIGENCE-HANDOFF.md) antes de alterar Studio, Surface, router, provider connectors ou Runtime. É guia de coordenação; a autoridade permanece nos contratos de `docs/INTELLIGENCE.md` e `docs/contracts/repository-ownership.json`. O chat dentro do Web e o conector usado no ChatGPT externo são fluxos distintos; source experimental não confirma disponibilidade real.

## Planejamento e referências históricas

O roteador de planejamento fica em [`00-PLANOS-PRIORITARIOS/`](00-PLANOS-PRIORITARIOS/README.md). Antes de interpretar ou retomar qualquer `PLANO-*`, consulte também:

1. [`00-PLANOS-PRIORITARIOS/ROADMAP.md`](00-PLANOS-PRIORITARIOS/ROADMAP.md);
2. [`00-PLANOS-PRIORITARIOS/REGISTRY.md`](00-PLANOS-PRIORITARIOS/REGISTRY.md).

Durante a janela atual, a prioridade é **fechar o MVP pelos owners canônicos**. Planos futuros podem ser documentados, auditados e preservados, mas não formam uma fila automática de implementação. `READY` não significa `EXECUTION-ELIGIBLE`.

Os planos antigos da raiz permanecem temporariamente nos caminhos atuais porque ainda possuem referências vivas. Eles são subordinados a `docs/README.md`, `docs/CURRENT-STATE.md`, `MVP.md`, contratos, ADRs e owners canônicos.

- [PLANO-FUNCIONAL-SURFACE-E-APPS.md](PLANO-FUNCIONAL-SURFACE-E-APPS.md) é referência funcional acumulada da Surface/apps; não é `CURRENT-STATE` nem changelog canônico.
- [PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md](PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md) é análise histórica do legado e não é backlog atual.
- [PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md](PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md) é baseline de auditoria cujo fechamento de source já foi concluído; gates vivos estão nos owners canônicos.
- [docs/SPACES-AND-PROFILES.md](docs/SPACES-AND-PROFILES.md) é a autoridade de experiência de Spaces e composição profissional. [PLANO-06](PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md) é histórico arquivado, não outro fluxo de produto.
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

- `main` e a source authority.
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

## Estrutura principal

```text
00-PLANOS-PRIORITARIOS/
  README.md
  ROADMAP.md
  REGISTRY.md
  inbox/
  plans/
  reports/
  templates/
  archive/
boot/
  esp/
bootstrap/
  kernel/
  initramfs/
  network/
  release-acquisition/
  recovery/
system/
  surface/
  apps/
  services/
  adapters/
    web/
    mobile/
    desktop/
    native/
platform/
  releases/
  state/
  home/
sites/
  public/
tools/
  creator/
    core/
    cmd/ordax-creator/
    platform/
  dev/
  verify/
tests/
docs/
```

## Build autonomo

```text
alteracao em main
 -> receita versionada
 -> CI em ambiente fixado
 -> build apenas do afetado
 -> testes
 -> provenance + SHA-256
 -> artefato/release
```

O objetivo e que ChatGPT, outra IA ou qualquer desenvolvedor mantenha o projeto pelo repositorio e pipeline canonico sem depender de Codex especificamente.

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

## Instalacao sem Codex

O caminho permanente e o Creator como capacidade do OrdaX Desktop:

```text
OrdaX Desktop
 -> Creator Core
 -> adapter/helper Windows estreito
 -> USB OrdaX verificado
```

Para nao bloquear os primeiros testes fisicos esperando o Desktop completo, o CI pode publicar antes um pequeno `ordax-creator.exe`. Ele usa exatamente o mesmo Creator Core e depois desaparece como shell separado quando a interface Desktop assumir a funcao.

O Creator nao compila kernel no Windows. Ele consome artefatos ja gerados e verificados pelo CI.

Estado atual deve ser lido de `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md` e contratos correspondentes; este README não replica flags de autorização física para evitar drift.

## Desenvolvimento

```text
editar
 -> preview Web/HMR
 -> testar
 -> commit/push main
 -> CI gera/verifica o afetado
 -> Web/Mobile/Desktop recebem o commit aplicavel
 -> OrdaX USB/Native recebe release/delta verificado
```

Uma mudança de Surface não deve reconstruir kernel. Uma mudança de kernel não deve reconstruir Surface sem dependência real.

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
