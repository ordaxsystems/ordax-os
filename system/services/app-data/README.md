# App Data service foundation

`ordax.app-data/1` is the app-facing boundary for private device-local state owned by independently delivered applications.

It is intentionally **not** Memory, File Space, Account Sync, credentials storage, or a generic filesystem escape hatch.

## Identity and isolation

A runtime creates a bound App Data port for exactly one `(publisherId, appId, device)` partition. App calls never supply a different `appId` or publisher on individual operations.

The runtime port is an operational capability: possession of the injected port permits bounded mutation of that one partition. A package, catalog entry, Store UI, manifest, model output, or SDK descriptor does not create that capability.

Production `publisherId` must be derived from the verified package/install owner. It is not accepted as a self-claim from the app request body.

## State model

The v1 app-facing model is a bounded key/value partition of opaque bytes with a partition-wide monotonic revision. Every mutation is compare-and-swap against that revision. Hard protocol ceilings are safety bounds, not subscription quotas; production quota policy remains an owner decision below those ceilings.

The Native owner does **not** rewrite a whole app snapshot for each change. Each hashed app partition contains a small authoritative manifest plus immutable SHA-256 content-addressed blobs. A mutation writes and verifies the new blob first and commits only by atomically replacing the manifest. Unreferenced blobs or temp files left by an interrupted write are never authoritative and are collected on a later successful mutation.

Reads and list operations do not materialize missing partitions. Mutations use a per-partition lock, fsync, atomic manifest replacement and directory fsync. Symlinks, permissive targets, corrupt manifests and blob digest mismatches fail closed.

**Recuperação da autoridade do manifesto:** a primeira operação de escrita preserva, antes de qualquer dado de aplicativo, um manifesto gênese vazio (revisão zero) confirmado em disco. Uma partição **já existente** sem `manifest.json` é tratada como corrompida e bloqueada; jamais é reinterpretada como recém-criada para aceitar `put`/CAS com revisão zero. Isso também protege o checkpoint da geração vazia quando o manifesto ativo desaparece. A ausência da partição inteira continua sendo o único estado inicial vazio válido para leitura, sem criação física. Uma interrupção durante a própria criação da partição, antes da persistência do manifesto gênese, também falha fechada na recuperação — exige intervenção explícita do owner, nunca reset automático de dados.

**Integridade física da partição:** o `lock` de uma partição existente não pode ser recriado quando ausente: outro processo pode ainda manter o bloqueio exclusivo no inode original, e um lock novo quebraria a exclusão mútua. O diretório `blobs/` também não pode ser recriado se desaparecer, pois o manifesto atual poderia continuar apontando para dados perdidos. Leitura, escrita e recuperação falham fechadas nesses casos, preservando o manifesto e o checkpoint para investigação e recuperação explícita pelo owner. Isso inclui a rota pública `get`/`list`: uma partição já existente sem `lock`, mesmo que o manifesto também tenha desaparecido, nunca pode ser apresentada ao aplicativo como uma revisão zero vazia. Somente a ausência completa da partição mantém a leitura inicial não materializada.

## Recuperação transacional interna do owner (candidata)

A geração inicial vazia (revisão 0) também pode ser preservada
antes da primeira gravação de dados; sua restauração exige CAS,
retorna a partição a zero chaves e avança a revisão monotônica.
Essa proteção evita exigir dados inventados para iniciar um update stateful.

O próprio owner Native agora dispõe das funções privadas
`create_app_data_checkpoint`, `restore_app_data_checkpoint` e
`retire_app_data_checkpoint`. Essas funções **não** são ações do
`ordax.app-data/1`, não são expostas pelo endpoint e não permitem que o
aplicativo solicite restauração. São peças de persistência para futura
orquestração segura pelo owner Native/State.

Cada partição mantém **um único manifesto ativo** e, no máximo, **um
checkpoint não autoritativo** (`checkpoint.json`) vinculado à identidade
da partição, à versão/commit de origem e ao manifesto exato salvo.
A gravação do checkpoint e a troca do manifesto são duráveis (fsync,
rename atômico); todos os blobs retidos são identificados e verificados
por SHA-256. Enquanto existir checkpoint válido, a coleta de lixo
considera os blobs apontados **tanto pelo manifesto ativo quanto pelo
checkpoint**. Alterações e exclusões comuns jamais podem descartá-los.

