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

## SQL forward-only preparada e testada, mas não aplicada

A única fonte de composição é `infra/supabase/product/render_storage_quota_destination_migration.py`. O script lê **cinco migrations canônicas existentes** (ledger, redução, Storage, RLS privada e FK da reserva) e só adapta a expressão de política de leitura de objetos ao par de helpers atuais `private.ordax_authenticated_subject_eligible_v1()` + `private.ordax_can_access_space(uuid)`. Não copia a lógica das cotas nem cria um segundo owner. A composição é uma transação única, com lock timeout, pré-check e pós-check.

Para inspecionar, sem aplicar ou persistir nenhum objeto:

```bash
python3 infra/supabase/product/render_storage_quota_destination_migration.py \
  --project-ref jhfphsjptrpmtnzkpwud > /tmp/ordax-storage-preview.sql
```

**O conteúdo padrão termina em `ROLLBACK`**. Mesmo a opção `--emit-commit-sql --confirm-destination <ref>` somente **emite texto SQL**; o script não possui conexão Supabase nem executa banco. Uma aplicação real não deve ser feita diretamente com `psql -f`, porque isso não registra a versão no ledger `supabase_migrations.schema_migrations`. Requer uma **migration versionada e promovida pelo pipeline oficial**, revisada com identificação do projeto, controle de concorrência, estado da instalação e política de source/destination. Não usar `supabase migration repair` para marcar DDL não executada como aplicada.

A prova de não persistência, instalação transacional, RLS, ausência de grants de escrita, duas identidades **sintéticas** e replay negado roda somente no Postgres 17 descartável em `.github/workflows/storage-destination-migration-proof.yml`. Ela não comprova dois JWT reais nem substitui testes autenticados negativos. O inventário pré-DDL do destino foi confirmado por SQL somente leitura em `docs/evidence/account-storage-destination-forward-preflight-2026-10-26.json`. Não há autorização de execução em produção ou ativação pública por causa da prova sintética.

Os checks restantes devem ser promovidos separadamente: migrar pelo owner canônico/versionado, comprovar compatibilidade dos event triggers e das funções Supabase do destino, testar dois usuários autenticados reais, permissões de schema privado fora da Data API, quotas e limpeza, sem alterar registros existentes.

## Migration versionada sob o owner canônico (ainda não aplicada)

A CLI Supabase v2.122.0 criou o identificador `20261026222222_storage_quota_populated_destination_v1.sql`. Seu arquivo está versionado em `infra/supabase/product/migrations/20261026222222_storage_quota_populated_destination_v1.sql`. Ele é um **artefato gerado e imutável**, não um segundo proprietário de regras de negócio. A suíte `tests/test_storage_destination_migration.py` exige **igualdade byte a byte** entre esse arquivo e `render(project_ref, commit=True)`; qualquer mudança nos cinco arquivos históricos, no renderer ou na adaptação RLS torna o CI vermelho até que seja explicitamente reconciliada. O workflow sintético executa o **próprio arquivo versionado**, inclusive em tentativas de reaplicação. Isso evita SQL diferente entre teste e implantação.

**Estado operacional: MIGRATION CRIADA NO GIT, NÃO APLICADA NO PROJETO SUPABASE.** Antes de promover, reconciliar a sequência do ledger de migrations no projeto e verificar que a versão `20261026222222` continua ausente. O formato canônico de publicação exige execução por um mecanismo que grave `supabase_migrations.schema_migrations` atomicamente, com identidade do destino, controle de concorrência e aprovação do operador. Não fazer `psql -f` manual, não registrar versão artificial via `migration repair`, não executar `supabase db push` no repositório inteiro sem antes confirmar o conjunto de migrations remotas e locais. A presença do arquivo no Git não libera storage, login ou cadastro público.

A prova CI usa duas identidades PostgreSQL **sintéticas**; não substitui teste real de duas contas Supabase/JWT, validação da Data API, rate limit/limpeza/quotas, homologação do provedor ou aprovação jurídica.

## Preflight somente leitura e vinculado ao projeto

O verificador `infra/supabase/product/verify_storage_destination_preflight.py` é o ponto único para conferir se uma migration versionada **pode sequer ser considerada** para homologação. Ele exige identidade consistente entre contratos de Account, Storage e Quota, igualdade byte a byte entre migration `20261026222222` e renderer canônico, e a presença/ausência exata de funções, tabelas e registro da versão.

Para inspecionar a consulta sem contatar o Supabase:

```bash
python3 infra/supabase/product/verify_storage_destination_preflight.py --print-query
```

O modo `--fixture-json <arquivo>` aceita um único objeto JSON booleano do catálogo, valida estritamente todas as chaves e **marca a origem como sintética**. O CI roda a consulta no PostgreSQL descartável antes e depois da instalação: antes aprova apenas as pré-condições do catálogo; depois deve negar devido às tabelas já existentes. Isso **não substitui homologação real**.

Para uma conferência remota somente leitura, com credencial de banco mantida fora do repositório e nunca impressa:

```bash
ORDAX_STORAGE_DESTINATION_DATABASE_URL='<segredo-configurado-no-ambiente>' \
  python3 infra/supabase/product/verify_storage_destination_preflight.py --live
```

O script recusa DSN que não seja do projeto canônico (host direto `db.<ref>.supabase.co` / usuário `postgres` ou pooler oficial / usuário `postgres.<ref>`), exige TLS e consulta somente `pg_catalog`, `auth.users` via `EXISTS` e a tabela de versões. Os segredos ficam em variáveis de conexão do processo `psql`, não em argumentos de linha de comando ou evidência. Uma falha de conexão não imprime o erro bruto do driver. **Mesmo resultado verde somente prova pré-condições de catálogo**, não autoriza a execução de DDL, nem implantação automática, nem liberação pública.

A promoção ainda depende de controle exclusivo da execução da migration no Supabase, backup/recovery operacional adequado, teste autenticado com duas identidades reais, confirmação de schemas expostos na Data API e registros jurídicos aprovados.
