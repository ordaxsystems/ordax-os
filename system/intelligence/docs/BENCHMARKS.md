# Benchmarks de inferência local (prova observacional)

O motor e modelo são entregues pelo `ordax-os`. A ferramenta de medição **não instala, inicia, atualiza, autoriza ou gerencia** o backend. Ela exige o servidor `llama.cpp` ou outro provedor compatível **já ativo**, usa somente HTTP literal `127.0.0.1`, conexão direta sem proxy/redirecionamentos e uma chave privada `0600` do próprio OS.

## Execução

Com um dispositivo/runner de prova autorizado, modelo pinado e serviço pronto:

```sh
python3 tools/benchmarks/local_http.py \
  --model qwen3.5-0.8b-q4_0 \
  --endpoint http://127.0.0.1:17865 \
  --api-key-file /run/ordax/local-ai-auth/key \
  --warmups 2 --samples 10 --max-tokens 64 \
  --pid PID_DO_SERVIDOR > metricas.json
```

`--pid` é opcional e serve apenas para observação de `/proc/PID` no Linux. Não executa operações no processo. Sem PID, CPU/RSS/HWM aparecem como `null`. A ferramenta não registra o prompt, a chave de API, a resposta nem as mensagens da IA no recibo. O arquivo de métricas deve seguir a política de dados do ambiente de teste.

## Semântica

- `latency_ms.mean/p50/p95`: tempo de ida e volta do POST JSON (inclui pré-processamento/prompt e geração), não tempo por token puro.
- `end_to_end_effective_tokens_per_second`: tokens de completion reportados pelo backend divididos pelo tempo total das amostras, **não** uma métrica de decodificação isolada.
- `selected_process_cpu_seconds`: diferença de tempos CPU de **um PID** observado via `/proc`, não consumo de sistema inteiro nem subprocessos.
- `sampled_rss_mib_max`: maior RSS das leituras *entre* amostras. Não é pico real.
- `process_lifetime_hwm_mib`: high-water mark desde o início da vida do processo, não apenas da janela do benchmark.
- `hardware_performance_qualified=false`: os números só qualificam um perfil de hardware depois de execução real, configuração e critérios aprovados pelo owner OS.
- `is_buildroot_abi_proof=false`: um benchmark no host Ubuntu não substitui boot/ABI da Base Buildroot ou QEMU.

A resposta requer o mesmo `model_id` exato, término `finish_reason=stop`, texto de assistant e contagem real de tokens; tool calls e truncamento são recusados. Warmups não entram na média. Limites: 1–50 amostras, 0–10 warmups, 1–2048 tokens, 5–300 s. Não utilizar dados pessoais como prompts de benchmark.

## Critérios para laptops fracos e releases

Rodar a **mesma** revisão assinada/atestada do motor e GGUF em perfis reais de RAM/CPU, com 10+ amostras após warmup; arquivar versão exata do OS, digest EROFS, modelo, configuração e resultados. Comparar cold-start em prova separada, medir memória total do sistema e estabilidade pelo host canônico e repetir em QEMU/USB/notebook conforme gates. Não inventar limites de desempenho antes de medir.

A CI executa `tests/test_local_http_benchmark.py` com servidor HTTP local **fixture** para validar apenas comportamento, isolamento e formato; seus números de tempo/RSS não são benchmarks de produto.

## INTELLIGENCE-001 — baseline de contexto

Os [testes F0](evidence/INTELLIGENCE-001-F0-BASELINE.md) usam contratos e serviços do OS com backend de inferência simulado: validam o contexto, escopos e a autoridade, **não** a compreensão do modelo local, nem latência, embeddings ou inferência física. O próximo benchmark de qualidade requer modelo real e Windows físico, com resultados por caso.

## INTELLIGENCE-001 — canários de respostas da Aura

O scorer offline `tools/evaluation/score-contextual-f0.mjs` reutiliza os **seis casos** de `tests/fixtures/contextual-f0.json`. Gere template com `--template`, preencha somente com respostas obtidas do fluxo autorizado OS/Aura e pontue com `--score respostas.json`. A ferramenta não faz rede, não aceita arquivos gigantes ou aliases simbólicos e não revela os textos no relatório. Saída `0` = todos os **canários lexicais** passaram; `1` = houve falhas; `2` = dados inválidos. Ela **sempre** marca `physicalModelAttested=false` e `semanticQualityQualified=false`; não substitui medição física, validação de contexto, aferição de precisão humana nem o benchmark HTTP já existente. Veja [evidência F0](evidence/INTELLIGENCE-001-F0-BASELINE.md).

O gate F0 também verifica que um radical esperado só pontua no **início de palavra**: `desautorizado` não deve corresponder a `autoriza`. As rubricas rejeitam afirmações de ação executada sem confirmação e catalogação contraditória de app. Como os canários continuam lexicais, não substituem interpretação semântica, revisão de respostas nem prova física; veja a [evidência F0](evidence/INTELLIGENCE-001-F0-BASELINE.md).
