# USB Dev — prova física da atualização automática (2026-10-20)

Estado de partida verificado: a `main` estava em `24198ec84e37da6ac612b5c7287e125d26bec73a`, mesmo commit do USB após manutenção no Windows. Este documento acompanha uma alteração real do helper read-only `ordax-diagnose`, não um bump de versão vazio.

## Ensaio no notebook (sem Creator e sem escrita em discos internos)

1. Inicie o USB Dev normalmente; mantenha o notebook conectado a uma rede Wi-Fi conhecida. Não aplique manualmente a atualização primeiro: precisamos observar o Supervisor.
2. Confira se a rede reconecta sem intervenção após o boot e se o Sistema → Atualizações detecta uma `main` mais recente que `24198ec8`.
3. Aguarde a tentativa automática do Supervisor. Se ela falhar, capture a fase e a mensagem integral da UI e os recibos de diagnóstico; não reinstale o sistema.
4. Se não houver aplicação automática, use **Sistema → Atualizações → Atualizar agora** como segundo ensaio separado. Não use Windows/WSL para aplicar essa atualização antes do teste autônomo.
5. Confira o SHA completo no diagnóstico e confirme `checkout.sha`, `/state/ordax/current-commit` e `/state/ordax/dev-helpers-sha` iguais ao novo HEAD da `main`. A ausência ou divergência de qualquer recibo significa teste **não aprovado**.
6. Confira que o `ordax-diagnose` atualizado expõe `power.last_action`, `power.last_status` e `pull.last_phase`, com valores `unavailable` quando não existe recibo.
7. Após aplicação, reinicie normalmente, observe rede e saúde da Surface e registre eventuais regressões. Testar *Desligar* só em ensaio separado, pois o poweroff físico ainda não está homologado.

## Interpretação

A integração na `main` prova somente que existe candidato remoto. GitHub Actions aprovadas, Pull manual pelo Windows ou mensagens HTTP aceitas **não** comprovam que o USB aplicou a alteração sozinho. A validação exigida é o recibo do boot no notebook, com SHA e fase de atualização.

O diagnóstico é local, sem alteração de dispositivos ou chamadas de rede e não imprime identificadores de boot, URLs autenticadas, senhas, tokens ou conteúdo arbitrário dos recibos. Não fornece controle remoto MCP.

## Ensaio seguinte: falha confirmada e correção instrumentada (21/10/2026 UTC)

**USB identificado:** Lidermix USB 8 GB, serial `6699E36B`, somente unidade física externa. O ext4 `ORDAX` tinha checkout limpo em `24198ec8` e `refs/remotes/origin/main` em `c3a6e19b`, com objeto Git presente. O witness do primeiro poll atingiu `git-remote-completed`. O diário persistente contou 23 erros `pull-handoff-validation-failed`; não houve ativação autônoma. **A causa individual não pode ser reconstruída da instrumentação antiga**. A última solicitação física de desligamento trazia `shutdown|...|failed`; o Guardian restaurava o Supervisor/Surface quando o desligamento não conseguia completar uma fase. A fase anterior também não era persistida.

**Reparo controlado e auditável:** imagem de recuperação offline da partição ext4 criada em WSL (sem publicar dados pessoais); `e2fsck -p` recuperou journal e contadores, verificação posterior `e2fsck -fn` concluiu sem erro. O `ordax-pull` oficial executado em chroot isolado instalou `581bfc384439448e8c3c414a904348db261c340d`. `HEAD`, `current-commit`, `dev-helpers-sha` e `origin/main` coincidiram, `previous-commit` manteve `24198ec8`, checkout limpo, helper idêntico ao fonte. Com mídia desmontada, `e2fsck -fn` retornou código 0; o USB foi devolvido ao Windows. **Isso é prova de Pull manual de manutenção, não de Pull de boot.**

**Mudança da PR #2055 (`581bfc38`):** o Pull agora indica qual subvalidação do handoff falhou: `handoff-metadata-*`, `handoff-ref-mismatch` ou `handoff-commit-unavailable`. O Guardian grava `power.last_stage` e `power.last_failure` com tokens fixos, preservando dados sensíveis. Também lida com agentes zombie sem interpretar PID existente como tarefa ativa.

