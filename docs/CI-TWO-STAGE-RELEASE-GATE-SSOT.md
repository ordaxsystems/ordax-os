# CI OrdaX — duas etapas, sem rebuild por cada commit

## Desenvolvimento (PR como draft)

Alterações na Surface UI, Account, contratos, documentação e automações devem
executar **testes rápidos**. O estado draft é obrigatório durante o desenvolvimento;
os jobs pesados de Creator, Base, Surface EROFS, Native ESP e Portable/QEMU são
ignorados nesse estágio. Os jobs de contrato, análise de impacto, lint, testes
unitários e testes funcionais focados **continuam obrigatórios e falham
normalmente**. O botão `workflow_dispatch` permite a prova pesada voluntária,
com os mesmos contratos e integridade, mesmo com PR draft.

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
