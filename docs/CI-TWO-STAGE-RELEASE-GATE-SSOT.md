# CI OrdaX — duas etapas, sem rebuild por cada commit

## Desenvolvimento (PR como draft)

Alterações na Surface UI, Account, contratos, documentação e automações devem
executar **testes rápidos**. O estado draft é obrigatório durante o desenvolvimento;
os jobs pesados de Creator, Base, Surface EROFS, Native ESP e Portable/QEMU são
ignorados nesse estágio. Os jobs de contrato, análise de impacto, lint, testes
unitários e testes funcionais focados **continuam obrigatórios e falham
normalmente**. O botão `workflow_dispatch` permite a prova pesada voluntária,
com os mesmos contratos e integridade, mesmo com PR draft.

O workflow `creator-owner-dev-git.yml` mantém `owner-dev-contract`
como job leve independente e obrigatório em draft, com o preflight
`tools/ci/preflight_owner_dev.py` e regressões do cache. O job pesado
`build-and-publish` depende de `owner-dev-contract` e é executado apenas
na etapa candidata, em `workflow_dispatch` ou no push aplicável. Assim,
uma PR draft com mudança de boot ou Owner não aparenta estar validada
apenas porque o job monolítico foi ignorado. O preflight roda uma vez,
sem duplicar a mesma bateria no job de build pesado.

O `native-esp-candidate.yml` preserva `native-esp-contract` em draft:
validação do source pin da ESP, contratos de boot/QEMU, regressões de
readiness e `py_compile`, sem compilação de kernel, `docker pull`,
instalação APT nem QEMU. O job `native-esp` mantém toda a prova física
descartável (sem tocar disco do usuário), mas depende da aprovação do
preflight e só roda em candidato/manual/push autorizado.

O `independent-base-experiment.yml` também foi separado em
`independent-base-contract` (checagens de Buildroot, firmware, ABI e
regressões do Owner Development, executadas em draft) e
`buildroot-qemu` (compilação/prova pesada dependente do contrato e da
seleção de perfil validada). O contrato seleciona o perfil exato uma vez e
entrega esse valor como output ao consumidor, que o valida novamente.
Não há uma segunda bateria de testes de contrato dentro do job de
compilação.

Os jobs pesados de `independent-base-experiment.yml`,
`independent-surface-runtime.yml` e `creator-owner-dev-git.yml`
compartilham a chave de concorrência `ordax-surface-producer` derivada
do número da PR (ou da ref em execução manual/main), não do SHA isolado.
Isso conserva um produtor em execução e deixa os consumidores de mesma
entrega em fila, evitando concorrência acidental por um cache ainda frio.
Com `queue: max` (GitHub Actions, disponível desde maio de 2026), a fila
compartilhada conserva até 100 jobs pendentes. Sem essa opção, o GitHub
cancela e substitui o job pendente anterior, **mesmo com**
`cancel-in-progress: false`; Base, Surface e Creator poderiam perder gates
obrigatórios numa mesma candidatura. A fila compartilhada usa `queue: max`
somente no nível dos três jobs pesados; a política de substituir uma
revisão antiga pendente da mesma PR, no nível do workflow, permanece separada.
A serialização não substitui hashes, provenance nem a prova dos boots.

**Não confundir ausência de build na etapa draft com aprovação da imagem.**

## Candidato de entrega (marcar a PR Ready for review)

O evento `ready_for_review` reexecuta os workflows de prova no **HEAD da PR**.
Com mudança de bytes nativos, o produtor canônico compila uma vez e publica
EROFS/USB verificados; consumidores QEMU só podem aceitar artefatos imutáveis
vinculados ao commit/fingerprint certo. Se o artefato já foi construído com as
mesmas entradas, recuperar do cache com verificação é suficiente.

- Mudança exclusiva de UI sem dependência de boot: testes focados, sem compilar
  Mesa/WebKit/Kernel.
- Mudança real de Mesa/Intel, Kernel, initramfs ou produtor nativo: compilação
  do componente modificado + prova QEMU.
- Nova entrega USB/Stable: exigir prova de boot offline, ACPI/rollback e
  artefatos SHA-256 antes da promoção, sem pular gates.

Qualquer novo commit na PR pronta revalida as provas correspondentes ao novo
HEAD. Se ainda haverá muitos commits, **manter draft** até o lote estar
consolidado; não usar ready como sinônimo de progresso diário.

## Identidade de ambiente e cache real do EROFS

Os três consumidores/produtores Surface (Buildroot, Creator USB e Portable/QEMU)
devem calcular exatamente a mesma identidade no **shell do runner**:

```sh
test -n "${ImageOS:-}"
test -n "${ImageVersion:-}"
export ORDAX_COMPONENT_CACHE_ENVIRONMENT="${RUNNER_OS:?}/${RUNNER_ARCH:?}/${ImageOS}/${ImageVersion}"
```

