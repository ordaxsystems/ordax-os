# OrdaX — índice operacional vigente

> **Autoridade:** código da revisão efetivamente integrada e instalada, contratos consumidos, artefatos verificáveis e recibos do destino. Este documento NÃO é um snapshot de versão, nem uma autorização de publicação. Consultar a main e o dispositivo a cada operação.
>
> Os antigos checkpoints acumulados neste arquivo eram históricos. Eles foram retirados do conteúdo ativo para impedir a reativação de arquiteturas e dependências descartadas. O histórico continua disponível pelo Git: git log --follow -- docs/CURRENT-STATE.md.

## Como verificar antes de agir

1. Comparar os SHAs de ordaxsystems/ordax-os/main, do produtor, do artefato entregue e do sistema fisicamente instalado. Nunca supor que coincidem.
2. Ler somente os contratos e locks realmente consumidos pelo código executado nessa revisão; registros históricos e documentos não substituem seus valores.
3. Verificar CI pelo commit e pela cobertura específica. Gates verdes não comprovam instalação, boot ou disponibilidade física.
4. Identificar a fase e o owner da falha antes de construir, atualizar ou corrigir um componente.

## Pontos de entrada canônicos existentes

| Escopo | Fonte executável | Comprovação necessária |
| --- | --- | --- |
| Boot e Pull Native DEV | bootstrap/initramfs/root/init, bootstrap/dev-base/ordax-pull, system/supervisor | Boot, Git, transação, saúde e recuperação no notebook |
| Base e entrega | system/services/base-update/dev_stage.py e seu canal | Integridade, staging, ativação e recibos distintos |
| Desktop Windows | desktop/dev-update.cjs, system/adapters/desktop/update-observation.mjs | Nova revisão ativa e saudável após reinício independente |
| Creator | creator/core/storage_image.go, creator/cmd/ordax-creator/main.go | Plano e imagem verificados; gravação, readback e boot são provas separadas |
| Surface | system/surface/bin/ordax-surface, docs/contracts/surface-source.json quando realmente consumido | Identidade da composição, runtime e heartbeat reais |
| Runtime MCP | ordaxsystems/ordax-runtime e seus consumidores no OS | Sessão, catálogo de capacidades, transport e grants verificáveis |
| Identidade e grants | ordaxsystems/ordax-platform | Atestação da autoridade; presença não equivale a permissão |

## Arquitetura que não deve regredir

- Não restaurar bootstrap/dev-base/build.py nem bootstrap/stable-base/build.py: foram retirados da main. Não recolocar Alpine/APK ou provisionamento gráfico dinâmico como solução de boot.
- Um único Update Engine e política de integridade, ativação e rollback. Desktop, OS Native e Creator têm adaptadores próprios, sem segundo atualizador.
- O Pull Native usa recuperação transacional. A restauração automática antiga por duas renomeações foi removida; árvores aposentadas são preservadas para diagnóstico, **não** reativadas.
- O Creator pode preparar arquivo Owner DEV com três partições, mas isso NÃO grava disco, não autoriza elevação e não significa USB instalado. O pacote GUI de inspeção não possui writer físico.
- O initramfs já contém verificação e crescimento ext4. Não duplicar o serviço ou supor que editar a GPT aumenta automaticamente o filesystem.
- Conta, Ajustes, Sistema e Loja são funções proprietárias da composição Surface, não apps removíveis duplicados. Apps externos têm owners próprios.
- Runtime MCP executa ações autorizadas; sessão, clientes OAuth, grants e vínculo são responsabilidades da Platform. Discovery ou heartbeat não substituem readiness.
- Desenvolvimento não autoriza automaticamente promoção Stable, assinatura, acesso de produção ou gravação física.

## Builds, manutenção e limpeza

- Priorizar testes locais dirigidos ao código alterado; reutilizar cache e artefatos válidos.
- Kernel, Base, Surface e QEMU só devem recompilar quando houver dependência ou gate de impacto pertinente. Mudança em docs ou CLI não autoriza rebuild geral.
- Integrar PR validada, remover a branch integrada e limpar worktrees próprios quando estiverem limpos. Branch divergente, rescue e trabalho do Codex/Forge permanecem preservados até auditoria.
- Remover implementações sem consumidores do código ativo. Preservar histórico pelo Git em vez de manter compatibilidade executável fictícia.
- Não copiar SHAs ou status antigos para este documento: consultar o GitHub e o destino físico no momento do diagnóstico.

## Pendências que não podem ser declaradas concluídas por inferência

O Pull bem-sucedido no Desktop não homologa o Native do notebook. Wi-Fi não prova HTTPS ou Git. Capturar fase do Pull, erro, espaço, checkout, ativação e recibo do Supervisor no próprio notebook. Um seed RAW e um USB preparado são artefatos distintos. Nenhum deles deve ser chamado de USB instalado sem readback e boot.

Referências operacionais: docs/DEVELOPMENT-WORKFLOW.md, código e testes no SHA inspecionado, manifestos publicados e recibos físicos. **Não acrescentar cronologias ou instruções oriundas de snapshots antigos neste índice.**
