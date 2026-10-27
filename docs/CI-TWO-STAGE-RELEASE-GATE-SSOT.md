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

O `independent-base-experiment.yml` também foi separado em
`independent-base-contract` (checagens de Buildroot, firmware, ABI e
regressões do Owner Development, executadas em draft) e
`buildroot-qemu` (compilação/prova pesada dependente do contrato e da
seleção de perfil validada). O contrato seleciona o perfil exato uma vez e
entrega esse valor como output ao consumidor, que o valida novamente.
Não há uma segunda bateria de testes de contrato dentro do job de
compilação.

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
SO, arquitetura, imagem e versão ausente. Essa checagem aplica-se tanto à
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

## Garantias e limites

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
