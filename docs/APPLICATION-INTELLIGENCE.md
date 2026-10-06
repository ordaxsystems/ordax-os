# Application Intelligence

Status: **FOUNDATION / AWARENESS ONLY**

OrdaX should let Intelligence understand applications without giving the model direct operating-system authority.

The model must never call Wine, a shell, a raw executable path or an application IPC endpoint directly. Application identity, semantic actions and execution authority are separate layers.

## Target architecture

```text
user request
  -> OrdaX Intelligence
  -> Application Intelligence Awareness
  -> future App Action Broker
  -> policy / grants / confirmation
  -> application adapter
       -> first-party OrdaX adapter
       -> verified Windows compatibility adapter
```

The same application identity is used by launcher/search and Intelligence. A Windows application therefore does not need to be rediscovered by process path or guessed from window text every time.

## Registration and recognition

A committed installed application receives a stable OrdaX application id through `ordax.installed-application/1`.

Application Intelligence projects a bounded semantic view of the current catalog:

- stable app id;
- title;
- source class (`first-party` or `installed`);
- platform (`ordax` or `windows`);
- publisher when known;
- whether compatibility infrastructure manages the app;
- semantic actions that have actually been proven by a future action provider.

Compatibility internals are deliberately not prompt context. The model does not need prefix paths, runtime ids, raw entrypoints or payload hashes to understand that `photoshop` is an installed Windows application.

Exact app identity is resolved by stable id or exact title. Fuzzy natural-language interpretation may be performed by Intelligence, but any future action request must resolve back to one unambiguous stable app id before policy evaluation.

## Low-latency semantic routing

Application knowledge is split into two local layers so adding apps does not make every prompt progressively heavier.

The always-present application catalog contains only compact identity plus declared intent ids. Full instructions, examples and parameters are precompiled per app and injected only when the local semantic router selects that app as relevant to the current request.

Routing is deterministic local infrastructure:

- manifests are validated when the composition is built;
- lexical postings are compiled once in memory;
- matching uses bounded normalized tokens and exact app-title boosts;
- at most three app detail blocks are selected per request;
- routing performs no model call, embedding generation, filesystem scan, Git operation, Store lookup or network request;
- detail context remains `authority=none` and `toolExecution=false`;
- execution authority remains a separate future/broker boundary.

For example:

```text
"Abra uma nova aba no YouTube"
        ↓
local precompiled semantic router
        ↓
candidate: internet
        ↓
inject only internet semantic detail
        ↓
OrdaX Intelligence
```

This is deliberately different from asking the model to inspect every installed app on each turn.
## This is not AI memory

The installed-application catalog is lifecycle state, not learned model memory.

If a user installs an application, OrdaX records the application because the application exists. Intelligence can receive that current catalog as system context. It does not need to "learn" permanently that the app exists.

User-specific facts such as preferences or repeated workflows belong to the existing authorized-memory path and require its own authorization rules. Application installation must not silently create arbitrary personal memory.

## Native applications

First-party apps can be designed with explicit semantic integrations from the start.

Future native app action providers may expose bounded actions such as:

- open a document;
- create a note;
- search a project;
- navigate to a browser resource;
- export a known document type.

Those actions should be typed product contracts, not UI coordinates or shell snippets.

The model describes intent. The App Action Broker validates the requested action, parameters, current Space/session, permissions and confirmation policy before an adapter receives anything.

## Windows applications

Windows applications use the same semantic model, but action availability must be discovered or supplied by a verified integration rather than assumed.

Expected integration levels are:

1. **Identity only** — the app is installed and Intelligence can name/explain it. This is the level implemented by this foundation.
2. **Generic lifecycle** — future broker-proven open/focus/close/open-target actions that OrdaX itself can provide safely.
3. **Verified app integration** — version/identity-bound adapters for documented CLI, URI, IPC or file-association behavior.
4. **Accessibility automation** — a possible bounded fallback only when a compatible accessibility surface is proven. It must be treated as less stable than explicit APIs and must not become an unrestricted desktop-control escape hatch.

No Windows app receives semantic capabilities merely because Wine can start it.

A vendor update that changes the application identity/version may invalidate an app-specific integration until it is reverified.

## Example

A future request:

```text
"Abra o Photoshop e abra a imagem banner.png"
```

should be interpreted as approximately:

```text
app = resolve stable installed id "photoshop"
action 1 = application.open
action 2 = document.open-target(pathGrantId=...)
```

not:

```text
wine C:\\Program Files\\Adobe\\Photoshop.exe banner.png
```

The raw compatibility command remains an implementation detail behind a verified adapter and sandbox.

A more advanced request such as:

```text
"Redimensione a imagem para 1080x1080 e exporte em JPG"
```

is only actionable if a verified Photoshop integration actually declares equivalent semantic actions. Otherwise Intelligence may explain the steps, but must not pretend it has an automation capability.

## Security invariant

The local model remains consultative today: `ordax.intelligence/1` requires `authority=none` and `toolExecution=false`.

This foundation preserves that rule. `ordax.application-intelligence-awareness/1` requires both:

- `actionExecutionAuthorized=false`;
- `modelToolExecutionAuthorized=false`.

The awareness port rejects execution-like methods (`execute`, `invoke`, `run`, `launch`, `shell`, and related mutation methods).

A future action system must therefore be a separate broker with explicit authority, audit and confirmation policy. Enabling such a broker must not silently broaden the Intelligence contract itself.

## Current implementation

Implemented now:

- unified awareness descriptors for first-party and installed Windows applications;
- exact stable-id/title lookup without fuzzy execution targeting;
- compact, precompiled application catalog for the Intelligence hot path;
- version-bound semantic manifests for bundled first-party apps;
- verified package semantics for externalized first-party apps such as Studio/Notes;
- bounded local semantic routing that selects at most three relevant app-detail blocks per request;
- installed payload identity remains validated but is not leaked into model context;
- compatibility profile/runtime/entrypoint internals are not exposed to the model;
- semantic manifests remain declarative and do not become proven executable action capabilities;
- no model/app execution authority.

Not implemented by this foundation:

- App Action Broker;
- generic application lifecycle executor;
- Windows app integration recipes/adapters;
- accessibility automation;
- user confirmation UI for AI-requested actions;
- audit receipts for executed app actions.

Those should be introduced in that order rather than by granting direct tool execution to the model.
