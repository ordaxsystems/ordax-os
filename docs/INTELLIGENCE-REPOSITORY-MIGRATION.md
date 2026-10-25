# OrdaX Intelligence — source externo verificado

**Estado: integration-candidate (NÃO cortado do OS)**, em 2026-10-25.

O motor reutilizável já está no `ordaxsystems/ordax-intelligence`, commit ea663e1bbdc1066e556d8ee5cf279783cae0ba8c. Este commit fica fixado por `docs/contracts/intelligence-source.json`. O arquivo de contrato registra **sete arquivos portáteis exatos**, cada um com Git blob SHA. O verificador `tools/intelligence-source/materialize.py` rejeita HEAD diferente, arquivos alterados, paths extras, links, source mode inadequado, arquivos faltantes e divergências de Git blob, antes de montar uma árvore descartável.

O destino candidato é `system/intelligence-source/src` apenas **dentro de staging**, e não no Git nem na árvore de execução ativa. Não há segunda Memory, segundo motor, interface, updater ou proprietário de permissões. O OS permanece com os três contratos públicos canônicos `ordax.intelligence/1`, `ordax.model-router/1`, `ordax.local-ai/1`.

A CI de integração faz checkout do commit externo e demonstra integridade/cópia verificada usando código real; os testes unitários usam uma árvore Git sintética para casos negativos. O estágio atual NÃO injeta estas fontes nos runners de produção, no Supervisor ou no USB.

**Cutover pendente:** compor fonte verificada com os módulos Native/Surface e o builder existente; validar comportamento e compatibilidade; somente então retirar as cinco implementações antigas do OS, mantendo seus contratos públicos e adapters de autorização, e atualizar `repository-ownership.json`. O caminho Owner/Development deve receber o source imutável na mesma transação de staging do Supervisor, antes de qualquer uso, sem exigir download durante o boot offline. O Stable/MVP deve incluir a fonte no mesmo release assinado. Reutilizar o pipeline de atualização e rollback do OS. PRs #2242/#2243 devem ser reconciliadas antes de qualquer mudança que toque boot ou a montagem da Surface.

Este PR não solicita assinatura, ativação, atualização de dispositivo, nem prova física.
