# Site — verificação do módulo

Frontend: site/public; contratos: site/contracts; scripts: site/scripts; verificações: site/tests.
Um único código de Identity permanece em api/ e lib/ do OS, reutilizado pelos entrypoints do Site. O `vercel.json` da raiz do OS é a única política de deploy; `site/vercel.json` foi removido. O staging histórico permanece pausado.

A fonte final de código é o commit do OS. Não existem materializadores de origem Site, cópias da API de Identity ou dependência de Git de ordax-site.

O histórico anterior está preservado no Git do repositório de origem. Não usar recibos históricos como prova atual de publicação.
