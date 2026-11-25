# CI — contrato canônico de compilação/reutilização da Surface

**Autoridade:** `bootstrap/surface-runtime` produz os mesmos bytes EROFS
verificados consumidos pelo **Creator Owner/Development** e pela prova da
**Independent Surface**. A identidade é computada uma única vez pelo módulo
`tools/ci/independent_surface_component_cache.py`, a partir das entradas
Buildroot, kernel, arquivo de configuração original e ambiente. Atualizações de
documentação/UI que não alteram essas entradas **não** invalidam o artefato.

## Contrato obrigatório

1. O job `build-and-publish` de `creator-owner-dev-git.yml` e o
   `buildroot-surface` de `independent-surface-runtime.yml` partilham a
   concorrência `ordax-surface-producer-<pr-number-or-ref>`. O job
   `buildroot-surface` é o único produtor e publicador da EROFS verificada.
   O Creator pode reutilizar esse resultado para materializar a mídia.
2. Ordem canônica: cache GitHub de **artefato completo por fingerprint**,
   armazenamento R2 **imutável** por fingerprint + SHA-256 e artefato de uma
   execução canônica do produtor. Só o produtor compila após falha de reúso.
   O transporte R2 usa `tools/ci/independent_surface_r2.sh`. Sem credenciais
   R2, o cache e os artefatos do GitHub continuam disponíveis.
3. Ambos os jobs operam em `$RUNNER_TEMP/ordax-independent-surface`.
   Após construir, restaura-se o `ordax_surface_defconfig` original, emite-se
   o manifesto com `record`, verifica-se fingerprint, SHA-256, proveniência
   e commit corrente com `verify` **antes** de publicar qualquer arquivo.
   O Creator verifica o resultado restaurado na própria pasta e o fornece
   diretamente à montagem da mídia. A cópia gravada na mídia continua
   verificada pelo montador, inclusive quando o commit de integração é outro.
4. `ccache` é cache **de objetos**, distinto do cache de artefato. O produtor
   pode recuperar objetos de uma chave anterior do mesmo OS/arquitetura
   com `restore-keys` quando o `defconfig` muda; o compilador/ccache
   valida flags/dependências em cada objeto. **Nunca** relaxar a chave exata
   do EROFS nem substituir provas por hits de cache. Para evitar perder seis
   horas de objetos compilados, a chave primária do `ccache` contém o ID da
   execução e o número da tentativa (`run_id` + `run_attempt`); o `restore-keys` restaura o checkpoint mais recente do mesmo
   perfil, mantendo compatibilidade com o cache v1. Cada tentativa pode gravar
   um novo checkpoint imutável após um build interrompido com encerramento
   correto dos compiladores. O artefato EROFS final **não** usa run ID.
5. O QEMU Portable não compila Surface: busca o **mesmo** artefato imutável
   pelo fingerprint canônico no cache GitHub, no R2 ou no artefato do produtor,
   verifica manifesto,
   SHA-256, proveniência e ABI com `independent_surface_component_cache.py` e
   `bootstrap/surface-runtime/build.py verify`, e então copia os bytes já
   validados para o slot QEMU. Se todas as fontes estiverem indisponíveis,
   o job termina antes da montagem. O modo
   `surface_source=independent` continua consumindo o artefato validado
   no mesmo workflow, sem build.
6. O Owner exige sempre a prova de dois boots gráficos *offline* do mesmo
   USB RAW no QEMU, heartbeat Native, WebKit, framebuffer, ACPI, ext4 íntegro
   e rollback. Reutilização evita recompilação; **não** evita boot/QEMU.
   O QEMU não comprova boas-vindas reais nem boot físico no notebook.
7. Alterações deste contrato devem executar
   `tests/test_owner_surface_cache_contract.py` e
   `tests/test_independent_surface_component_cache.py`, além dos gates
   já existentes; não criar outro cache SSOT nem armazenar manifestos mutáveis.

## Evidência e diagnóstico

Os workflows registram a origem da EROFS e os recibos de validação. O pacote
Owner conserva a proveniência e o SHA-256 originais mesmo quando integra
um novo commit do OS. Quando as imagens Ubuntu do produtor e do consumidor
diferem, o artefato do GitHub usa o fingerprint do produtor gravado no recibo.

**Limite de execução:** a concorrência é por PR/ref, incluindo revisões sucessivas;
a reutilização de bytes entre commits é regida exclusivamente pelo fingerprint. Se GitHub/R2 não
estiverem acessíveis, é possível precisar de uma compilação real; nunca
inventar receipt, reutilizar artefato sem verificar ou declarar build pronto
só pela cache. No primeiro boot de uma imagem ainda não validada, a entrega
física ao pendrive continua bloqueada.

## Regressão de 27/10/2026 — QEMU não é produtor gráfico

