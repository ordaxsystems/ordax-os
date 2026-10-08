# Supabase product foundation

This directory owns the source-controlled schema used by the OrdaX product domain when Supabase is the current backend adapter.

It is deliberately separate from development-device control tables already present in the `ordax-control-plane` project.

## Boundaries

Product tables own account bootstrap, Spaces, server-authoritative entitlement grants, profile-pack catalog metadata, memory metadata/semantic index and project-connection metadata.

They do not store:

- GitHub access tokens;
- OpenAI/xAI credentials;
- release signing keys;
- device private keys;
- recovery secrets;
- generic shell credentials.

External provider secrets require a dedicated server-side secret owner and are never exposed through public Data API tables.

## Migration 0001

`migrations/0001_product_foundation.sql`:

- bootstraps `ordax_accounts` from Supabase Auth;
- creates Spaces and membership;
- creates server-readable entitlement grants;
- creates versioned Profile Packs;
- creates provider-neutral Memory + derived pgvector embeddings;
- creates project-connection metadata suitable for future GitHub App installations;
- enables RLS on every public table;
- grants no anonymous access;
- seeds only **draft** Developer and Legal-BR pack descriptors, not legal knowledge.

The Legal-BR row is architecture metadata only. It does not claim current legal coverage.

## Mutation authority

Authenticated clients do not receive direct Data API authority to create or mutate Spaces, memberships, cloud Memory, project connections, Profile Pack assignments or entitlement grants.

`0004_server_authoritative_mutations.sql` revokes those client writes so future quotas, plan checks, approvals and audit receipts cannot be bypassed by calling Supabase directly. Product services/gateways own those mutations with server-side authority. The only direct authenticated account mutation retained is the user's own `display_name`.

## Catalog and semantic-index visibility

`0005_private_indexes_and_active_pack_catalog.sql` keeps Profile Pack drafts backend-only and exposes only `state=active` pack rows to authenticated clients. It also removes direct client SELECT access from `ordax_memory_embeddings`: semantic vectors are an internal derived search index, not user-facing Memory data.

## MCP boundary

The existing Control Plane MCP/OAuth tables belong to the development/operator authority. Product MCP for end users must use a separate client/token authority even if it reuses the same implementation patterns.


## Projects, devices and remote capabilities

Migration `0006_projects_devices_remote_grants.sql` adds the first product-domain
cloud identities for Projects and Devices without reusing the older engineering
Control Plane authority.

The product tables intentionally store metadata/authorization only:

- `ordax_projects` — Space-scoped product project identity;
- `ordax_product_devices` — end-user device identity, separate from engineering
  `ordax_devices`;
- `ordax_device_presence` — presence/version/capability digest, separate from
  long-lived device identity;
- `ordax_space_devices` — explicit Space/device sharing;
- `ordax_device_project_bindings` — opaque local project references, never local
  filesystem paths;
- `ordax_remote_capability_grants` — server-authoritative Web/Mobile/Product MCP
  grants scoped to Space + Project + Device + capability.

`ordax_project_connections` gains a required `project_id`, making GitHub and
other providers connections *of a Project* rather than substitutes for Project
identity.

Authenticated clients receive SELECT only. Mutations continue through OrdaX
server-side product gateways so entitlement, approval and audit cannot be bypassed.

## Account registration legal receipt

Migration `20261002221427_account_registration_legal_receipt_v1.sql` is applied to
`ordax-control-plane`. It keeps legal policy, short-lived registration intents and
immutable registration receipts in the private schema. Only the backend service role may
issue an intent. The existing single `auth.users` product trigger consumes that intent and
creates the receipt in the same database transaction as the user bootstrap.

No active Privacy/Terms policy is seeded by the migration. Browser/authenticated roles have
no direct table or RPC authority, client-supplied document versions are never trusted, and

Final reviewed policy activation has one canonical path: the service-role-only
`ordax_activate_account_legal_policy_v1` RPC plus the manual
`Public Legal Policy Activation` workflow. The workflow derives SHA-256 from the exact
served Privacy/Terms HTML, requires the legal readiness contract to be fully ready,
requires explicit operator confirmation, and emits only a sanitized receipt. Direct
manual edits to mark a policy active are not the release procedure.


registration remains disabled until reviewed final documents are deliberately activated.

Migration `20261002225800_account_registration_policy_projection_v1.sql` is also applied.
It adds canonical HTTPS document URLs to the private policy, makes policy identity/document
fields immutable after activation, and exposes a service-role-only read projection for the
single active/effective policy. `anon` and `authenticated` have no EXECUTE authority on
that RPC. Web and Native source consume the same server projection and submit only an
affirmative acceptance flag; document versions/hashes remain server-owned. There is still
no active policy and no public registration activation.

Migration `20261002232500_account_registration_legal_fk_indexes_v1.sql` adds the
covering policy foreign-key indexes used by registration intents and immutable legal
receipts. It changes no authority and seeds no data.

## PostgreSQL de destino: proteção de registro (2026-10-08)

O projeto Supabase `ordax-platform` (`jhfphsjptrpmtnzkpwud`, São Paulo) é o
**destino em preparação**, não o provedor de autenticação público já promovido.
O campo `target` do SSOT `docs/contracts/public-auth-hardening.json` ainda
identifica o runtime anterior `ordax-control-plane`; o objeto
`postgresql_destination` registra apenas evidências do destino. Não são
duas autoridades funcionais e **não existe dual-write**.

