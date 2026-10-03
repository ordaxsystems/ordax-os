# Action Policy

Action Policy is a shared OrdaX system service that can only **reduce automation**. It is not an authority source and it never issues grants.

The policy engine evaluates an already-typed `ordax.action-request/1` and returns an authority-free verdict:

- `allow-if-authorized`: policy does not add a restriction; the caller still needs the normal authority required by the Action Gateway;
- `approval-required`: explicit approval/grant is required before execution;
- `handoff-to-user`: automated execution is blocked and the operation must be performed by the user;
- `deny`: execution is forbidden.

Rules may be scoped to core security, device, user or Work context. Multiple matching rules are combined by choosing the **most restrictive** outcome, so a lower layer cannot relax a higher restriction.

## Security invariants

- verdicts always carry `authority: none`;
- prompt, model, Memory, profile or project content cannot create policy authority;
- a permissive rule never replaces a grant;
- a policy failure is handled fail-closed by the Action Gateway;
- a policy verdict must remain bound to the exact Work and action;
- external egress and device-control remain subject to their existing hard Action Gateway restrictions;
- the service is shared infrastructure and must not be reimplemented inside Personal OrdaX, Studio or another app.

This foundation intentionally does not persist editable user rules or expose a settings UI yet. Those surfaces can be added only after their storage, sync, versioning and downgrade semantics are defined without weakening the core policy hierarchy.
