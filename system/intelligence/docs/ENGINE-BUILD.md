# Reproducible inference builder — source ownership

This component is the extracted **technical inference builder** from `ordax-os/bootstrap/local-ai-runtime/build.py`. The canonical model choice, full engine SHA and exact ELF hash/size, `ordax.local-ai/1` policy, model license text, and signing/activation remain **owned by OrdaX OS**, not copied here.

## Invocation

Run on a pinned, verified Linux x86_64 build runner with the OS source checkout and required native toolchain. The source lock must be `OS/system/services/local-ai/source-lock.json`; the versioned product contract is `OS/docs/contracts/local-ai.json`.

```sh
python3 tools/inference-builder/build.py \
  --os-source /path/to/verified/ordax-os \
  build --out-dir /tmp/ordax-local-ai-artifact --cache-dir /tmp/ordax-model-cache
python3 tools/inference-builder/build.py \
  --os-source /path/to/verified/ordax-os \
  verify --out-dir /tmp/ordax-local-ai-artifact
```

The CLI cannot silently select a different lock or use a copy within `ordax-intelligence`. Its OS checkout, manifest parents and OS-owned model-license parents must be real directories without symbolic links. The builder also requires that checkout to be the Git repository root and verifies that the OS source lock, product contract and model license are **regular Git blobs whose on-disk bytes exactly match HEAD**, before any model download/compilation and again during artifact verification. Receipt provenance always uses the Git HEAD of the selected OS checkout: `ORDAX_SOURCE_COMMIT`, when set, must match that HEAD exactly and cannot override it. It reads OS manifests and model license through the **explicit** `--os-source` directory, refusing missing or symlinked manifests. The `--out-dir` and `--cache-dir` paths must be real, non-symlinked directories with no symlinked parent components, and cannot overlap (including parent/child relationships). `verify` applies the same output-root checks. Cached GGUF targets cannot be symlinks. Downloads use one **unique, exclusive temporary file per attempt** in the verified cache directory, never a shared `.part`; both exact size and SHA-256 must pass before atomic promotion to the canonical GGUF path. Parallel builds may download concurrently, but their temporary files cannot overwrite or erase each other, and a completed verified cache from another build is reused instead of replaced. Failed downloads leave existing cache bytes untouched and clean only their own temporary files. The cached bare `llama.cpp.git` mirror and its `HEAD` must also be regular, local entries. These checks happen before using network or Git caches, without changing model/engine pins. It rejects shell metacharacters, path separators, URL query/fragment controls and other unsafe model filenames before interpolating the OS-owned GGUF basename into the launch script; the model repository must also be a literal Hugging Face `owner/repository` pair. This is one builder input validator reused by OS-lock loading, model URL construction and launcher generation, not a separate source lock. It checks the pinned upstream llama.cpp commit, exact static ELF SHA/size, GGUF SHA/size, CPU architecture, license, EROFS image/hash and runtime loopback policy. No credentials, model weights or engine executables belong in this Git repository.

## CI and promotion boundaries

The fast CI runs the adapted OS builder regressions with the exact OS checkout; it proves **lock validation and source-code behavior only**. It does **not** fetch ~563 MB of GGUF or compile llama.cpp and therefore makes no engine ABI, performance or physical run claim.

The OS contract `docs/contracts/intelligence-source.json` **already pins** this Python builder source together with the portable Intelligence modules (`builder_source_pinned=true`). That pin proves source identity only: `builder_activation_authorized=false` and `cutover_complete=false` remain the current boundary. Before the coordinated cutover, keep the builder hash synchronized through the single OS contract and then switch the single OS image builder only after the existing real pinned-engine build, EROFS, QEMU, signature and rollback gates pass. Do not keep two builders active and do not create a second source lock, updater, keyring or release authority.

## Windows x64 candidate proof (non-activating)