**Este novo candidato de teste** acrescenta ao `ordax-diagnose` `pull.cached_main_sha` e `pull.cached_main_relation` calculados só com o Git local, sem rede ou alteração de estado. A diferença entre a `main` instalada no USB (`581bfc38`) e o novo commit deve ser mantida até o ensaio físico.

### Gate físico seguinte

1. Dar boot no notebook pelo **mesmo USB**, sem Creator, sem atualizar previamente via Windows. Confirmar reconexão Wi-Fi.
2. Abrir Sistema → Atualizações e observar a transação automática; registrar a versão final. Se não houver aplicação automática, repetir como ensaio **separado** com Atualizar agora.
3. Se falhar, preservar o diário `/state/ordax/native-state/diagnostic-journal.json`, a fase da tentativa no `/run/ordax-update/pull-result` (volátil) e o `ordax-diagnose`. Correlacionar `pull.cached_main_sha`, `pull.cached_main_relation` e o erro específico; **não** reinstalar nem disparar Pull manual antes da coleta.
4. Provar `HEAD = current-commit = dev-helpers-sha = main` após o Pull, Surface saudável, uma atualização sem fallback de rede e rollback recuperável.
5. Em teste físico **separado**, solicitar Desligar e observar se o hardware realmente desliga. Se a Surface retornar, coletar `power.last_status`, `power.last_stage` e `power.last_failure`. Não declarar poweroff aprovado com base em confirmação HTTP, stop da Surface ou testes isolados.

Para preservar a confidencialidade, enviar só os tokens allowlist e SHAs necessários. Não incluir senhas de Wi-Fi, tokens OAuth, identificadores de sessão, URLs autenticadas nem diário integral publicamente.

## 2026-10-20 — Causa raiz confirmada por revisão do Supervisor (PR #2057)

A ocorrência `pull-handoff-validation-failed` **não é apenas uma falha indeterminada da rede nem a falta do objeto Git**. O caminho de atualização Owner/Dev possuía uma variável de shell compartilhada por funções sem isolamento. Em `apply_remote_checkout`, `expected_sha=$2` guardava o SHA alvo; posteriormente, `write_update_state "$previous_sha"` chamava `derive_base_update_progress "$source_sha"`, que executava `expected_sha=$1`. Como `/bin/sh` não fornece escopo local automático, o SHA da transação era trocado pelo SHA de origem antes de chamar `ORDAX_EXPECTED_SHA="$expected_sha" "$PULL_BIN"`. O Pull rejeitava, corretamente, a divergência entre `origin/main` já buscado e a referência recebida.

**Mudança estrutural:** `apply_remote_checkout` usa parâmetros `checkout_target_sha` e `checkout_previous_sha`, nunca a variável genérica de outra função. `derive_base_update_progress` usa somente variáveis `base_progress_*`. Um invariante adicional impede avançar quando o SHA alvo diverge do SHA já buscado; não faz descoberta remota extra nem contorna verificação. O novo teste de regressão invoca o código real de `write_update_state`, `derive_base_update_progress`, `apply_remote_checkout` e o Pull real em um Git descartável com versões distintas.

### Limite da prova e recuperação necessária

A correção em GitHub **não repara automaticamente** uma instalação cujo Supervisor antigo destrói o SHA da própria atualização. Portanto, não repetir o boot antigo como teste de sucesso. Primeiro homologar testes/CI e integrar a PR, depois usar uma transação **única e controlada** de manutenção do USB físico para instalar o Supervisor corrigido. Preservar `previous-commit`, `HEAD`, `current-commit` e `dev-helpers-sha` coerentes, com `e2fsck -fn` aprovado após desmontagem. Não usar o Creator para mascarar a falha e não escrever em discos internos.

Para validar o Pull **automático**, publicar **uma alteração posterior e funcional** na `main` depois de o USB conter o Supervisor corrigido. Somente então testar a entrega pelo notebook, observando estado e recibos. Nenhuma aprovação de GitHub Actions, Pull por WSL, nem relato de versão na Surface substitui a prova física.