O antigo uso de expressões do GitHub Actions `env.ImageOS` e
`env.ImageVersion` é inválido nessa etapa: as variáveis são injetadas no
shell pelo runner, mas não são declarações do contexto `env`. A expressão
resolvia vazia e gerava `Linux/X64//` no produtor, enquanto QEMU obtinha
`Linux/X64/ubuntu24/<versão>`. Assim, artefatos legítimos eram
invisíveis ao consumidor e a compilação era repetida.

A função canônica `tools/ci/independent_surface_component_cache.py:validated_environment`
agora rejeita formatos CI `Linux/X64//` ou com qualquer segmento de
SO, arquitetura, imagem e versão ausente. Em GitHub Actions, também rejeita
identidades não padronizadas (por exemplo `local-unpinned` ou `test/...`),
impedindo que uma variável não vazia burle a validação dos quatro campos. Essa checagem aplica-se tanto à
identidade nova quanto à do manifesto de um EROFS recuperado; chaves
historicamente incompletas **não** se tornam automaticamente reutilizáveis.
`tests/test_independent_surface_component_cache.py` exercita cinco casos
inválidos e a identidade real completa.

**Artefatos do cache com identidade incompleta não devem ser reetiquetados
para a chave nova sem prova correspondente.** Preserve a build já em
execução e sua prova QEMU de mesmo run; a correção se aplica ao próximo HEAD
da integração, com entradas/fingerprint reais, SHA-256 e receipts intactos.
Não confundir o build anterior com uma comprovação de cache portável.

## Ordem obrigatória: produtor Surface → consumidores QEMU

A condição `Ready for review` **não serializa automaticamente workflows
independentes do GitHub Actions**. Em um cache frio, os dois consumidores
Portable/QEMU acionados diretamente podem chegar à restauração de EROFS
antes do produtor Buildroot. O erro `Verified canonical Surface EROFS
unavailable` é a rejeição correta, não um motivo para substituir o artefato
por um fallback ou pular a prova.

A validação gráfica autoritativa está no próprio
`independent-surface-runtime.yml`: `portable-qemu` usa
`needs: buildroot-surface` e consome via `surface_source: independent`
os bytes publicados pelo produtor da mesma execução. A publicação de cache
exato, SHA-256, provenance, fingerprint e source-commit deve preceder qualquer
nova execução dos demais consumidores. **Não rerodar QEMU em cache miss**;
se houver falha de compilação, corrigir a causa na mesma PR, sem afrouxar
integridade ou atribuir sucesso a checks pulados.

O cache GitHub pode reutilizar o componente quando as entradas imutáveis
continuam iguais, mesmo se o commit de integração só mudou CI/documentação.
O R2 durável é opcional para o fluxo de desenvolvimento, mas ausência de
credenciais no runner significa que não houve publicação durável. Não
confundir cache esperado com artefato verificado. No candidato final,
registrar a dependência produtor-consumidor e exigir os gates completos.

## Falha factual Buildroot de 2026-10-27 e ordem do Creator

- PR #2243 no commit `a0c728c238557fb0a1c0ad7adaa1db3b7b5546c7`,
  Independent Surface run `40453160133`, job `122040672426`:
  `timeout --signal=TERM --kill-after=60s 330m make ... -j4`
  terminou em `124` durante `webkitgtk-2.52.4`, após cerca de
  `7248/8599` unidades Ninja. Não há prova de erro de compilação C++.
- O cache compartilhado de objetos C/C++ foi salvo (arquivo compactado de
  2.252.848.822 bytes), mas o EROFS e seu provenance **não existem** nesse
  run; por consequência, `upload-artifact` falhou por arquivos ausentes.
  Não declarar cache de compilador equivalente a imagem verificada.
- A partir do cutover, **apenas**
  `.github/workflows/independent-surface-runtime.yml` compila
  `bootstrap/surface-runtime/build.py build`. O Creator
  `creator-owner-dev-git.yml` consome o EROFS de cache de conteúdo
  ou R2, vinculado a SHA/fingerprint/receipts, e **falha fechado** se não
  estiver disponível. Nunca fazer Buildroot/WebKit no Creator, em QEMU
  ou num terceiro produtor para contornar timeout.
- A sequência de candidatura deve primeiro executar e validar o produtor
  especializado até EROFS SHA-256/provenance completos; depois executar
  Creator e QEMU com esses mesmos bytes. O compilador pode reutilizar seu
  cache no próximo build, mas esse reaproveitamento não garante conclusão
  até o CI comprovar. Se novo timeout persistir, deve-se fornecer estágio
  reexecutável e verificável para a compilação longa sem relaxar o limite
  de segurança, a verificação de conteúdo ou os gates offline.
- Na observação desta falha, o job `build-and-publish` do Creator
  (run `40453160246`) ainda estava ativo na implementação anterior.
  Não mudar o HEAD da PR enquanto o job anterior realiza a compilação,
  evitando interrupção e descarte do esforço já em curso.

## Fail-fast no Creator Owner

