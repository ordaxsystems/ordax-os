# Action Review

Action Review is a shared OrdaX safety layer that evaluates an already-typed action separately from authorization.

It answers a different question from Action Gateway:

- Action Gateway: **is there valid authority for this exact action?**
- Action Review: **should automation proceed, require a human, or be blocked even if authority exists?**

Review outcomes are:

- `pass`;
- `needs-human`;
- `block`.

Every result and aggregate verdict carries `authority: none`. Review can only reduce automation and never issues a grant or replaces Action Policy.

## Security invariants

- reviewer failure does not silently pass; it becomes `needs-human`;
- malformed or differently-bound reviewer output is treated as reviewer failure;
- the most restrictive reviewer outcome wins;
- prompt/model/Memory/profile/project content cannot become authority through review;
- a `pass` verdict still requires normal Action Policy and Action Gateway authorization;
- apps such as Studio must consume this shared service rather than implement a private review stack.

This foundation does not yet install model-based reviewers, user-editable reviewers or cloud review providers. Those are adapters that may be added later without changing the authority boundary.
