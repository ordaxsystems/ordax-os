# Windows Aura — Prova física CPU SIMD e resposta em até 10 s (29/10/2026)

Owner: `ordaxsystems/ordax-intelligence`; consumidor: `ordaxsystems/ordax-os`.

- Engine pinada: llama.cpp `7ab4ee7baad2d920464cbacfad4f4b07cf111fd2`.
- Build multi-ISA: `ordax-intelligence@e739adffc566ae8855a9a521754e32e3ab96c1e1` (main merge `877c4f9e19ca0eeefdafdf381bb01058325c294a`).
- CI Windows `40840299807`, duas compilações completas com hashes idênticos e inferência GGUF real; pacote de desenvolvimento não assinável `unsigned-windows-local-ai-engine-candidate`, SHA-256 `6b671f684af1d9e821eda49f5f4324fbe97968cbb1ac6fcfdcb8d99ee3401bdb`.
- Intel Core i5-3470 (4 núcleos/4 threads), Windows x64; modelo original Qwen3.5-0.8B-Q4_0 GGUF 563036064 bytes, SHA-256 `57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf`.
- Dezesseis EXE/DLL verificados um a um. Processo isolado em loopback com token efêmero eliminado após teste, `-t 4 -tb 4 --ctx-size 2048 --parallel 1 --reasoning off --reasoning-budget 0`. Nenhuma alteração na instalação.
- Prova `oi` com 32 tokens: primeiro token em 2156 ms, resposta encerrada em 4631 ms, `finish_reason=stop` e `[DONE]`.
- Prova com limite de 128 tokens e resposta concisa: `oi` 2678/4042 ms, `Olá, como você está?` 817/1286 ms (primeiro token / resposta completa), ambos com `finish_reason=stop` e `[DONE]`. A primeira resposta saiu em inglês; preferências de idioma ainda precisam de integração canônica.
- Aceite de experiência: saudação só passa quando há texto verdadeiro, conclusão integral sem truncamento e duração total menor ou igual a 10000 ms. Sem saudações falsas ou respostas artificiais para esconder lentidão.

**Limitações:** artefato Windows unsigned de teste; não é componente ativado, release assinada, teste do instalador final ou prova do aplicativo independente `assistant`. A instalação final ainda exige source lock, inventário exato, modelo verificado e rollback. Estes tempos não garantem velocidade em outras CPUs.

## Consulta rápida sem versão paralela

A Surface instalada anteriormente ainda solicitava até 512 tokens para um `oi`, que ultrapassou 10 s mesmo com o motor SIMD, com a mesma CPU/modelo. Em teste isolado, 128 tokens com o prompt original terminaram em 4291 ms para `oi` e 8377 ms para `Olá, como você está?`. O orçamento breve passa a ser aplicado no único adaptador Windows `ordax.local-ai/1`, somente quando recebe o envelope canônico da Intelligence para saudação sem contexto; perguntas longas, contextos e outros SO permanecem inalterados. O modelo segue produzindo a resposta real. Esse escopo não exige rebuild de kernel/USB nem modifica a política compartilhada de Intelligence.

## Prioridade interativa sob CPU saturada — prova física (29/10/2026)

O Desktop instalado, ativo em `9aa1ee83`, com os 16 binários SHA256 validados, atingiu 10024 ms de timeout no primeiro teste `oi` com envelope da Home solicitando 512 tokens; na repetição, primeiro texto aos 8233 ms e conclusão aos 8371 ms, mas `finish_reason=length` e resposta longa de 607 caracteres em inglês. A CPU estava entre 87% e 100%, predominantemente Chrome; nenhum processo externo foi encerrado.

Com elevação temporária apenas de `llama-server` a `AboveNormal`, a mesma rota retornou uma resposta real completa em **1797 ms**, `finish_reason=stop`. O processo foi restaurado a `Normal` em `finally`. A API Node `os.setPriority/getPriority` foi testada no Windows físico: prioridade 0 → -7 → 0. Outro teste, com a orientação de estilo específica de saudação em português, limite 64 tokens e o mesmo boost temporário, respondeu **“Oi! Bem-vindo! Como posso ajudar você hoje?”** em **5974 ms**, com `stop`, sem texto pronto e sem chave exposta.

O Host Windows mantém o prompt canônico intacto e acrescenta somente orientação de concisão/idioma para um envelope sem contexto de saudação reconhecida; limita esse caso a 64 tokens e eleva temporariamente a prioridade do mesmo processo, restaurando após sucesso, erro ou cancelamento. Pedidos longos mantêm orçamento e prioridade normais. Não há novo modelo, processo de IA, instalador Electron obrigatório ou alteração do Linux/USB.