Foram aplicadas ao destino, sem cópia ou nova implementação das regras, as
seis migrations já versionadas em `infra/supabase/product/migrations/`:
a vinculação transacional do aceite jurídico e recibo imutável, a projeção
privada da política, os índices de FKs, a verificação server-only de recibo
no login, a ativação de política controlada e a correção da validação de e-mail
que utilizava `chr(0)` (chamada inválida para `text` no PostgreSQL). A última
correção também foi aplicada no provedor anterior, por ter a mesma falha. O histórico da execução consta
nas migrations reais do projeto de destino; os arquivos SQL permanecem o
único source canônico. Não reaplicar migrations que o ledger já registra.

Provas ao vivo após implantação:

- uma única trigger de criação `on_auth_user_created_ordax_product`;
- tentativa de inserção em `auth.users` sem intent emitida pelo servidor
  rejeitada com `ordax-registration-legal-intent-required`, dentro de
  transação encerrada por `ROLLBACK`;
- `anon` e `authenticated` sem `EXECUTE` nas RPCs de intent, projeção,
  verificação de recibo e ativação; `service_role` com acesso estritamente
  às RPCs de servidor previstas nas migrations;
- verificação de recibo para subject inexistente retornando `false`;
- zero contas e zero políticas jurídicas ativas no destino no momento da prova;
- nenhuma Edge Function implantada no novo projeto nessa verificação.

Isto **não ativa** autenticação pública. Antes do cutover ainda são necessários
o gateway/host definitivo com OIDC e same-origin comprovados, configurações
reais de Auth/email/redirect/password/rate limiting, termos e privacidade
revisados, Turnstile, recovery e revogação E2E. A conta continua opcional
para inicializar e usar o OS localmente. Nunca copiar tokens/senhas ou permitir
um segundo writer de identidade durante a migração.

### Limitação de tentativas e quarentena jurídica no destino (2026-10-08)

O mesmo PostgreSQL de destino recebeu duas migrations **já existentes no
owner canônico**, sem duplicação do rate limiter ou das regras de identidade:

- `20261004202500_public_auth_rate_limit_v1.sql`: RPC
  `ordax_consume_public_auth_rate_limit_v1`, executável só por
  `service_role`; limites por endereço IP canônico e operação, estado privado
  com IP representado somente por hash SHA-256;
- `20261007044500_account_legacy_legal_quarantine_v1.sql`: bloqueio e
  reconciliação de contas anteriores sem recibo legal, incluindo a trigger
  de liberação somente quando surgir o recibo legítimo.

As duas migrations foram compiladas em uma transação com `ROLLBACK` antes
da aplicação no destino. A prova SQL **canônica existente** em
`tests/sql/test_public_auth_rate_limit_v1.sql` passou contra o PostgreSQL
de destino com `ROLLBACK`: cobrança de tentativas até o limite, rejeição
posterior, isolamento IPv4, normalização IPv6, rejeição de buckets/IPs
inválidos e ausência de grants diretos. Uma segunda leitura confirmou
`0` janelas de rate limit, `0` contas e `0` contas em quarentena no
destino após os testes. Apenas `service_role` pode invocar as RPCs.

O rate limit do banco **não significa proteção pública comprovada**:
faltam implantação do gateway de destino, verificação de IP verdadeiro
atrás do host e teste E2E com rede pública. Esses gates permanecem
`false` em `docs/contracts/public-auth-hardening.json`; não habilitar
cadastro/login por causa da preparação do schema.

## Reconciliação da origem do snapshot paginado de Sync (2026-10-08)

A migration registrada no provedor anterior como
`20260930140051 account_sync_paginated_snapshot_v2` não tinha seu SQL
versionado neste owner canônico. A definição de
`public.ordax_sync_snapshot_page_v2(bigint,text,text,integer)` foi
confrontada com a função real do PostgreSQL anterior e recuperada em
`migrations/20260930140051_account_sync_paginated_snapshot_v2.sql`.

Na posição histórica dessa migration, a função permanece
`SECURITY INVOKER`, com `search_path` vazio e o sujeito obtido por
`auth.uid()`. Somente a migration posterior e já canônica
`20261005025500_sync_private_least_privilege_v2.sql` pode transferir
a propriedade e promover a função para `SECURITY DEFINER`, após
instituir o executor `NOLOGIN/NOBYPASSRLS`, restrições de RLS e grants
específicos de transporte. O objetivo é **um único mecanismo** e
nenhuma janela com proprietário privilegiado em `SECURITY DEFINER`.

No Supabase de destino, as cinco migrations base, incluindo a
restaurada, foram verificadas conjuntamente com `BEGIN ... ROLLBACK`.
Provas: `anon` sem `EXECUTE`, `authenticated` com `EXECUTE`,
e invocação sem sujeito rejeitada com `authentication-required`.
Nova consulta confirmou ausência das tabelas e da RPC após rollback.

**Não houve instalação permanente de Sync**, ativação de cadastro ou
cópia de dados: a cadeia integral do novo backend ainda depende da
reconciliação da autoridade de exportação, paginação, schema e do
isolamento do executor antes de implantar o gateway de Conta. Não
aplicar somente as etapas intermediárias com privilégios transitórios.
