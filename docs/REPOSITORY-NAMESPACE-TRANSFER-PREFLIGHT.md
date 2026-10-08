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

Existem também referências históricas que **não devem ser reescritas**
(signed manifests já publicados, evidence, hashes, commits, documentação
histórica). Modificar proveniência de artefatos históricos cria uma
identidade falsa e pode invalidar assinaturas.

## Gatilho do cutover

Executar `python3 tools/verify/repository_namespace_transfer_preflight.py`
em checkout limpo para relatório sem efeitos colaterais. O resultado
`phase=pre-transfer` com referências operacionais pendentes é um **bloqueio
real ao corte**, não uma autorização automática para transferir.

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

Interromper sem transferir se faltarem assinaturas, trust, permissões
org/repo, configurações OIDC, PRs/CI verificáveis ou se alguma ação de
physical-write/release estiver ativa. Não ativar operador, bypass de
verificação, mirror permanente nem aceite simultâneo de dois owners.
Reverter um corte parcial somente mediante plano explícito de migração,
nunca com aliases silenciosos ou alteração de históricos.
