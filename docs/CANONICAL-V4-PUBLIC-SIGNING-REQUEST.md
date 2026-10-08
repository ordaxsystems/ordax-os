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

## Proteção contra identidade anterior após renomeação

O workflow de montagem compara a identidade real `GITHUB_REPOSITORY`,
fornecida pelo GitHub Actions, com o proprietário canônico já usado pelo
validador `tools/release-operator/validate_canonical_v4_signing_request.py`.
Se forem diferentes, o seletor retorna
`blocked-execution-repository-identity-mismatch` e `active=false`.
Se a identidade de execução estiver ausente, ele falha fechado.
**Nenhum artefato deve ser montado** a partir do request antigo por
redirecionamento de URL ou pelo fato de o ID físico do repositório ser o mesmo.

A correção de identidade e o arquivamento da solicitação v4 pré-rename são
feitos em suas PRs canônicas de migração. Esta barreira é deliberadamente
independente da configuração de novas releases: não muda contratos de
propriedade, não gera request substituto, não reescreve provas históricas
e não concede autoridade de assinatura, publicação ou gravação física.

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

## Congelar um SHA enquanto a main continua evoluindo

Os três workflows de operador `workflow_dispatch` aceitam a mesma revisão de fonte
pela `main` **ou** por uma branch dedicada com identidade exata:
`release-candidate/<SHA40>`. O builder e o validador verificam um mesmo
`source_commit` e um mesmo `operator_ref` entre os três runs e seus artefatos.

Procedimento não destrutivo:

1. Escolher um commit da `main` posterior ao cutover e com as provas essenciais
   aprovadas; criar a branch `release-candidate/<SHA40>` apontando **exatamente**
   para esse commit. Não reescrever nem mover essa branch após iniciar provas.
2. Acionar `portable-release-image.yml`, `surface-runtime-lock-discovery.yml`
   e `local-ai-runtime-candidate.yml` manualmente, **todos pela mesma branch**.
   Outras melhorias podem continuar entrando na `main` sem alterar esses bytes.
3. Usar `build_canonical_v4_request.py --source-commit <SHA40>` e os três
   run IDs observados. O builder confirma o repositório/provenance, que o SHA
   é ancestral da `main`, que todos os runs têm `event=workflow_dispatch`,
   sucesso, commit e branch idênticos, que os artifact IDs e hashes pertencem
   a esses runs e que a branch congelada ainda aponta para o mesmo commit.
   Um request novo vincula `operator_ref` explicitamente.
4. Se houver uma correção essencial, escolher novo SHA e gerar novas provas;
   nunca reciclar os IDs de artefatos do commit anterior.

Nomes de branch arbitrários, tags, mistura de `main` com candidata,
branch candidata associada a outro SHA e mudança de ref após os builds são
rejeitados. Requests históricos sem `operator_ref` continuam interpretados
exclusivamente como `main`, sem permitir builds de outras branches.

A seleção de fonte **não é um novo SSOT, nem autorização**: a `main` continua
sendo a linhagem canônica; a referência candidata só congela um commit já
validado. Nenhuma dessas operações assina, publica, ativa, seleciona USB ou
grava dispositivo. Ainda serão necessárias custódia da chave fora do CI,
materialização, assinatura canônica, confirmação e prova física do Stable/MVP.

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
