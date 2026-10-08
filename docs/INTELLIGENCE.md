# Ordax Intelligence

Status: **MVP SYSTEM FOUNDATION**

Ordax Intelligence is a system capability, not an application.

The first-party Assistant may later provide a conversational Surface, but it is
only a client. Files, Notes, Search, Settings, diagnostics and future automation
may consume the same system intelligence contract without opening an Assistant
window.

## Layering

```text
Surface / applications
 -> shared OrdaX services and Workspace context
 -> Ordax Intelligence
 -> model router
 -> AI Runtime / local inference backend
 -> llama.cpp + verified local model (initial implementation)
```

`ordax.intelligence/1` owns product intelligence semantics. The inference
backend remains behind `ordax.local-ai/1`. Engine and model may therefore be
replaced without redefining the OrdaX Intelligence contract.

## MVP policy

The Stable/MVP distribution is expected to include local inference by default
as part of the product. It is **not** a Creator opt-out feature.

This does not make AI boot-critical. A missing, incompatible or failed model
must degrade Intelligence while the operating system, recovery, files and
updates remain usable. The signed engine/model payload and its actual Stable USB
materialization are separate release gates and must not be claimed merely
because the source contract exists.

The initial source lock targets a small Qwen3.5 GGUF profile served by
`llama.cpp`, so the first MVP does not assume a discrete GPU. A later signed
update may replace the model, quantization or inference engine without changing
the stable Intelligence API.

### Troca de modelo, atualização e distribuição comercial

O contrato `ordax.intelligence/1` é estável em relação a modelos. O MVP fixa
**um** motor e **um** modelo no `source-lock.json` para reprodutibilidade,
não por imposição de permanência. O builder inicial valida especificamente
`llama.cpp` + `Qwen3.5-0.8B-Q4_0.gguf`; aceitar outro engine, quantização
ou modelo requer atualizar o builder e os gates de compatibilidade com
revisão de contrato. Hoje a substituição deve ser distribuída como release
assinado do sistema. Seleção arbitrária de modelos na interface, download em
runtime e atualização por component-slot são **capacidade futura**, não recurso
liberado do MVP. O Memory SSOT persiste separado do modelo; índices derivados
de embeddings devem ser invalidados/recriados quando a identidade mudar.

O candidato de inferência inclui `llama.cpp` sob MIT e o GGUF Qwen3.5-0.8B
sob Apache-2.0, com origem, commit/revisão, hash e tamanho fixados. Ambas
são licenças permissivas para distribuição comercial, condicionadas à
preservação dos textos de licença e avisos aplicáveis; não concedem
direitos de marca e não cobrem automaticamente dependências, plugins ou
modelos opcionais futuros. O builder copia a licença MIT da fonte exata
do motor e `third_party/licenses/Apache-2.0.txt` para o EROFS assinado
em `licenses/`. A validação do candidato MVP exige coincidência exata
entre `model.license=Apache-2.0` e o texto vendorizado; uma futura escolha
de outra licença exige uma revisão explícita, não renomear um manifesto.
Revisar quaisquer NOTICE/copyright adicionais, dependências transitivas
e textos exibidos ao usuário é um gate de distribuição do **produto inteiro**,
não uma alegação de aprovação jurídica automática.

Para apps: `ai/manifest.json` e `actions/manifest.json` verificados alimentam
somente conhecimento, intents e propostas. A presença de módulos de provider
no pacote não equivale a execução autorizada: grants, confirmação, executor
e recibos continuam governados pelo Personal OrdaX/Action Gateway. Apps sem
slot instalado/verificado não ganham capacidades fictícias. O CI valida
manifestos e identidades, mas a operação ponta a ponta com um pacote físico
e uma conta/sessão real permanece gate separado.

