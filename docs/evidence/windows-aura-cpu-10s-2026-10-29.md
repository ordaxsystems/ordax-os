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
