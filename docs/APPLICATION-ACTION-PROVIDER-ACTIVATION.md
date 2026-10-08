# Application Action Provider Activation Foundation

## Purpose

This slice introduces an explicit platform-owned activation boundary after verified provider artifact resolution. It does not activate, import, load, mount, invoke, execute, authorize, grant, or confirm provider code.

The current provider manifest contract still requires execution to be unavailable. Therefore the activation v1 state is intentionally limited to an unavailable, broker-only, authority-free result.

## Canonical chain

preparation resourceRef
-> verified provider binding
-> verified provider artifact resolution
-> provider activation broker
-> unavailable

There is no Action Adapter, approval, grant, Action Gateway, Action Executor, or provider invocation added by this slice.

## Contracts

The activation record uses schema ordax.application-action-provider-activation/1.

It wraps the exact validated provider artifact resolution and requires:

- providerExecution = unavailable
- state = unavailable
- brokerOnly = true
- authority = none
- executionAuthorized = false
- modelDirectExecutionAuthorized = false

The broker port uses schema ordax.application-action-provider-activation-broker/1 and exposes only resolve(resourceRef).

The contract rejects side-channel methods including activate, execute, invoke, import, load, loadAdapter, grant, authorize, confirm, mount, and registerAdapter.

## Live verification

For every broker resolution:

1. resolve the current verified provider artifact;
2. resolve current verified application semantics;
3. require the same first-party owner, app/version/sourceCommit/component revision;
4. require the same Action capability/provider identity and provenance;
5. require the provider manifest execution state to remain unavailable;
6. require the same module path and SHA-256;
7. resolve the provider artifact again and reject any identity drift.

The broker never evaluates provider bytes.

## Native Personal OrdaX composition

The Native Personal OrdaX composition now mounts this broker only when the existing verified provider artifact resolver is available.

It reuses the same live `resolveVerifiedApplicationSemantics(appId)` source and the same injected canonical first-party owner used by provider binding and artifact resolution. No second owner constant, provider registry, permission store, grant issuer, executor or receipt system is introduced.

The only new Personal OrdaX surface is:

`resolveApplicationActionProviderActivation(resourceRef)`

That method performs a read-only broker resolution and returns the v1 unavailable activation record. If verified provider artifact resolution is not configured, the method fails closed instead of synthesizing activation state.

The composition does not expose `activate`, `deactivate`, `import`, `load`, `loadAdapter`, `mount`, `registerAdapter`, `invoke`, `execute`, `grant`, `authorize` or `confirm` for Application Actions.

## Future boundary

A future schema may add a broker-only executable state only after the package/provider manifest contract explicitly supports it.

That future work must not bypass the existing Personal OrdaX authority path. Executable Application Actions must eventually adapt into the existing ordax.action-adapter/1 boundary and continue through approval, scoped grant, Action Gateway, Action Executor, and receipt verification.

Changing execution from unavailable is therefore a separate gated design change, not an extension hidden inside this foundation.


## Resolução assíncrona limitada ao contexto vigente

A composição Native agora reconcilia e verifica a **mesma preparação e o
mesmo binding de Work** tanto antes quanto depois dos `await` de
`resolveApplicationActionProviderArtifact()` e
`resolveApplicationActionProviderActivation()`.

O fence captura a geração transitória do contexto da composição, owner,
revisão do Work e identidade da preparação. Se ocorrer troca A → B → A de
identidade/Space/Project, revogação da preparação, conclusão do Work ou
`dispose()` durante a verificação de SHA/metadados, a resolução falha
fechada sem devolver o resultado antigo. O fence não persiste autoridade,
não cria grants nem outra fonte de verdade para identidade.

A proteção amplia a verificação já existente no binding canônico, sem
carregar nem invocar o provedor. Os testes de regressão
`tests/test_application_action_provider_binding_composition.mjs` exercitam
troca de identidade durante a resolução, ativação com contexto antigo e
revogação durante o hash. O estado de ativação **continua unavailable**:
o contrato de execução e a autorização de ações reais não são alterados.