The release layer has a dedicated v4 source contract for this payload.
`prototype-ordax.release-manifest/4` keeps the system image and Surface runtime
semantics from v3, adds `local-ai-runtime.erofs`, and signs a binding to the
canonical engine/model source lock. Surface and AI runtimes are independently
content-addressed and verified. The real engine/model EROFS is reproducibly proven
in CI, and the Portable v2/Stable Base handoff now supports exact v4 verification,
read-only mounting at `/run/ordax/runtime/local-ai`, and non-boot-critical loopback
backend startup. A dedicated non-promotional CI gate now signs a v4 envelope with
an ephemeral CI-only key, materializes the three artifacts over loopback HTTPS using
the real built AI EROFS, revalidates the release offline and byte-compares the
content-addressed stored AI runtime. This still does not claim a promoted Stable/MVP
artifact: canonical-key Stable v4 signing/materialization plus disposable v4 boot and
physical proof remain release gates.

## Memory and model routing

The pre-MVP foundation separates persistent product memory from inference providers:

```text
ordax.intelligence/1
  +-- ordax.memory/1
  +-- ordax.model-router/1
        +-- ordax.local-ai/1
        +-- OpenAI adapter (future)
        +-- xAI adapter (future)
        +-- future providers
```

The source-level model router is active in the Intelligence runtime. MVP requests map the
Intelligence intent to a provider-neutral purpose and resolve the active local model through
`ordax.model-router/1`. A route is executable only while the local backend is actually `ready`;
`busy`, `stopped`, `error` and `unavailable` fail closed. External providers remain fail-closed
even when an egress approval is present because their runtime adapters are not enabled yet. A
local route binds both `engineId` and `modelId`; the result must match both identities, so a silent
engine or model change between routing and inference fails closed while normal engine/model
migration between releases remains behind the same stable Intelligence boundary.

Memory belongs to OrdaX. llama.cpp, GPT, Grok or another model may receive authorized context, but none of them becomes the owner of persistent memory.

Memory scopes are device, account, Space, project and session. Ownership is an explicit pair:
`ownerKind=device` has no account `subjectId`, while `ownerKind=account` requires the authenticated
account subject. This lets local-only/offline mode own device, Space, project and session memory
without inventing a fake account identity. Device-owned memory cannot request the `account` scope
and is never eligible for implicit cloud sync; account-scoped memory requires an account owner.
Update, delete, review and retrieval compare both owner kind and owner id.

Signing in adds an account owner; it does **not** replace the device owner or migrate device memory.
The owner resolver always keeps the trusted device owner available and exposes the authenticated
account owner only while the identity session is actually signed in. Signing out drops the account
owner and review state falls back to device memory. Any future migration/copy between those owners
must therefore be an explicit product operation, not a side effect of authentication.

Persistent items carry provenance, source timestamp and sensitivity. The source-level memory
runtime implements bounded `search`, `remember`, `forget` and `flush` over `ordax.memory/1`, with a
bounded `ordax.memory-store/1` snapshot boundary. Search applies owner/Space/project filters before
local lexical ranking, restricted items require explicit inclusion, item IDs cannot change owner,
and device stores never persist session-scoped memory. Search is paginated through a bounded
offset instead of raising the result cap, so user review can reach older items without creating an
unbounded read.

Manual Memory entry is also explicit and user-owned. Account → Memory may create a new item only for the currently selected personal owner boundary: device owner creates `scope=device`, authenticated account owner creates `scope=account`. Manual entry cannot silently create Space/project/session memory, and persistence still passes through the same `flush()` durability confirmation.

A dedicated memory-review runtime owns the user-review semantics above the stable port. It can
list, edit and remove only inside one explicit owner/Space/project boundary. The user may also
clear every item for the currently selected owner after an explicit destructive confirmation; the
operation preflights the complete bounded owner set before the first delete, never crosses owners,
and routes each deletion through the same durable mutation boundary. It does not claim a
multi-item transaction. Editing may change
content, provenance and sensitivity, but cannot silently change item identity, owner kind, owner
id, kind, scope, Space or project. Review of more than one page walks the same bounded search API
instead of gaining a privileged bypass. A review-session layer switches explicitly between the
currently available device/account owners, and a Surface-ready view model adds bounded search,
one-item pagination lookahead and generic `idle/pending/saved/error` persistence state. That is
presentation plumbing only; a visual review surface is still not claimed as mounted in the MVP.

