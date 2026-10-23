# OrdaX Local AI

Local AI is the default **AI Runtime / Inference Broker** for Stable/MVP. It is part of the target distribution, but it is never a boot dependency.

The backend boundary is `ordax.local-ai/1`. Product surfaces do **not** own this backend and should consume `ordax.intelligence/1` through the OrdaX Intelligence service. The inference backend must not leak llama.cpp, OpenVINO, a specific model vendor, or a cloud API into product semantics.

## Initial implementation direction

The first runtime target is `llama.cpp` with a small GGUF model. The current
candidate is Qwen3.5-0.8B-class so the first MVP does not assume a discrete GPU.
No engine/model bytes are accepted into a release until their exact SHA-256,
size, upstream source and license are pinned in the signed Stable release artifact contract.

The service listens on loopback only. Native Surface calls the exact
`/__ordax/native/local-ai` same-origin Host bridge (GET health/models, POST
chat completions) rather than using cross-origin browser requests to port 17865.
The Native Host applies its existing Host/Origin/Fetch-Site policy and bounds
payloads; the bridge never exposes the boot-generated private bearer key to the browser.
Stable Base creates the key in /run/ordax/local-ai-auth/key (0600, ephemeral),
then passes its **path** to the pinned llama.cpp server through the documented
LLAMA_ARG_API_KEY_FILE startup variable. Native Host reads it with O_NOFOLLOW,
owner/mode/size validation and attaches Authorization only to the fixed
loopback upstream requests. The system degrades Intelligence (not boot) when
secret generation or validation fails. The raw backend rejects unauthenticated
completion requests; CI verifies this with the exact pinned binary.

This still is **not** full cross-process sandboxing: another local process
may forge headers when connecting to the Native Host, and privileged processes
may read their own process-owner secrets. App sandbox/network namespace or a
credentialed local IPC layer requires a separate security gate.
Because the native inference server starts independently of the Surface,
`system/services/local-ai/probe-supervisor.mjs` owns the initial read-only
readiness probe and bounded 2–60-second recovery retries. It stops scheduling
when ready/busy, resumes after backend degradation, and cancels pending work
during Surface teardown. It never replays a user prompt or runs generation.
Prompt content stays local by default.
There is no implicit cloud fallback, filesystem access, tool execution or
prompt telemetry.

## Migration

Engine and model identities are separate. A future release may replace
llama.cpp with OpenVINO or another local provider, and may replace the model,
without changing the Surface contract or user-facing assistant identity.

The model is stored outside `system.erofs` in a separate content-addressed `local-ai-runtime.erofs`, not inside `system.erofs`, so its engine/model bytes can evolve without bloating or redefining the shared system image. Stable/MVP product policy still requires a verified local inference payload to be included; independent updateability does not make the capability an optional product feature.

## Creator and delivery

Stable/MVP Creator does not expose an option to omit system Intelligence. Once the signed engine/model bundle is promoted, it is materialized as part of the product payload. Users may later change or upgrade a model/engine through a governed update path, but that is different from shipping a product without its Intelligence layer.

The real runtime is reproducibly proven in CI and the Portable v2 boot handoff now supports exact release-manifest v4 verification, read-only mounting under `/run/ordax/runtime/local-ai`, and loopback backend startup. Local-AI mount/start failure degrades Intelligence and does not block the operating system. This source-complete handoff still does not prove that a signed Stable v4 has been materially promoted or placed on a physical USB; signed Stable materialization, disposable v4 boot proof and real-hardware proof remain release gates. No boot path silently downloads the model.

## Default installation, removal and reinstall policy (source design; not live yet)

**Distribution default:** Creator's Stable/MVP v4 artifact plan includes the exact
signed `local-ai-runtime.erofs`, independently of `system.erofs`. The default
user experience must include Aura inference in the first offline boot; no
first-run model download, model selection or optional Creator omission. The
Owner/Development USB uses another seed/acquisition path and is **not yet
physically proven** to have its model preinstalled.

**After installation:** model/engine bytes must be individually manageable;
`ordax.intelligence/1`, its model router, `ordax.local-ai/1`, and the user's
Memory remain system-owned. Removal is an explicit user operation, not a
Creator opt-out. It must quiesce inference, unmount the verified payload,
persist a removed-by-user state through reboot and OS updates, and reclaim
only unreferenced inactive content-addressed bytes. Do not delete account
information, Memory, preferences or user files. Reinstallation must reuse a
verified offline artifact when present, otherwise acquire the same signed
artifact and verify it again; no silent reinstall on an update.

**Existing blocker:** the current portable v4 exact release verifier and boot
selector require the signed local-AI blob to be present before accepting the
whole release. Deleting it today would risk rejecting boot. The implementation
must first decouple boot-system verification from post-install model presence
through a **versioned and tested** protocol change, while retaining signature,
hash and anti-downgrade checks on the model whenever it is activated. Never
implement “Uninstall” as a shell `rm`, arbitrary writable manifest edit, or
silent relaxation of the current v4 verifier. Reuse the existing component
lifecycle/activation state authority when the EROFS package size, trust and
pending-health promotion are supported; do not create another model updater.

The current implementation status and the exact missing gates are
machine-readable in `docs/contracts/local-ai.json#post_install_lifecycle`.
