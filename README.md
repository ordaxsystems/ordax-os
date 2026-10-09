# OrdaX OS

Repositório oficial e canônico do sistema operacional OrdaX em `ordaxsystems/ordax-os`. A `main` é a autoridade do código; os limites entre OS, Apps, Runtime e Platform seguem `docs/contracts/repository-ownership.json`.

> **Status do repositório:** oficial, com migração concluída conforme `docs/contracts/repository-migration-status.json`.
>
> **Status do produto:** MVP em desenvolvimento/homologação. Uma release pública Stable/MVP, a aprovação de assinatura e a gravação física de USB/HD/SSD **não são autorizadas** pela promoção do repositório. Consulte `MVP.md` e `docs/PROMOTION-GATES.md` para os gates independentes.
>
> `washingtonmsdj/novo-ordax-os` permanece referência histórica, não uma segunda fonte de verdade ou destino de publicação.

## MVP e canais de produto

O alvo de lançamento, a divisão **Owner/Development vs Stable/MVP**, o modelo de atualização sem Git para usuário final e os gates mínimos de produto estão documentados em [MVP.md](MVP.md). Leia esse arquivo antes de trabalhar em pendrive público, Creator, releases, site, conta ou lançamento.

## Plano funcional da interface

O [PLANO-FUNCIONAL-SURFACE-E-APPS.md](PLANO-FUNCIONAL-SURFACE-E-APPS.md), na raiz, detalha a area de trabalho e os apps **Arquivos, Ajustes, Conta e Sistema**: cada subsecao, conteudo, comportamento, recursos existentes, lacunas e ordem de implementacao. IAs e desenvolvedores devem le-lo junto das instrucoes de `AGENTS.md` antes de trabalhar nessas interfaces. O plano e uma proposta; revalide seu inventario contra a `main` atual e preserve os contratos canonicos.

A continuacao [PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md](PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md) compara o prototipo com `novo-ordax-os`: o que ja existe, o que falta recuperar e quais ideias merecem evoluir. Inclui 27 capacidades, fontes fixadas por commit, orientacoes por tela, prioridades, dependencias, criterios de aceite e prompts para implementacao. Leia as duas partes; o legado continua sendo referencia, sem copia automatica de codigo ou arquitetura.

O desenho de **Profiles profissionais leves no USB, com payload sob demanda, uso offline após instalação e evolução por atualização** está congelado em [PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md](PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md). Esse plano reimplementa os invariantes úteis do RFC-0009 do `novo-ordax-os` sobre a arquitetura atual, sem carregar todos os perfis na imagem inicial.

O novo **Personal OrdaX**, camada owner-bound de Work, Activity e Result que evolui o sistema sem duplicar identidade, Memory, Projects, Intelligence ou permissões, tem seu ponto de entrada de implementação em [PERSONAL-ORDAX.md](PERSONAL-ORDAX.md). Esse documento deve ser lido antes de criar agentes, background work, Activity ou automações pessoais.

O plano consolidado de evolução dessa camada está em [PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md](PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md). Ele transforma as conclusões dos relatórios já produzidos em ordem de implementação: foreground seguro, propostas sem autoridade, continuidade durável, background bounded, conectores, workers especialistas e execução híbrida.

## Um produto, modos evolutivos

A arquitetura continua preparada para Web, Mobile, Desktop, USB e Native sem forks de produto.

```text
MVP público        -> OrdaX USB
Em breve           -> Web / Mobile / sincronização
Futuro             -> experiência Desktop ampliada
Pós-MVP            -> OrdaX Native (SSD/NVMe/HD)
```

O primeiro candidato Stable executa pelo pendrive e ainda não oferece instalação em disco interno. **O escopo de integração do MVP foi ampliado** para concluir as capacidades já iniciadas, incluindo instalação Native em SSD/NVMe/HD no mesmo Creator Core, sem liberar gravação física até instalação, boot, recovery e proteção do alvo serem homologados. Os modos preservam identidade, Surface/app source e adapters de capacidade compartilhados.

## Site publico

O portal publico fica em `sites/public/` e e um artefato separado do **OrdaX Web**. O portal apresenta o produto, hospeda a entrada de login/cadastro e lista downloads somente a partir de um catalogo de releases publicas autorizado. Ele nao importa a Surface, nao cria uma segunda identidade e nao inventa releases.