Secret material is not memory. The contract rejects explicit secret items and known private-key
or token-shaped material in both **content and provenance** before either can enter persistence or
model context. Semantic embeddings remain derived indexes: replacing an embedding model does not
change the identity of the underlying memory item.

The source foundation now defines `ordax.semantic-index/1`. The index is explicitly
not a source of truth: each vector is bound to a source kind/id plus exact content
SHA-256, and the index descriptor binds the embedding model artifact SHA-256,
dimensions and distance metric. A model/artifact/dimension/metric change invalidates
the index and requires rebuild; it never migrates or rewrites Memory items. Structured
owner/Space/project authorization must still run before semantic ranking. Deleting or
rebuilding the index must not delete Memory. Secret material remains forbidden, and
cloud embedding generation would require explicit egress policy.

No semantic runtime is enabled yet; current retrieval remains lexical until an approved
embedding runtime and persistence owner are implemented and proven. The MVP model
router therefore rejects `purpose=embedding` rather than advertising text-generation
inference as an embedding service. This does not change the generic router contract:
an embedding route requires an independently verified implementation before enabling it.

The source also has explicit persistence and retrieval boundaries. Web uses a local browser
memory store. If persistent browser storage is unavailable, its fallback is explicitly
**session-only**: it may keep only `scope=session` items and rejects device/account/Space/project
memory instead of pretending that an ephemeral in-memory value is durable. Native has a dedicated
device-store adapter plus a bounded private state owner for
`/var/lib/ordax/intelligence-memory.json`; that helper rejects session-scoped state, invalid owner
metadata, malformed item fields, duplicate IDs, non-canonical timestamps, secret-shaped content or
provenance, symlinks, non-private targets and oversized payloads. It writes through `0600`
temporary files with file+directory `fsync` and atomic replacement. The JS snapshot contract and
the Native owner share an exact **8 MiB** serialized ceiling, so the runtime cannot accept a
durable snapshot that the host would later reject solely because of payload size.

Store acceptance and durable completion are separate. A synchronous store rejection does not
mutate the memory runtime state. Every store exposes `flush()`: Web/session stores confirm
immediately after their synchronous save path, while the Native adapter waits for its queued POST
and surfaces a host persistence failure instead of swallowing it. Native persistence tracks desired
and durable revisions. If a queued POST fails, `flush()` retries the current desired snapshot once;
a newer successful revision supersedes an older failure, so a redundant retry cannot report a
false failure after the current state is already durable. This keeps `remember()` and `forget()`
synchronous without pretending an asynchronous Native write is already durable.

Authorized memory-to-Intelligence context is a separate boundary. `ordax.memory-context-auth/1`
accepts only authorization produced by the composition layer, including the exact owner kind/id
and allowed device/account/Space/project/session scopes. Retrieval re-checks owner kind/id, Space,
project and restricted sensitivity even after the memory port returns results, caps the context to
eight items and excerpts each item to the existing Intelligence context bounds. Canonical memory
IDs are preserved without adding a prefix, so a valid 160-character memory ID cannot overflow the
Intelligence context-ID bound.

When both device and account context are desired, composition must supply a separate authorization
for each owner. The multi-owner helper never infers the second grant from login state: it retrieves
each authorized owner independently and round-robins the shared bounded context budget, preventing
one owner from silently replacing or starving the other. A user prompt therefore cannot grant
itself access to another owner, Space or project.

Native persistence is now wired end-to-end at the platform boundary: the loopback-only Native host
owns `GET/POST /__ordax/native/intelligence-memory`, delegates validation and private atomic state
ownership to the dedicated memory endpoint/helper, and Native composition probes the device store
fail-soft before creating `ordax.memory/1`. If persistence is unavailable or corrupt, the Surface
and local inference still mount without memory. Native ordinary Intelligence requests now
receive **automatically retrieved but explicitly composition-authorized** Memory context when the
Memory runtime is available: device Memory is always eligible locally, account Memory is added only
for the current authenticated subject, and Space Memory is added only for the exact selected Space
owned by that subject. This is not prompt-granted or model-selected access. Project/session and
restricted Memory are not inferred, and consumer-supplied context keeps priority over Memory within
the shared bounded context budget.

