# Local AI performance qualification

Status: **ENGINEERING FOUNDATION — NOT A RELEASE GATE**

This document defines how OrdaX measures and later tunes the local inference
backend without weakening the Stable/MVP portability, privacy or signed-runtime
boundaries.

## Current baseline

The Stable/MVP local AI artifact is byte-pinned and uses the generic reproducible
`llama.cpp` build/launcher defined by the release lane. Performance flags must
not be changed opportunistically in the product runtime because changing the
engine or launcher changes the signed v4 payload identity.

Four engineering tools are available on the source tree and do **not** modify
the runtime artifact:

```text
tools/local-ai-hardware-probe/probe.py
tools/local-ai-benchmark/benchmark.py
tools/local-ai-baseline/report.py
tools/local-ai-baseline/compare.py
```

All four are covered by the `Intelligence Foundation` source gate.

## 1. Hardware capability probe

For engineering qualification, run:

```bash
python tools/local-ai-hardware-probe/probe.py
```

The engineering probe reads bounded `/proc/cpuinfo` and `/proc/meminfo` inputs
without shelling out. It reports normalized architecture, logical CPU count,
total/available memory, a bounded allow-list of common CPU features, and objective
compatibility with the currently pinned `linux-x86_64` engine artifact.

The probe deliberately does **not** invent RAM/CPU performance minimums and does
not output tuning flags. Today the only start blocker it may derive is an
architecture mismatch with the pinned engine artifact. Any future memory or
feature threshold must be justified by measured product behavior and added to an
explicit contract.

### Production pre-start probe

The MVP `hardware_probe_before_start` requirement is wired in
`bootstrap/stable-base/ordax-stable-init`. Stable Base remains minimal and does
not gain Python as a runtime dependency: the production pre-start probe is
POSIX/BusyBox-compatible shell and runs immediately before `ordax-local-ai` is
started.

The production probe intentionally enforces only the blocker already justified by
the contract: the pinned `linux-x86_64` runtime must execute on a compatible
architecture. Logical CPU count and total memory are emitted only as local boot
observability; they are not thresholds and cannot independently reject the
backend. A probe failure or architecture mismatch degrades Local AI through the
existing fail-soft path and still allows `/system/entrypoint` to continue.

The richer Python probe remains the engineering/benchmark input because it can
record bounded SIMD capability data without forcing that tooling into Stable
Base. The two roles are therefore deliberate rather than duplicated runtime
implementations: production decides only whether the pinned artifact can start;
engineering captures evidence used to evaluate later tuning.

## 2. Steady-state benchmark

With the pinned Local AI backend already running on loopback:

```bash
python tools/local-ai-benchmark/benchmark.py \
  --expected-model qwen3.5-0.8b-q4_0 \
  --runs 5 \
  --n-predict 32 \
  --output local-ai-benchmark.json
```

The benchmark accepts only literal IPv4 loopback HTTP with an explicit port. It
discovers exactly one active model through `/v1/models`, fails closed on model
identity drift, performs one unreported warmup, and then measures bounded samples
through `/v1/chat/completions` — the same OpenAI-compatible inference path used by
`ordax.local-ai/1`. Each request binds the discovered canonical model ID.

The result records engine/model identity, API path, measured run count, token
budget, per-run wall latency, `usage.completion_tokens`, wall-clock tokens/second,
llama.cpp-reported predicted tokens/second when available, and medians.

A malformed chat response, invalid token count, ambiguous model discovery or
model-ID mismatch invalidates the benchmark instead of producing a partial result.
CI validates behavior with a fake loopback server; CI speed is never a product
performance threshold.

## 3. Composed target baseline

For a real notebook or USB target:

```bash
python tools/local-ai-baseline/report.py \
  --expected-model qwen3.5-0.8b-q4_0 \
  --runs 5 \
  --n-predict 32 \
  --output local-ai-baseline.json
```

The reporter composes the canonical hardware probe and benchmark. It requires
compatible hardware before inference and preserves both original schema payloads.
It rejects a benchmark measured through any path other than
`/v1/chat/completions`, so an older raw `/completion` measurement cannot be mixed
with the product-path baseline.

The report contains capability classes and performance metrics but no hostname,
account, prompt history, model responses, user files, tokens or remote telemetry
identity.

## 4. A/B baseline comparison

After measuring one controlled candidate on the same target:

```bash
python tools/local-ai-baseline/compare.py \
  local-ai-baseline.json \
  local-ai-candidate.json \
  --output local-ai-comparison.json
```