Dois jobs QEMU foram cancelados depois de aproximadamente cinco horas, ainda
em `Build exact offline Surface runtime on cache miss`, sem qualquer boot.
A correção torna o QEMU apenas consumidor e remove o fingerprint `surface`
do cache Portable genérico: existe somente o produtor Buildroot acima.
**Sem artefato verificado, o gate fica vermelho antes dos builds de IA,
kernel e Base**, nunca verde
por omissão nem recompilando a mesma Surface por horas.

## Orçamento do produtor persistente — 30/10/2026

No runner GitHub hospedado e descartável, o `make` é limitado a **330 minutos**
dentro do job de 360 minutos. No runner Linux self-hosted confiável, **somente**
quando `ORDAX_SURFACE_RUNNER_LABEL`, `ORDAX_SURFACE_PRODUCER_ENVIRONMENT`
e `ORDAX_SURFACE_PERSISTENT_WORK_ROOT` estão explicitamente configurados,
o `make` no `--work-dir` usa **690 minutos** dentro de um job de 720 minutos.
Ambos reservam 30 minutos para encerramento controlado e verificações.

A mudança de limite **não** substitui a retomada. Um resultado parcial do
WebKit só é aproveitável quando o mesmo diretório `O=` permanece em disco,
o fingerprint nativo e o Kconfig selado conferem, o `flock` é exclusivo e
nenhum manifesto ou artefato incompleto é aceito. Um timeout ou artefato
incompleto não é prova de sucesso.

**GitHub gratuito, repositório público:** sem configuração de produtor
privado, o workflow usa o runner hospedado `ubuntu-24.04`. O cache exato
GitHub, o R2 opcional e o artefato do produtor canônico são consultados
antes de compilar. Um miss permite a compilação no próprio GitHub Actions,
sem exigir runner self-hosted ou variáveis de infraestrutura. O limite físico
de disco/RAM e a duração máxima do runner gratuito continuam reais; se
o build falhar, nenhum EROFS é publicado como válido. Apenas artefatos
com fingerprint, SHA-256, proveniência e verificação aprovados são publicados
e consumidos por Creator e QEMU. Um runner persistente continua opcional.


## Operação de CI: gating e retomada sem duplicar produtores

A política de CI é **implementada nos próprios workflows**, não em um plano de
estágio independente: `.github/workflows/independent-surface-runtime.yml`,
`creator-owner-dev-git.yml` e `independent-base-experiment.yml`. Em PR
`draft`, os contratos leves continuam obrigatórios e as compilações caras
esperam a candidatura, o disparo manual ou o push aplicável. Os três jobs
pesados usam `queue: max` na concorrência comum para não perder uma prova
pendente de outro consumidor da mesma revisão. `ready_for_review` volta a
avaliar o HEAD; nenhum resultado da revisão antiga vale para a nova.

Para recuperar Buildroot de forma **real** no runner persistente, configurar
em conjunto `ORDAX_SURFACE_RUNNER_LABEL`,
`ORDAX_SURFACE_PRODUCER_ENVIRONMENT` (identidade versionada com quatro
segmentos) e `ORDAX_SURFACE_PERSISTENT_WORK_ROOT` (caminho absoluto em
filesystem permanente). O build usa `O=` estável por fingerprint, recibos
de inputs e Kconfig/defconfig e lock exclusivo; uma árvore incompleta,
simbólica ou com identidade divergente falha fechada. Nessa configuração,
`BR2_CCACHE_DIR` e `BR2_DL_DIR` usam respectivamente `ccache/` e
`downloads/` sob a raiz persistente, sem transferir esses caches de vários
GB pelo `actions/cache`. No runner hospedado e descartável, permanecem os
caches normais e não há promessa de retomada do diretório `O=`.

O produtor hospedado calcula o paralelismo por CPU disponível e RAM livre,
reserva 2 GiB e estima 2,5 GiB por compilador; `ORDAX_SURFACE_BUILD_JOBS`
é um teto opcional de 1 a 64. O ccache hospedado cresce de 5 até 8 GiB
somente com folga de disco, reservando 32 GiB para a árvore de build.
O caminho temporário de Buildroot é estável entre tentativas hospedadas,
mas criado exclusivamente e descartado ao final; não é retomada de O=. A identidade do produtor deve ser
consumida sem reetiquetar artefatos antigos, e o EROFS permanece condicionado
a fingerprint, SHA-256, proveniência e validação de QEMU/boot aplicável.
A falha histórica do WebKit por timeout de 27/10 e o detalhamento das
primeiras mudanças draft/Ready ficam no
[snapshot Git da documentação de CI](https://github.com/ordaxsystems/ordax-os/blob/35bc94fa7402a733afdce7a3b086a9e1e0d2d0c7/docs/CI-TWO-STAGE-RELEASE-GATE-SSOT.md);
esse snapshot não define gates atuais.