```text
sites/public/
 -> landing page
 -> download
 -> login
 -> cadastro
```

Enquanto identidade e catalogo de releases nao estiverem configurados, essas integracoes falham fechado e mostram estado indisponivel sem formularios ou downloads ficticios. Ver `docs/PUBLIC-SITE.md` e `docs/contracts/public-site.json`.


## Ownership dos repositórios

A divisão canônica entre **sistema, apps, runtime e infraestrutura remota** está em [docs/REPOSITORY-OWNERSHIP.md](docs/REPOSITORY-OWNERSHIP.md). Esse documento e o contrato `docs/contracts/repository-ownership.json` são a fonte única para decidir onde uma responsabilidade deve viver. Antes de mover código entre repositórios, criar novos serviços, connectors ou adapters, valide esse ownership.

## Principios

- `main` e a source authority.
- Pendrive/notebook sao alvos materializados.
- Codex e parceiro opcional, nunca requisito de source/build/release/instalacao.
- Builds nascem de receitas versionadas + CI + provenance/hash.
- Kernel e initramfs sao artefatos normais do pipeline canonico.
- Layout fisico: exatamente `ORDAX-ESP` + `ORDAX`.
- HOME e estado de usuario sao logicos, nao uma terceira particao.
- O primeiro USB e minimo: boot + kernel/initramfs + rede + aquisicao/verificacao de release + recovery.
- SSH, Remote Core e Control Plane nao sao requisitos do bootstrap nem do desenvolvimento diario.
- WSL, QEMU e toolchains locais nao sao requisitos do usuario final.
- Nada do repositorio antigo entra por copia em massa.
- Segredos/chaves privadas nunca sao versionados.
- Criptografia caseira e proibida.
- Escrita fisica exige gates, hashes, identidade de target e autorizacao explicita.

## Leia primeiro

1. `AGENTS.md`
2. `docs/CURRENT-STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/BUILD-AUTONOMY.md`
5. `docs/PRODUCT-MODES.md`
6. `docs/ACCOUNT-SYNC-AND-PLANS.md`
7. `docs/MINIMAL-USB-BOOTSTRAP.md`
8. `docs/CREATOR-INSTALLATION.md`
9. `docs/HOST-INDEPENDENCE.md`
10. `docs/REMOTE-CONTROL.md`
11. `docs/PHYSICAL-MEDIA.md`
12. `docs/DEVELOPMENT-WORKFLOW.md`
13. `docs/RELEASE-CHANNEL.md`
14. `docs/SOURCE-MIGRATION.md`
15. `docs/PROMOTION-GATES.md`
16. `docs/DECISIONS.md`

## Estrutura principal

```text
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
  public-site/
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

Estado atual:

```text
Creator CHECK=IMPLEMENTED
Creator PLAN=FAIL_CLOSED_ENQUANTO_MANIFESTO_NAO_AUTORIZADO
Creator NATIVE_RAW_BACKEND=IMPLEMENTED_PHYSICAL_TEST_ONLY
Creator PHYSICAL_TEST_APPLY=IMPLEMENTED_READBACK_VERIFIED
Creator PUBLIC_APPLY=BLOCKED
PUBLIC_PHYSICAL_USB_WRITE=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```

O backend Win32 de escrita RAW e o writer Portable interno ja existem para prova controlada, com revalidacao do alvo, UAC e readback por artefato. Isso **nao** equivale a disponibilizar `apply` no Creator publico: o trust público canônico já está pinado, mas a promoção física permanece bloqueada até o `canonical-v4-release-proof.json` real ser produzido/vinculado e uma nova autorização explícita ser emitida para o contexto atual de 17 artefatos / 39 operações.

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

## Promocao

O sucessor oficial precisa provar no hardware real:

```text
source/build sem Codex
 -> kernel/initramfs reproduziveis
 -> Creator seguro
 -> duas particoes exatas
 -> UEFI
 -> rede
 -> aquisicao/verificacao de release
 -> current conhecido-bom
 -> boot offline
 -> Surface compartilhada
 -> atualizacao Git-driven
 -> continuidade Web/Mobile/Desktop/USB/Native
```

Ate la, `novo-ordax-os` permanece somente como referencia/evidencia.
