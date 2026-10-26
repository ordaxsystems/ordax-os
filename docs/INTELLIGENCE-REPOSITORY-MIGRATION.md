# OrdaX Intelligence — fonte externa verificada

**Estado: `integration-candidate`, sem cutover físico (2026-10-25).**

A fonte portátil do `ordaxsystems/ordax-intelligence` está fixada no commit
`c3dbb73e7f3cdf9a2043b059d7376fb0a06a1272` pelo **único** lock
`docs/contracts/intelligence-source.json`, que registra oito Git blobs exatos:
sete módulos e `tools/inference-builder/build.py`. O verificador canônico
`tools/intelligence-source/materialize.py` exige commit exato, conteúdo intacto,
modos corretos, árvore restrita e staging descartável. Não inclui GGUF nem
motor executável; a seleção de modelo, licença, limites e permissões continua
pertencendo ao OS.

## Integrações validadas

- **Gate A/B:** staging determinístico da fonte externa, mantendo os três
  contratos OS `ordax.intelligence/1`, `ordax.model-router/1` e
  `ordax.local-ai/1`, sem segundo dono de identidade, Memory ou autorização.
- **Gate C/D:** montagem conjunta OS + Surface + Intelligence, wrappers
  compartilhados, `system.tar` reproduzível, EROFS candidato e proveniência
  que impede execução/ativação ou escrita física implícita.
- **Owner/Development (#2267):** o Supervisor usa seu próprio slot, health
  e rollback para preparar a fonte externa. O Creator só pré-carrega a fonte
  como código de boot quando a revisão OS exata declarar `canonical`. Em
  `integration-candidate`, mantém os serviços atuais do dispositivo.
- **Builder real (gate de integração):** o workflow de candidato de IA e o
  Portable QEMU passam a construir/verificar `local-ai-runtime.erofs` com o
  builder externo materializado a partir do lock OS. O build exige
  `--os-source` explícito. O verificador antigo do OS ainda é exercitado
  contra **os mesmos bytes de EROFS**, até o corte coordenado da entrega v4.
  O cache vincula sua identidade ao lock externo e ao resolver; alteração
  no commit/hashes de origem invalida o reuse.

## Fronteiras de produção ainda fechadas

O lock segue `integration-candidate`: **não autoriza** remoção dos cinco
corpos legados ainda rastreados, atualização de
`repository-ownership.json`, publicação de novo release assinado ou
instalação no USB. O teste QEMU não substitui prova de hardware real.

Antes de promover a `canonical`: conciliar os ramos Buildroot/USB
#2242/#2243; validar boot frio realmente offline e rollback na Base final;
provar ABI do llama.cpp/GGUF, envelope v4 canônico, integridade e assinatura
de todos os slots; testar atualização e retorno físico. Só então substituir
os serviços ativos e retirar duplicação no mesmo corte testado.
