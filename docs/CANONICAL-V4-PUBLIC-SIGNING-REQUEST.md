# Canonical v4 public signing request

Status: public-only assembly gate; canonical private key remains external.

This boundary exists to assemble the Stable/MVP v4 signing request without moving the
large operator EROFS artifacts through a developer workstation or ChatGPT connector.
It does **not** move the canonical private key into GitHub Actions.

The historical, immutable request (for provenance only) is:

```text
docs/contracts/canonical-v4-signing-request.json
```

The only eligible new active request is:

```text
docs/contracts/canonical-v4-signing-request-active.json
```

The validator is:

```text
tools/release-operator/validate_canonical_v4_signing_request.py
```

The assembly workflow is:

```text
.github/workflows/canonical-v4-signing-request.yml
```

## Emitir um novo pedido com verificações do GitHub

Após congelar um SHA na main canônica, executar manualmente os workflows
`portable-release-image.yml`, `surface-runtime-lock-discovery.yml` e
`local-ai-runtime-candidate.yml` na **mesma revisão exata**.
Cada um gera um artifact de operador por `workflow_dispatch` com validade de 1 dia.
Recolher os três IDs das execuções reais e executar:

```bash
GH_TOKEN=<TOKEN-SOMENTE-LEITURA-ACTIONS> python3 tools/release-operator/build_canonical_v4_request.py \
  --source-commit <SHA40-EXATO-DA-MAIN> \
  --system-run <RUN_ID_DO_SISTEMA> \
  --surface-run <RUN_ID_DA_SURFACE> \
  --local-ai-run <RUN_ID_DA_IA_LOCAL> \
  --out docs/contracts/canonical-v4-signing-request-active.json
```

O builder verifica diretamente no GitHub nome canônico do proprietário,
repositório ID `1371063347`, branch main, evento manual, workflow correto,
ancestralidade Git verificável desde o merge de cutover `9eb4dbb` e
permanência da revisão congelada no histórico atual da `main`,
conclusão com sucesso, SHA de origem, inventário completo e único,
artifact ID, SHA-256, expiração e vínculo ao mesmo run/repositório.
Também rejeita quaisquer IDs, artefatos ou revisão histórica reutilizados.
O token é usado somente para consulta e não é gravado no documento.
O arquivo só é criado se toda a verificação passar; nunca é sobrescrito.

A montagem pública posterior continua exigindo a validação integral dos
bytes EROFS, recibos e manifests. Este builder **não baixa EROFS, não assina,
não publica, não ativa e não autoriza dispositivo físico**.

## Inputs

The request binds one frozen source commit and exactly three manually exported operator
artifacts by all of the following identities:

- workflow path;
- manual workflow run ID;
- immutable artifact ID;
- artifact name containing the exact source commit;
- expected canonical release namespace.

Artifact **name alone is never sufficient**. GitHub retains artifacts from earlier
attempts when a job is re-run, so the request uses immutable artifact IDs to avoid
selecting an older same-name artifact.

For each artifact the workflow retrieves the run metadata and artifact metadata through
the GitHub API, requires `workflow_dispatch`, completed/success, `main`, the exact frozen
source commit and an unexpired artifact, then downloads that exact artifact ID. The ZIP
SHA-256 is checked against the Actions artifact digest before extraction.

The validator then re-hashes the extracted files and requires the builder-owned
`operator-receipt.json` to match the exact bytes and source commit. Every operator
receipt must keep all of these false:

```text
publication_performed
signing_performed
release_activated
physical_target_selected
physical_write_authorized
physical_write_performed
```

The Local AI artifact must additionally carry the exact `source-lock.json` and the
release-manifest/4 Local AI binding must be derived from those bytes.

## Exact-source tooling

The assembly job may execute from a later documentation/CI commit, but release tooling
is not taken from that moving checkout. It creates a detached Git worktree for the
request's exact frozen `source_commit`, then builds the release-manifest tool and the
Windows release signer from that source.

The canonical public trust and the step-4 signing scripts are also copied from the exact
frozen source commit.

## Output

The output artifact is intentionally small and public-only:

```text
canonical-v4-signing-request-<source_commit>/
  release-manifest.json
  release-ed25519.json
  ordax-release-signing.exe
  4-Sign-Initial-OrdaXRelease.ps1
  4-Sign-Initial-OrdaXRelease.cmd
  canonical-v4-signing-request.json
  canonical-v4-signing-request-receipt.json
  system-operator-receipt.json
  surface-operator-receipt.json
  local-ai-operator-receipt.json
  local-ai-source-lock.json
  SHA256SUMS
```

It must contain **no** `.erofs`, `.pem`, `.key`, `.p12`, `.pfx`, `.dpapi` or
`release-envelope.json`.

The workflow has only `contents: read` and `actions: read`. It does not create a GitHub
release, tag, deployment or physical candidate.

## What this does not prove

A green public signing-request assembly proves only that the exact three operator
artifacts, their receipts, the frozen source commit, canonical public trust and generated
release-manifest/4 agree before signing.

It does not prove or perform:

- canonical private-key custody;
- canonical signing;
- release publication;
- HTTPS materialization of a signed release;
- release activation;
- USB target selection;
- owner physical-write authorization;
- a physical write.

The canonical private key remains under operator custody outside Git. The eventual
`release-envelope.json` must be created with that key and the pinned public trust.
After signing, the envelope still requires a separate exact-byte verifier that consumes
these same three operator artifact IDs (or the deliberately published canonical bytes),
checks the signature and manifest against the real EROFS payloads, and only then allows
the existing canonical materialization/proof sequence to continue.

No output from this workflow may be treated as physical-write authorization.