External routes require an explicit egress decision. Local AI remains the offline baseline when an external provider is unavailable or not authorized.

Professional Profile Packs may influence retrieval sources and preferred model purpose, but they cannot bypass Space membership, memory authorization or tool permissions.

Native composition now uses one identity-bound Memory composition with a shared budget. Device memory remains eligible offline and while signed in through an explicit device authorization; a real signed-in identity adds a separate account authorization; an explicitly selected Space adds a third authorization for that exact account-owned Space. No project/session/restricted scope is inferred, and a selected Space whose subject differs from the current authenticated identity fails closed. Native composition now also derives a narrow selected Space Memory authorization from the identity-bound Space selection. It authorizes only account-owned `scope=space` memory for the current `subjectId + selectedSpace.id`, excludes restricted memory, and performs no Memory read while selection is unavailable or absent. This is composition authority, not prompt or Profile authority. Consumer-supplied context keeps priority in the Intelligence budget; selected-Space Memory is supplemental, and Profile content remains supplemental after it.

The source runtime now has a Profile-content context bridge for verified active Knowledge/Skill components. Native revalidates the active component against inventory/receipt, requires the exact immutable content-addressed payload hash, rechecks bounded pack structure and rejects Skill entries carrying tools or authority. The Surface receives only a bounded context projection. Consumers must bind the bridge to an explicit real `spaceId`; no global/current Space is inferred. Existing app-selected context keeps priority in the Intelligence budget. The selected-Space composition now binds Profile content to the explicit identity-bound Space selection at each request; when no Space is selected, Intelligence continues without Profile content rather than inferring a Space. This bridge is currently Owner/Development-only and does not publish or promote any Profile content: the canonical Profile-content trust anchor is still unpinned, and Stable/MVP exposes no Profile-content context endpoint.

## Authority and input boundary

The MVP Intelligence runtime is consultative:

- no implicit file writes;
- no implicit command or shell execution;
- no implicit external network access;
- no package installation;
- no system or disk mutation;
- no silent cloud fallback;
- no privilege gained from prompt text.

The local backend receives these immutable Intelligence rules as an OpenAI-compatible `system`
message, while the user request and authorized provenance-bearing context remain in the `user`
message. This does not make prompt injection impossible, but it stops ordinary context text from
sharing the same message role as the system authority policy. The Local AI client enforces the
runtime endpoint literally before URL canonicalization: only lower-case `http://127.0.0.1` with an
optional valid port is accepted. Hostname aliases, integer/octal/hex loopback forms, trailing-dot
hosts, userinfo, external addresses and HTTPS endpoints are rejected for this local-only port.
Configured `engineId`/`modelId` are validated before any network work, and discovered model identity
uses the same bounded validator.

The Local AI user-message ceiling is 32,768 characters. Intelligence reserves a small render margin
by limiting the direct user request to 32,000 characters, then fits supplemental authorized context
inside the remaining backend budget. The user request is preserved; context is clipped or omitted
first and receives an explicit local-input-budget marker when that happens. A valid large context
can therefore no longer accidentally overflow `ordax.local-ai/1` after Intelligence adds intent,
purpose, provenance and framing metadata.

Backend responses are bounded before JSON parsing in the production fetch path. Model discovery is
limited to **256 KiB** and the OpenAI-compatible completion envelope to **1 MiB**; the accepted
completion text is then limited again to **131,072 characters** and rejects NUL. Streaming body
consumption remains inside the same probe/inference timeout, so a server that sends headers and
then stalls the body cannot bypass the deadline. Oversized/malformed completion data is treated as
an inference failure and receives the same bounded health revalidation as other backend failures.

Backend request failure is not treated as permanent service death. After an inference failure the
runtime performs a bounded `/health` revalidation: a healthy backend returns to `ready`, while a
missing backend degrades to `stopped`. It does not silently retry the failed generation. `probe()`
will not reset a currently `busy` inference, and `dispose()` aborts active fetches and refuses new
probe/generate work so shutdown cannot leave hidden inference requests running.

