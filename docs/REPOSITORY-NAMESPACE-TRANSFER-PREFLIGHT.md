# Transferência do repositório OrdaX OS para ordaxsystems

## Estado e autoridade

Tracking: [#1354](https://github.com/washingtonmsdj/prototipo-ordax-os/issues/1354).
Owner físico **atual** até concluir o passo GitHub:
`washingtonmsdj/prototipo-ordax-os` (GitHub repo ID imutável
`1371063347`). Destino sem renomear o repositório:
`ordaxsystems/prototipo-ordax-os`.

Os três outros owners já foram transferidos. O documento
`docs/contracts/repository-ownership.json` continua como SSOT; não
alterar `platform.repo` ou `current_namespace` antes de a transferência
física ter sido confirmada no GitHub. Não criar outro repositório ou
`mirror`, não depender do redirect como autoridade e não renomear
`prototipo-ordax-os` para `ordax-os` no mesmo cutover.

## Prova da auditoria pré-transferência

A busca de código em `main` encontrou mais de 100 arquivos com referências ao
antigo owner do OS. Em particular, valores operacionais persistem em:

- Go module paths, imports e channel/Creator;
- URLs de publicação/aquisição de release e artefatos;
- `GITHUB_REPOSITORY` usado como condição de autorização em workflows;
- verificadores de assinatura, fontes de autoridade e package policies;
- script do boot/base-update/supervisor;
- testes, source locks e contratos ativos.

A classificação de referências operacionais inclui também `boot/`,
`sdk/` e `docs/RELEASE-CHANNEL.md`, além de workflows,
`bootstrap/`, `system/`, `tools/` e contratos ativos. A cópia pública
`sdk/app-sdk-v1/runtime-component-package-policy.json` precisa ser
**idêntica em bytes** à fonte canônica
`docs/contracts/runtime-component-package.json`; o verificador
`--require-cutover` recusa projeção divergente, mesmo se o owner e
o SHA do ponteiro de release estiverem corretos. Um source no GitHub
não autoriza duas políticas de pacotes distintas.

Existem também referências históricas que **não devem ser reescritas**
(signed manifests já publicados, evidence, hashes, commits, documentação
histórica). Modificar proveniência de artefatos históricos cria uma
identidade falsa e pode invalidar assinaturas. O auditor trata como
proveniência imutável especificamente
`docs/contracts/canonical-v4-signing-request.json`,
`docs/contracts/physical-write-authorization.json` e
`system/profile-content-sources/developer-core/v0.1.0/manifest.json`,
pois registram commits/artifacts anteriores e hashes já fixados.
A regra não exclui contratos **ativos**, como
`docs/contracts/release-channel.json` e
`docs/contracts/runtime-component-package.json`.

## Gatilho do cutover

Executar `python3 tools/verify/repository_namespace_transfer_preflight.py`
em checkout limpo para relatório sem efeitos colaterais. O resultado
`phase=pre-transfer` com referências operacionais pendentes é um **bloqueio
real ao corte**, não uma autorização automática para transferir.

## Dependência criptográfica do canal de release

O arquivo `bootstrap/config/release-envelope-url` é **conteúdo com hash fixado**
no artefato `bootstrap-release-channel` em
`docs/contracts/minimal-bootstrap.json`. O hash da URL histórica com LF é
`ea1f3bae328a1c1e7aca1474d4930f84b2dd6da1702dcc11b08c01ed63a6ee5b`.

**Mudar só a URL quebra a integridade do bootstrap.** O auditor agora compara
o proprietário no contrato do canal, a URL publicada, os bytes exatos do
ponteiro com LF e o SHA-256 registrado no manifesto de bootstrap.
`.gitattributes` obriga LF em Windows e Linux.

A mudança de owner exige uma nova cadeia de bootstrap/release/assinatura
verificada, **mas a publicação assinada no namespace novo é uma prova
pós-transferência**, não uma condição circular para executar a transferência
física. Releases históricas e seus bytes acompanham o mesmo repositório
durante a transferência; sua proveniência e hashes devem permanecer
imutáveis. **Não** editar provas físicas, signing requests ou manifests
assinados do owner anterior para mudar o hash silenciosamente. Se o canal,
o ponteiro e o manifesto não coincidirem, `--require-cutover` recusa
a declaração do cutover como concluído, ainda que o GitHub aponte ao
novo owner.

## Comprovação obrigatória de release estável assinada

Um ponteiro `/releases/latest/download/release-envelope.json` com SHA-256
coerente **não prova a existência de uma release** nem sua autenticidade.
A verificação pós-transferência é sequencial e bloqueante:

1. `tools/verify/repository_namespace_transfer_preflight.py --require-cutover`
   valida o owner do runner e preservação do repo ID `1371063347`.
2. `tools/verify/repository_namespace_stable_release.py` exige uma release
   GitHub **publicada, não draft, não prerelease**, na origem exata do owner
   do contrato, com **um único** `release-envelope.json` completamente
   carregado e URL que pertence à tag exata. Resposta 404, tag ausente,
   asset ausente, repo incompatível ou erro de rede bloqueiam.
3. **Somente então** o `ordax-release-agent inspect` canônico (Go) busca
   `latest_envelope_url` via HTTPS, valida Ed25519 usando a chave pública
   `bootstrap/trust/release-ed25519.json` e exige a origem do manifesto
   `--repository "$GITHUB_REPOSITORY"`. A inspeção não materializa release,
   não altera ponteiros, não inicializa disco, não pede reboot.

O resultado do passo 2 é `verified-metadata-only` e **nunca deve
ser apresentado como assinatura verificada**. A autenticidade cabe
exclusivamente ao passo 3. Os dois passos rodam automaticamente no workflow
`Repository Namespace Transfer Preflight` **apenas após o GitHub reportar
`ordaxsystems/prototipo-ordax-os`**. A falta atual de `/releases/latest`
é bloqueio verdadeiro: não resolver apontando para prerelease, fabricando
envelope ou aceitando fallback/dual owner. Atestar a assinatura do
manifesto também não substitui os outros gates de boot, Creator, proveniência
dos binários e autorização física separada.

**Antes de tocar no proprietário físico**:

1. Conferir `main`, branches/PRs ativas, actions, releases, environments,
   branch rules, tokens de GitHub Apps, webhook/OIDC e consumidores de URLs.
2. Preparar mudanças nos consumidores de releases, Go, scripts e trust
   **para um corte coordenado**, sem habilitar simultaneamente owner antigo e
   novo como autoridades.
3. Capturar o SHA de `main` e IDs exatos de repo/PRs, confirmar aceitação
   na organização e políticas de branch; evitar operações de owner enquanto
   release/signing/physical-write estiverem ativas.
4. Provar os testes e artefatos da mudança em branches versionadas/PRs.
5. Transferir o **repositório existente** para `ordaxsystems`, preservando
   o ID `1371063347`, sem criar outro e sem mudar o nome do repo.
6. Atualizar de forma coordenada e versionada
   `repository-ownership.json`, `repository-migration-status.json`,
   contratos, verificadores e source consumers. Marcar
   `namespace_migration.status=complete`,
   `current_namespace=ordaxsystems` e acrescentar `platform` aos
   `completed_transfers` **somente depois da transferência confirmada**.
7. Rodar CI de bootstrap, Creator, Go, assinatura, packages e release
   na nova identidade. Validar como prova de aceitação:

   `python3 tools/verify/repository_namespace_transfer_preflight.py --require-cutover`

   Esse comando exige ausência de referências antigas em código/configuração
   operacional e `GITHUB_REPOSITORY=ordaxsystems/prototipo-ordax-os` junto
   com `GITHUB_REPOSITORY_ID=1371063347`. Histórico imutável não é
   reescrito para falsificar origem.
8. Confirmar todos os PRs/issues e workflows no mesmo repo ID e integrações
   cross-repo. Só então encerrar #1354 e revisar eventual rename `ordax-os`.

## Regras de interrupção

Interromper **antes da transferência física** se não houver permissão
org/repo, integridade dos artefatos históricos, estado verificável da
main/PRs/CI, preparação dos consumidores ou se houver operações ativas
de release/physical-write. Manter publicação e operações físicas bloqueadas
durante a janela de transferência.

**Depois da transferência física**, não declarar o cutover concluído,
não liberar merges/deploys/ativação e não assinar ou publicar às cegas:
exigir identidade `ordaxsystems/*` com repo ID preservado, CI, publicação
e verificação de release estável Ed25519, trust/OIDC e contratos reconciliados.
A falta de release assinada **bloqueia promoção pós-transferência**, mas
não justifica inventar uma assinatura no proprietário antigo nem reutilizar
provas incompatíveis. Não ativar operador, bypass, mirror permanente nem
aceite simultâneo de dois owners.
Reverter um corte parcial somente mediante plano explícito de migração,
nunca com aliases silenciosos ou alteração de históricos.