The comparator fails closed unless both baselines use the same engine/model ID,
product API path, run count, token budget and hardware fingerprint (runtime
platform, architecture, logical CPU count, total memory and common CPU-feature
set). Available memory is deliberately excluded from the fingerprint because it
is transient runtime state.

The output reports objective percentage deltas only:

- `latency`: negative means lower latency;
- `wall_tokens_per_second`: positive means higher wall throughput;
- `server_tokens_per_second`: positive means higher server-reported throughput,
  when both baselines expose it.

The comparator does **not** select a winner, apply a performance threshold, mutate
runtime bytes or promote a release. Product acceptance remains a separate human
and release-policy decision based on measured evidence.

## 5. Physical runtime correlation

The shared physical Surface probe now also aggregates the `local-ai` process
role. This means one physical session can correlate:

- Local AI CPU time and RSS growth;
- system-wide CPU busy and I/O wait ratios;
- Linux PSI for CPU, memory and I/O;
- physical block-device read/write deltas;
- Surface/native-host/chromium resource use.

The probe emits only aggregate counters. It does not expose the Local AI command
line, model path, prompt, response or user content.

This is the preferred evidence for deciding whether a future tuning candidate
actually improves the portable product instead of merely increasing raw model
throughput while making the rest of the OS less responsive.

## 6. Tuning workflow

For a real notebook/hardware target:

1. capture the untouched signed/pinned baseline;
2. keep model, prompt, token budget, API path and run count fixed;
3. change one engine/launcher variable at a time;
4. capture a candidate baseline on the same target;
5. compare with `compare.py` and inspect objective deltas;
6. reject candidates that break identity, loopback-only operation or bounded
   runtime contracts;
7. only after a measured candidate is deliberately selected, update the release
   lane and regenerate exact runtime hashes and signed v4 evidence.

CPU feature presence is an input to experimentation, not proof that a build or
threading policy is faster or sufficiently portable.

## 7. What remains

- complete the current CI/QEMU proof of the newly wired production pre-start
  hardware probe;
- collect the first baseline on the actual target notebook/USB environment;
- collect a simultaneous physical Surface performance probe with Local AI active;
- determine whether the portable generic engine meets the UX target;
- if not, evaluate controlled alternatives without changing the stable
  `ordax.local-ai/1` / `ordax.intelligence/1` APIs;
- if a tuned engine/launcher is adopted, re-pin and re-prove the whole Local AI
  runtime through the canonical release lane.

No cloud provider, tool execution, agent authority or prompt telemetry is enabled
by this performance workflow.


## Store de modelos e compatibilidade do dispositivo

A Loja possui uma seção **Modelos de IA** distinta de Apps. No MVP,
ela apresenta a identidade do modelo local previsto na distribuição,
o motor, a licença e o formato **sem** afirmar instalação ou atualização
independente. `tools/local-ai-model-catalog/render.py` produz uma projeção
`model-candidate.generated.mjs` verificável, exclusivamente a partir do
`system/services/local-ai/source-lock.json` canônico. O CI reprova divergência.
Essa projeção não é um novo catálogo de publicação, não transporta URLs,
não concede permissões e não aciona downloads.

A verificação de dispositivo reutiliza as portas existentes:

- `ordax.hardware-inventory/1`: arquitetura real coletada pelo Host;
- `ordax.system-metrics/1`: RAM total/disponível e espaço livre de usuário.

A avaliação é **conservadora**: x86_64 satisfaz apenas a exigência da arquitetura
do artefato ELF atual; ARM é incompatível; leitura ausente é desconhecida.
Sem medições qualificadas, **não** se atribuem RAM mínima/recomendada, desempenho
garantido nem aptidão para instalação. Os bytes fixados do modelo e do executável
são um **limite inferior**, não o tamanho final do pacote assinado.
O volume de armazenamento do usuário não precisa coincidir com o volume de
componentes, portanto não é usado como permissão de instalação. GPU é opcional
para a configuração CPU genérica inicial, não uma promessa de aceleração.

A Loja pode consultar novamente as informações sob pedido do usuário,
sem pesquisar rede, sem coletar arquivos pessoais e sem atrasar o boot.
Quando o canal de modelos independente estiver implementado com artefatos
assinados, compatibilidade por modelo e rollback, o estado exibido poderá
ser promovido por **prova de runtime e de lifecycle**, não por um botão visual.

Mínimos de RAM, espaço no volume real, requisitos de instruções e metas de
latência devem nascer de provas físicas versionadas em diferentes faixas
de hardware. Não publicar "compatível" só porque a arquitetura coincide.
