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
   concorrência `ordax-surface-producer-<pr-number-or-ref>`. Um constrói/pública o
   artefato verificado; o segundo só começa após terminar e pode reutilizar
   o mesmo resultado. Não cancelar o produtor que já está compilando.
2. Ordem canônica: cache GitHub de **artefato completo por fingerprint**,
   armazenamento R2 **imutável** por fingerprint + SHA-256, e apenas após ambos
   não terem o artefato, compilação Buildroot. O único transporte R2 é
   `tools/ci/independent_surface_r2.sh` com `restore` e `publish`.
   Credenciais vêm exclusivamente dos Secrets; a ausência de credenciais
   utiliza o fallback GitHub/cache/build sem afirmar R2 verificado.
3. Ambos os jobs operam em `$RUNNER_TEMP/ordax-independent-surface`.
   Após construir, restaura-se o `ordax_surface_defconfig` original, emite-se
   o manifesto com `record`, verifica-se fingerprint, SHA-256, proveniência
   e commit corrente com `verify` **antes** de publicar qualquer arquivo.
   No Creator, a cópia para `owner-dev-surface-runtime` acontece depois da
   verificação, e seu próprio `build.py verify` é reexecutado.
4. `ccache` é cache **de objetos**, distinto do cache de artefato. Ambos os
   jobs podem recuperar objetos de uma chave anterior do mesmo OS/arquitetura
   com `restore-keys` quando o `defconfig` muda; o compilador/ccache
   valida flags/dependências em cada objeto. **Nunca** relaxar a chave exata
   do EROFS nem substituir provas por hits de cache. Para evitar perder seis
   horas de objetos compilados, a chave primária do `ccache` contém o ID da
   execução; o `restore-keys` restaura o checkpoint mais recente do mesmo
   perfil, mantendo compatibilidade com o cache v1. Cada execução pode gravar
   um novo checkpoint imutável após um build interrompido com encerramento
   correto dos compiladores. O artefato EROFS final **não** usa run ID.
5. O QEMU Portable não compila Surface: busca o **mesmo** artefato imutável
   pelo fingerprint canônico no cache GitHub ou R2, verifica manifesto,
   SHA-256, proveniência e ABI com `independent_surface_component_cache.py` e
   `bootstrap/surface-runtime/build.py verify`, e então copia os bytes já
   validados para o slot QEMU. Um miss em ambos os armazenamentos **falha
   imediatamente e sem compilação**; a ação correta é executar o produtor
   independente/Creator, não criar outro produtor. O modo
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

Os dois workflows declaram cache/R2 hit ou miss, origem do EROFS e recibos de
validação; o pacote Owner deve conservar proveniência e SHA-256 da imagem
original mesmo quando integra um novo commit de OS. A causa de compilação dupla
observada antes desta correção era: o Creator verificava o artefato restaurado,
mas compilava num diretório separado quando havia *miss* e não gravava a imagem
no cache comum nem no R2. O produtor independente também podia iniciar uma
compilação simultânea; além disso, a chave exata do `ccache` impedia recuperar
objetos válidos após mudar o `defconfig`. Este contrato corrige as três falhas.

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
