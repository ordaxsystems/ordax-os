# OrdaX Intelligence — source externo verificado

**Estado: integration-candidate (NÃO cortado do OS)**, em 2026-10-25.

O motor reutilizável já está no `ordaxsystems/ordax-intelligence`, commit ea663e1bbdc1066e556d8ee5cf279783cae0ba8c. Este commit fica fixado por `docs/contracts/intelligence-source.json`. O arquivo de contrato registra **sete arquivos portáteis exatos**, cada um com Git blob SHA. O verificador `tools/intelligence-source/materialize.py` rejeita HEAD diferente, arquivos alterados, paths extras, links, source mode inadequado, arquivos faltantes e divergências de Git blob, antes de montar uma árvore descartável.

O destino candidato é `system/intelligence-source/src` apenas **dentro de staging**, e não no Git nem na árvore de execução ativa. Não há segunda Memory, segundo motor, interface, updater ou proprietário de permissões. O OS permanece com os três contratos públicos canônicos `ordax.intelligence/1`, `ordax.model-router/1`, `ordax.local-ai/1`.

A CI de integração faz checkout do commit externo e demonstra integridade/cópia verificada usando código real; os testes unitários usam uma árvore Git sintética para casos negativos. O estágio atual NÃO injeta estas fontes nos runners de produção, no Supervisor ou no USB.

**Cutover pendente:** compor fonte verificada com os módulos Native/Surface e o builder existente; validar comportamento e compatibilidade; somente então retirar as cinco implementações antigas do OS, mantendo seus contratos públicos e adapters de autorização, e atualizar `repository-ownership.json`. O caminho Owner/Development deve receber o source imutável na mesma transação de staging do Supervisor, antes de qualquer uso, sem exigir download durante o boot offline. O Stable/MVP deve incluir a fonte no mesmo release assinado. Reutilizar o pipeline de atualização e rollback do OS. PRs #2242/#2243 devem ser reconciliadas antes de qualquer mudança que toque boot ou a montagem da Surface.

Este PR não solicita assinatura, ativação, atualização de dispositivo, nem prova física.

## Proveniência adicional: builder técnico

A revisão externa fixada foi atualizada para `c3dbb73e7f3cdf9a2043b059d7376fb0a06a1272`. O source gate inclui agora oito blobs, sendo o oitavo `tools/inference-builder/build.py`, que só recebe manifestos/licença de um OS source explicitamente fornecido. A árvore de stage pode conter o builder, mas a implementação de produção `bootstrap/local-ai-runtime/build.py` permanece ativa no OS até corte coordenado, revisão do ABI/EROFS e assinatura. A mudança de source pin não ativa o builder externo nem remove o antigo.

## Gate C — vínculo ao montador Native (candidato não promovido)

O `tools/native-release-assembly/build.py` agora oferece o parâmetro explícito `--require-external-intelligence` em **assemble** e **verify**. Quando solicitado, o verificador exige na árvore descartável:

- Revisão do `ordax-intelligence` igual ao lock OS, com todos os oito blobs e digest agregado exatos.
- Os cinco wrappers OS equivalentes aos definidos pelo compositor canônico, sem corpos antigos nem arquivos externos injetados.
- Recibo de montagem com identidade exata e flags de segurança sem autorização de ativação; coexistência com Surface verificada pelo mesmo montador Native.
- Vínculo gravado na proveniência da montagem; verificação posterior revalida bytes após cópia e detecta adulteração.

O caminho atual de produção mantém o comportamento anterior **sem habilitar essa flag automaticamente**. A CI executa o gate no candidato e prova a política de recusa com testes negativos, sem baixar GGUF, assinar artefatos nem escrever no USB. O cutover real ainda exige sincronizar Creator/Buildroot/Surface, usar essa flag no release canônico, validar o boot inicial offline e remover os cinco corpos legados rastreados no OS no mesmo corte validado.