`python tools/inference-builder/windows-candidate.py --os-source /path/to/exact/ordax-os --out-dir /new/output --cache-dir /cache`
runs only on a Windows x64 build runner with Visual Studio 2022 CMake support.
It reuses this repository's existing `build.py` source lock, Git mirror,
checkout and hash-verified GGUF download. Before any model acquisition or native compilation, it attests that the OS-owned lock, contract and license are exact committed bytes of the OS checkout. The `--out-dir`, `--cache-dir` and deterministic sibling build workspace must be non-overlapping, real paths; symlinked outputs, cache components and parents are rejected without following them. A source-only PR runs the Windows boundary tests but does not trigger two expensive native compilations; the full real-GGUF and reproducible PE proof is invoked explicitly with `workflow_dispatch` and is required before any OS-owned artifact promotion. It compiles the same upstream
`llama.cpp` revision for PE x64, runs a real local CPU completion, then
records exact EXE/DLL byte hashes in `candidate-receipt.json`. The receipt
is **unsigned, source-bound evidence only**, excludes model bytes, never
activates a service and cannot supersede the existing Linux ELF pin.
The OrdaX OS source lock is the sole authority for any future Windows
artifact hashes and distribution decision. Do not use CI output directly
as an executable OrdaX product without an OS-owned versioned trust gate.

### Reprodutibilidade PE (Windows MSVC)

No Windows, o linker MSVC normal gravou o tempo de build no cabecalho PE
(verificado em `llama-server.exe`). Isso invalida SHA-256 de artefato imutavel.
O target Windows usa `/Brepro` para executaveis e DLLs e o gate do CI
executa **duas builds independentes**, cada uma com inferencia GGUF real,
exigindo identidade exata de todos os pares `nome/tamanho/SHA256` (no mínimo nove arquivos obrigatórios).
Divergencia reprova CI e nunca altera o source lock automaticamente.
O OS deve republicar seus pins Windows apenas apos esta prova; a
distribuicao e ativacao continuam exclusivamente sob a autoridade do OS.

A primeira prova dupla da PR #12 mostrou que `/Brepro` sozinho nao basta:
`llama-server.exe` permaneceu byte-identico, mas todas as DLLs divergiram
entre diretorios temporarios diferentes. O compilador MSVC recebe agora
`/pathmap` para normalizar registros de caminho fonte/debug, alem do linker
reprodutivel. O log real do run 40644119781 revelou que MSVC ignora `/pathmap` sem
`/experimental:deterministic` (warning D9007). Ambos os flags agora sao
passados conjuntamente para C e C++; os hashes so podem ser promovidos
apos duas builds e duas inferencias reais aprovadas. Nenhum hash anterior
deve ser promovido por aproximacao.

A CI #40646618487 confirmou a origem da divergência nos hashes das DLLs:
sete DLLs variavam desde o timestamp/hash do cabeçalho PE, e a inspeção
binária mostrou caminhos absolutos do workspace temporário embutidos nas
strings `__FILE__` do próprio código C/C++ do upstream. A geração inicial
usava diretórios aleatórios diferentes a cada build; isso altera um insumo
do compilador. O builder agora usa um caminho de fonte/build canônico
**para cada uma de duas compilações independentes**, apaga integralmente
objetos/árvore entre elas e reprova se encontrar workspace já existente.
Continuam obrigatórios o modelo GGUF real, o commit fixado, todos os arquivos PE/DLL obrigatórios
iguais nome/tamanho/SHA-256 e os flags MSVC de determinismo; não é
normalização posterior, edição de PE nem exceção do gate. Os recibos
continuam separados e sem autorização de ativação/distribuição.

No Windows, a prova #40648073217 revelou `WinError 5` na exclusão de
`cache/llama.cpp.git/objects/pack/*.idx` durante o cleanup, após compilar.
O Git mirror é agora cache de aquisição **verificado pelo mesmo source lock**
fora da árvore de objetos, não segundo source owner. Cada uma das duas
compilações continua a fazer checkout de source novo, build novo e exclusão
integral do workspace canônico; só o mirror Git e o GGUF SHA-verificado
persistem entre as duas provas. Isso elimina o acoplamento do cleanup do
build à posse temporária dos packs pelo Git/Windows, sem reaproveitar binários.
