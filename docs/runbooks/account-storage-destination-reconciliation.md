# Reconciliação do armazenamento e das cotas — `ordax-platform`

**Owner:** `ordax-os/docs/contracts/user-cloud-storage.json` e `docs/contracts/service-quotas.json`. O owner da identidade do destino é `docs/contracts/public-auth-hardening.json#postgresql_destination`. Não criar um segundo ledger de quota, provedor de identidade ou schema paralelo.

## Estado verificado em 26/10/2026

O banco Supabase de destino `ordax-platform` (ref `jhfphsjptrpmtnzkpwud`) já tem usuários e Spaces. A consulta somente leitura a `pg_class`/`to_regclass` confirmou que **nenhuma** das cinco tabelas de armazenamento e quota do produto está presente. A consulta a `supabase_migrations.schema_migrations` e o histórico pelo conector não localizaram as migrações de Cloud Storage/Service Quota Ledger. A migração avulsa `space_active_quota_guard_v1` **não** representa instalação do ledger. Os detalhes sanitizados estão em `docs/evidence/account-destination-storage-quota-inventory-2026-10-26.json`.

Os contratos antigos diziam que migrations de 05 e 07/10 foram aplicadas. Esses registros foram mantidos integralmente em `docs/evidence/storage-quota-historical-deployment-claims-2026-10-26.json`, **sem atribuir a aplicação ao destino atual**. A fonte das migrations existe no repositório, mas fonte pronta e aplicação verificada são fatos diferentes.

## Bloqueio arquitetural, sem execução cega

A migration `20261005171000_user_cloud_storage_foundation_v2.sql` contém `ordax_policy.can_access_space(space_id)`; **`ordax_policy` não existe no projeto de destino**. Já `private.ordax_touch_updated_at()` existe. Isso demonstra que o bootstrap original não pode ser aplicado sem reconciliação de políticas de acesso. Não modificar a migration histórica nem fazer `CREATE TABLE IF NOT EXISTS` como suposta correção de root cause.

A futura implantação deve ser uma **única sequência forward-only, transacional, revisada e específica para o destino**. Antes de qualquer DDL, exigir inventário das cinco tabelas, funções, constraints e histórico de migração; presença de usuários e Spaces; o owner real das políticas de acesso; e plano de quotas com serialização/conflitos comprovados. Em caso de qualquer divergência, abortar **sem efeito colateral**. Não criar permissões de escrita diretas para `anon`, `authenticated` ou `service_role`, nem bucket público. Manter migração de RLS, grants e registro de versões no mesmo gate de promoção.

Depois de aplicar uma migration aprovada, reexecutar inventário e testes de duas contas e de quota, negativos de acesso cruzado, replay, expiry, integridade SHA-256, exportação/remoção e cleanup. **Somente então** atualizar os contratos canônicos com prova datada e permitir promoção separada do Cloud Storage. A Conta pública continua sujeita aos gates próprios de Auth/legal/recuperação e permanece bloqueada.

## Inventário de leitura

```sql
select requested_name,
       to_regclass(requested_name) is not null as relation_exists
from (values
  ('public.ordax_user_objects'),
  ('private.ordax_user_object_provider_refs'),
  ('private.ordax_user_upload_reservations'),
  ('private.ordax_service_quota_usage'),
  ('private.ordax_service_quota_reservations')
) names(requested_name);

select to_regnamespace('ordax_policy') is not null as legacy_policy_schema_exists,
       to_regprocedure('private.ordax_touch_updated_at()') is not null as touch_function_exists,
       exists(select 1 from auth.users) as destination_has_users;
```

Não imprimir nem persistir nomes, e-mails, IDs de usuários ou conteúdo de tabelas em evidências públicas.