O Creator verifica o EROFS assinado por SHA-256, source/fingerprint e recibo de
proveniência antes de construir kernel, initramfs ou Base Buildroot. Em cache/R2
miss, falha imediatamente, sem montar payload, disparar QEMU, recompilar WebKit
ou aceitar fallback. O produtor independente deve concluir primeiro.
O teste `test_creator_validates_graphical_artifact_before_native_heavy_work`
impede que futuras mudanças voltem a colocar o consumidor depois de builds
nativos caros. Essa ordem não substitui o encadeamento automático entre
workflows, que continua sendo uma melhoria separada.

## Garantias e limites

O workflow independente `independent-portable-v2-integration.yml` também
usa `cancel-in-progress: false`. Antes da alteração, novas revisões de PR
cancelavam automaticamente a prova QEMU ativa; agora a execução em andamento
é preservada, enquanto a revisão pendente mais recente continua vinculada
ao próprio HEAD e deve passar pelos gates de candidato antes da integração.
Isso não transforma um QEMU antigo em prova do HEAD final.


Os filtros por paths do GitHub comparam toda a PR com a base, não somente o
último commit. Por isso, em uma PR abrangente, continuar draft impede disparos
pesados repetidos enquanto contratos rápidos continuam rodando.

A política de estágio não altera os fingerprints, o cache, os próprios
scripts de build, as provas de integridade ou as restrições de gravação
física. Alteração no CI não é autorização para merger sem QEMU. A condição
Ready é um gate de entrega, e o código deve permanecer no branch correto
com suas provas registradas.

**Não aplicar este plano no meio de uma compilação ativa.** Introduzi-lo
quando a rodada em execução terminar, evitando reiniciar mais 49 workflows
para corrigir o próprio scheduler.

## Retomada Buildroot em executor persistente (opt-in seguro)

O runtime usa um Buildroot `O=` absoluto; `ccache` isoladamente não é
checkpoint do grafo de dependências. O builder agora aceita
`--work-dir /caminho/estavel/<fingerprint>`, retendo a árvore de build
e seus stamps entre tentativas **somente quando o próprio executor mantém o
mesmo filesystem no mesmo caminho absoluto**. Um recibo local contém
SHA-256 de todos os inputs nativos, versão/hash do Buildroot e identidade
completa do runner. Workspaces com recibo ausente, alterado, link simbólico,
fonte incompleta ou com outro fingerprint falham fechados. `flock` impede
dois produtores simultâneos; o builder não apaga trabalho incompleto nem
finge reconstrução concluída. Artefatos EROFS continuam tendo suas próprias
provas de filesystem, digest, inventário e provenance.

Para usar um executor dedicado de confiança, configure as variáveis do
repositório `ORDAX_SURFACE_RUNNER_LABEL` (label da máquina Linux x86_64
habilitada) e `ORDAX_SURFACE_PERSISTENT_WORK_ROOT` (diretório absoluto em
disco permanente acessível ao mesmo usuário, fora do checkout). Os workflows
mantêm `ubuntu-24.04` como fallback, mas esse executor hospedado é descartável:
**configurar apenas o diretório não torna seu armazenamento persistente**.
A versão da imagem do runner já participa do fingerprint; trocar toolchain,
Buildroot, kernel, config ou script invalidará a retomada. Sem prova EROFS/
QEMU do candidato, não há promoção Stable nem instalação USB autorizada.

O paralelismo usa `ORDAX_SURFACE_BUILD_JOBS` (inteiro de 1 a 64, padrão 4);
não há aumento implícito de consumo de memória. Em executor com mais CPU/RAM,
ajuste esse valor após medir memória disponível e picos da compilação WebKit.

### Identidade canônica do produtor dedicado e consumidores hospedados

Um runner `self-hosted` não possui obrigatoriamente `ImageOS/ImageVersion`.
O build EROFS deve declarar `ORDAX_SURFACE_PRODUCER_ENVIRONMENT` no GitHub
Repository Variables usando **quatro** componentes (exemplo
`Linux/X64/ordax-builder/image-v1`, refletindo uma imagem real e versionada).
O workflow produtor aceita esse override **somente** no runner self-hosted;
num runner hospedado, deriva a identidade real de `ImageOS/ImageVersion`.
O fingerprint e a verificação do componente usam a **identidade do produtor**,
mesmo quando o consumidor Owner/QEMU executa em outra imagem. O cache de
kernel/Base mantém sua própria identidade de runner e nunca herda um valor
forjado do produtor Surface. OS/arquitetura, provenance, SHA-256 e recibo do
EROFS continuam obrigatórios; um override sem quatro campos ou com plataforma
divergente é recusado. A variável só deve ser configurada juntamente com o
runner dedicado e o diretório permanente do mesmo image ID. Mudanças de
toolchain/OS desse executor exigem incrementar sua versão e invalidar o
fingerprint; isso **não** elimina a necessidade da prova QEMU nem autoriza
Stable.