Memory capture is a separate write boundary from retrieval, but it does **not** require a confirmation dialog for every item. Intelligence may automatically capture a bounded memory draft when trusted composition has enabled capture for the current owner/scope. The model cannot choose owner, account, Space, project or persistent id; composition supplies the exact `ordax.memory-capture-auth/1` target. Initial automatic capture is limited to device/account/Space targets, normal/private preference|fact|instruction|summary items, and secrets remain rejected by the Memory contract. Project/session/restricted capture stays disabled. A capture is considered successful only after `memory.flush()` confirms durability. The user retains control through Account → Memory to review, edit and delete stored items; disabling capture can stop future automatic writes without deleting existing memory.

Context supplied to Intelligence is bounded and carries provenance. Tool execution, agents and broader capability bridges require explicit contracts and permissions before activation. The memory runtime does not grant tool authority and does not bypass current authorization.

The source foundation now defines `ordax.intelligence-tool/1` and
`ordax.intelligence-tool-grant/1`. A tool declares typed read/write actions,
sandbox kind, resource limits and narrow filesystem/network needs. Authority is
a separate grant owned by trusted composition/policy and scoped to an owner plus
optional Space/project. Prompt text and model output cannot mint grants. Write
actions require explicit approval, while generic shell, raw-disk access,
release-key access, trust-anchor mutation and physical-write authorization are
forbidden by contract. The preferred future portable sandbox is a WASI Component
runtime; Native brokers remain possible for genuinely platform-specific
capabilities. This is a source foundation only: tool execution, agent loops and
autonomous mutation remain disabled.

## Nova OrdaX reference

The legacy `novo-ordax-os` architecture correctly separated **Ordax
Intelligence** from the **AI Runtime / Inference Broker** and treated Surface
apps as clients. This prototype reimplements those architecture invariants
clean-room; it does not copy the legacy runtime, agents or permission system.
The exact reuse decision is recorded in `docs/SOURCE-MIGRATION.md`.


### Automatic Memory preference

Native/USB exposes `memory.auto-capture` as an OrdaX preference. It defaults to `on`, is persisted through the canonical preference store, and is read dynamically by the Memory capture runtime before every write. Turning it `off` prevents future automatic Memory capture without deleting existing items. Exact automatic duplicates are coalesced only when owner, scope, Space, kind, sensitivity and normalized stored content are identical; provenance/timestamp differences do not mint another id, and the existing item still must pass `flush()` before success is reported. This is intentionally not semantic supersession: different wording remains distinct until a structured Assistant contract can identify continuity safely. Account → Memory remains the user control surface for review, editing, deletion and manual entry. Automatic capture does **not** require per-item confirmation: the preference is the user's coarse control, while review remains available afterward. The first-party Assistant now invokes an OrdaX-owned automatic extraction boundary only after a successful conversation turn. Memory ownership/Space authorization is bound synchronously at the start of the Assistant turn, before inference, so an account or `Space em uso` change during inference cannot retarget that turn's Memory. The extractor receives only the user's turn; Assistant-generated response text is deliberately excluded as a persistence source. The extraction model can return a small strict JSON candidate set, but every candidate must also carry a bounded verbatim evidence quote copied from the exact user-turn text supplied to the extractor. Composition verifies that quote against the extractor input before capture. For automatic Memory, the candidate `content` must also be exactly identical to that evidence; any model-authored paraphrase, normalization or added fact fails closed. The persisted content is therefore the user's verbatim evidence, while the evidence field itself is discarded as transport metadata rather than stored separately. The candidate output remains data rather than authority: composition chooses device/account/selected-Space ownership, sensitivity is forced to `private`, extra authority-shaped fields are rejected, credential-like candidates are discarded, and `memory.auto-capture=off` skips extraction entirely. Capture failure never turns a valid Assistant answer into a failed answer. Manual deletion is intentionally different because it is destructive: the Surface requires an explicit per-item confirmation before calling the existing owner-scoped remove path. In the MVP this preference is intentionally device-local and is not included in account preference sync; changing that requires a separate privacy/synchronization policy rather than silently making a local Memory decision portable.
