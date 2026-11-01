# OrdaX Intelligence — fonte externa verificada

**Estado: `integration-candidate`, sem cutover (2026-11-01).**

A fonte portátil do `ordaxsystems/ordax-intelligence` está fixada no commit
`a39c8ddcba1ac466a3697e03c20e0a8f186e4fc8` pelo **único** lock
`docs/contracts/intelligence-source.json`, que registra oito Git blobs exatos:
sete módulos e `tools/inference-builder/build.py`. O verificador canônico
`tools/intelligence-source/materialize.py` exige commit exato, conteúdo intacto,
modos corretos, árvore restrita e staging descartável. Não inclui GGUF nem
motor executável; a seleção de modelo, licença, limites e permissões continua
pertencendo ao OS.

## Validação do consumidor no Windows — 2026-11-01

O workflow de integração de Intelligence agora executa a fonte candidata em
`windows-2022` usando a revisão imutável resolvida de
`docs/contracts/intelligence-source.json`. O runner verifica e materializa
a revisão pelo mesmo `materialize.py` canônico e executa
`tests/test_intelligence_external_integration.mjs` contra os contratos
públicos do OS. Isso cobre a composição buffered/SSE, o estado degradado sem
backend, a recusa do roteador cloud e a compatibilidade sem autorização
implícita usando backend fixture.

O modo Git `100644` é a autoridade para bit executável. O materializador
aceita os modos regulares nativos que o Windows reporta (`0666` gravável ou
`0444` somente leitura), rejeita links/arquivos especiais e normaliza cada
arquivo staged para `0644`.

Essa é uma prova de consumidor da fonte candidata em Windows CI. Não comprova
inferência com modelo real, o instalador Desktop, funcionamento instalado,
ativação, rollback de release ou hardware físico; o lock permanece
`integration-candidate`.

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

## Atualização de origem — fronteira consultiva HTTP

O commit externo `9791ae4734d8f111490fe1ad8e815752b35d661a` integra a [PR #5 de Intelligence](https://github.com/ordaxsystems/ordax-intelligence/pull/5). A implementação buffered rejeita tool calls, function calls, respostas truncadas e envelopes inválidos, em paridade com a fronteira SSE. As duas execuções de [Intelligence CI #40278286189](https://github.com/ordaxsystems/ordax-intelligence/actions/runs/40278286189) e [#40278426237](https://github.com/ordaxsystems/ordax-intelligence/actions/runs/40278426237) terminaram com sucesso. O teste HTTP usa **servidor-fixture loopback real**, não motor llama.cpp nem modelo GGUF real.

Este commit no OS atualiza **somente** o source lock imutável (commit + hash do runtime modificado) e sua documentação; todos os outros sete blobs ficam preservados. O staging/materializador e os verificadores de integração do OS devem revalidar o novo lock. O estado continua `integration-candidate`, `activation_authorized=false` e `cutover_complete=false`: nenhum consumidor ativo, boot, dispositivo físico ou assinatura é promovido.

## Revalidação da fronteira consultiva (SSE)

O módulo portátil de streaming SSE exige os mesmos limites do buffered: campos
`tool_calls`, `function_call`, `tool_call_id`, `refusal` ou papel de assistant
inválido tornam a resposta inadmissível, sem acionar ferramentas. O source lock
deixa **somente** o Git blob `src/local-ai/completion-stream.mjs` alterado
em relação à revisão candidata anterior; testes de HTTP loopback negativos
são mantidos na CI do `ordax-intelligence`. Essa atualização de pin
não libera cutover, não altera as ações autorizadas pelo OS e não substitui
a Base Buildroot em validação pela PR #2243.

## Prova adicional do motor real em streaming (candidata)

O workflow `.github/workflows/local-ai-runtime-candidate.yml` agora chama
`bootstrap/local-ai-runtime/prove_stream.py` **sobre o mesmo EROFS imutável**
já montado para a prova de inferência real do llama.cpp/GGUF. A verificação
usa a porta literal HTTP `127.0.0.1`, uma chave efêmera privada (não
registrada), descoberta exata do único modelo, rejeição de chamada SSE sem
autenticação, resposta `text/event-stream` com texto e `finish_reason=stop`,
modelo correspondente, marcador `[DONE]`, limites de tamanho e rejeição
de campos de autoridade de ferramentas. Desconecta ainda uma solicitação
em andamento e prova que o serviço permanece acessível. Os testes de protocolo
isolados ficam em `tests/test_local_ai_live_stream_probe.py`.

**Limites de evidência:** essa prova confirma cliente SSE e desconexão em
runner Ubuntu com binário/modelo real, mas **não** prova que o motor interrompeu
fisicamente o cálculo após desconexão, nem ABI Buildroot, ativação do slot,
boot final ou USB físico. A verificação não cria outro runtime, porta, updater
ou versão dos contratos. Seus recibos ficam em
`real-sse-proof.txt`, somente quando o workflow candidato for aprovado.
Uma falha bloqueia o candidato, sem relaxar os gates existentes.

## Timeout de HTTP buffered com adaptadores não cooperativos

A fonte portátil candidata foi fixada no commit
`a39c8ddcba1ac466a3697e03c20e0a8f186e4fc8`.
Somente o blob `src/local-ai/runtime.mjs` mudou em relação ao pin anterior;
sete blobs permanecem inalterados. A origem da falha era esperar
indefinidamente por `fetch()`, `reader.read()`, `reader.cancel()` ou
`json()` em adaptadores que ignoram `AbortSignal`. O timeout agora cobre
a operação HTTP completa e o cancelamento é best effort, sem segundo canal
de health/rollback. A suíte upstream do Intelligence prova com fixtures
não cooperativas que timeouts, `dispose()` e cancelamento do solicitante
encerram a espera sem promover texto parcial.

**Limite:** não comprova interrupção de trabalho do motor no servidor,
Base Buildroot nem USB. O contrato do OS continua `integration-candidate`,
sem ativação, publicação ou mudança de autoridade.

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