A restauração exige referência exata do release de origem, revisão
atual CAS, verificação completa dos blobs e avança monotonamente a revisão
do manifesto ativo. Interrupção antes ou depois do commit conserva uma
geração consistente. A aposentadoria do checkpoint só acontece por
chamada interna explícita e sincronizada; após fsync da remoção, o GC
pode liberar os blobs antigos. Pin inválido, symlink ou corrupção
bloqueiam mutações, sem descarte preventivo de dados.

**Inspeção privada, somente de leitura:** `inspect_app_data_checkpoint`
consulta a identidade vinculada, exige a revisão CAS esperada, verifica
todos os blobs da geração ativa **e** da geração retida sob `flock`
compartilhado e retorna os SHA-256 dos bytes efetivos de `manifest.json` (geração atual)
e `checkpoint.json` (geração retida), além das revisões e da referência
de release. Sob `flock`, os dois digests vinculam os conteúdos observados
na mesma inspeção e mudam quando o manifesto atual é confirmado. Não retorna valores/chaves
de aplicativos; o resultado declara explicitamente `authority: none`.
A inspeção não é ação do endpoint e não modifica dados. Sua validade é
pontual: quando o lock é liberado, a geração pode mudar. SHA-256 e
`sourceRelease` **não constituem assinatura Ed25519, autorização
do State owner ou lease de atualização**. A futura integração com o
writer Go deverá fazer verificação de confiança, travar sua transação,
vincular o owner da instalação e revalidar todos os dados imediatamente
antes de qualquer mudança de ativação.

**Prova cruzada com o atualizador oficial:** o workflow
`.github/workflows/native-app-data.yml` agora executa também regressões
reais em Go do mesmo writer `tools/runtime-component-channel`: upgrade
com estado inalterado, criação de novo estado persistente, prevenção de
upgrade sem caminho de retorno e rollback cuja faixa de leitura parece
compatível. Todos devem continuar bloqueados até existir recuperação de
State verificada e transacional. Esses testes protegem contra concessão
acidental de autoridade à inspeção diagnóstica; **não afirmam** que o
caminho de recuperação já foi conectado ao Go.

**Limites importantes:** o valor `sourceRelease` armazenado é uma
referência de correlação recebida pelo owner, **não uma assinatura
verificada nem autorização de instalação**. A ativação do componente Go,
a política de retenção, a confirmação da origem assinada, a interação
com processos abertos e a autorização para eventualmente reverter dados
do usuário **não estão conectadas a essas APIs**. Consequentemente,
o rollback de componentes com estado persiste bloqueado no writer Native.
A fronteira `/ordax/home` continua separada; isto não é backup de
arquivos pessoais.

## Transport

`native_app_data_endpoint.py` defines the typed JSON boundary, but it deliberately accepts the app identity as a trusted host argument rather than from JSON. Request bodies contain only `action`, keys, bytes and revisions.

`system/adapters/native/app-data.mjs` is an async adapter for an opaque runtime-injected endpoint. It verifies that the store cannot be retargeted after binding and never serializes publisher/app identity into requests.

The Native route is now wired by `native_app_data_host.py`. Verified current-boot install identities are bound to opaque capabilities by trusted composition, and apps receive only the typed `ordax.app-data/1` port. The opaque endpoint is not exposed in app context.

## Lifecycle

App payload lifecycle and user data lifecycle stay separate:

- install does not grant access to another publisher/app identity;
- update cannot destructively rewrite data in-place by default;
- uninstall preserves App Data unless the user separately requests data removal;
- reinstall can reuse preserved data only for the same trusted app identity and policy;
- app rollback does not silently rewind user data.

## Current status

Implemented and tested:

- in-memory reference store and bound public port;
- private atomic Native manifest/blob owner;
- typed endpoint helper with no request identity self-claims;
- async Native adapter using an opaque bound endpoint inside trusted composition;
- verified install/publisher binding and one-shot current-boot port injection;
- active Native host route for the trusted first-party composition;
- App SDK 1.6.0 publication of `ordax.app-data/1` without transport authority;
- crash/orphan, reboot, CAS, quota, corruption, symlink, content-integrity and isolation regressions;
- single-key updates do not rewrite unrelated values.

Still deliberately incomplete:

- independent install/update/rollback/reinstall lifecycle proof for external app packages;
- third-party realm/origin isolation and enablement;
- Store integration;
- Notes migration/cutover.

Notes remains the first migration candidate because its current specialized Native/Web persistence demonstrates why the platform needs a generic App Data boundary instead of one core endpoint per app.
