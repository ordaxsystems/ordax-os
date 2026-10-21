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
