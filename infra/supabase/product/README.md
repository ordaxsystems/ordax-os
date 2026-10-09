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

## Correção da identidade de Sync no PostgreSQL de destino (2026-10-08)

O Supabase gerencia a propriedade do schema `auth`. O executor restrito
`ordax_sync_executor` não possui `USAGE` nesse schema; portanto,
executar `auth.uid()` dentro dos seis RPCs `SECURITY DEFINER` de
Sync causa `permission denied for schema auth`.

A migration canônica
`migrations/20261008092000_sync_request_subject_bridge_v1.sql`
corrige **os seis RPCs existentes** e **as cinco políticas RLS
existentes** para consumir
`public.ordax_request_subject_v1()`, a ponte mínima e
`SECURITY DEFINER` já implementada pelo owner de Account Export.
Concede apenas `USAGE` no schema `public` e `EXECUTE`
dessa função para `ordax_sync_executor`; nunca concede acesso
direto ao schema `auth`, não cria uma segunda ponte de identidade
e mantém o executor `NOLOGIN/NOBYPASSRLS`.

A falha foi reproduzida com duas contas e recibos jurídicos sintéticos,
dentro de `BEGIN ... ROLLBACK`. A prova com a migration corretiva
passou: gravação de Sync pelo sujeito A, snapshot e exportação
correspondentes; o sujeito B não recebeu os dados do sujeito A.
O SQL reproduzível está em
`tests/sql/test_account_sync_export_subject_isolation_v1.sql`.
Nenhuma conta, política jurídica ou alteração sintética persistiu.

A verificação não autoriza cadastro/login públicos. A implantação
de gateway, integração OIDC, provedor e recuperação de sessão seguem
exigindo provas específicas para o mesmo destino.

## Gateway interno no Supabase novo: implantação restrita (2026-10-08)

O projeto canônico `ordax-platform` (`jhfphsjptrpmtnzkpwud`)
recebeu a versão **1** de `ordax-account-gateway`, com entrada
`verify_jwt=true`, sem implantar `ordax-public-account-gateway`
e sem publicar o frontend no domínio definitivo. O deploy utilizou o
source da `main` e seus dois módulos `_shared` canônicos.
O artefato compilado reportado pela plataforma tem SHA-256
`c5597140211faa49f08031d222b3718c59da657e5a2e04bb88619d27f93b91ca`.
A lista e a leitura da Edge Function no destino confirmaram
`ACTIVE`, versão 1 e `verify_jwt=true`; não comprovam resposta
HTTP, autenticação ou sessão ponta-a-ponta.

**A presença desse gateway interno NÃO significa que a Conta
pública foi implantada ou promovida.** As flags de cadastro,
recuperação e fechamento continuam desativadas; não existem usuários,
política jurídica ativa nem testes de credenciais HTTP no destino.
A configuração JWT obrigatória é uma contenção para esta fase; a
cadeia Vercel `OIDC -> public gateway -> internal gateway` exige
validação de compatibilidade dos tokens/chaves antes de ser conectada.
Não reduzir `verify_jwt` só para tornar o deploy acessível.

Também foi consultada a equipe Vercel **OrdaX Systems** (slug
`ordaxsystems`, `team_E3bdE137ZG3fhCGMmYuGKJ8o`). O projeto
`ordax-os-public` não foi encontrado nesta equipe. O módulo OIDC
canônico foi corrigido para exigir exclusivamente a equipe
`ordaxsystems`, projeto `ordax-os-public` e ambiente `production`,
rejeitando explicitamente as claims do tenant anterior
`jogo-brasils-projects`. Isso elimina a confiança legada **no
código**, mas o projeto ainda não foi encontrado na Vercel nova
e não existe prova criptográfica E2E do deployment. O bloqueio de
identidade **permanece**, não é justificativa para habilitar Conta.
O proprietário do Vercel deve comprovar existência do projeto novo,
origem HTTPS, emissor, audiência, sujeito e verificação criptográfica
do OIDC no ambiente correto. Toda configuração/prova deve ser
versionada no owner, sem criar um segundo projeto ou usar
credenciais de produção manualmente.

Os fatos observados estão no único SSOT
`docs/contracts/public-auth-hardening.json`. O pré-check de
ativação exige agora evidência independente do gateway interno e do
OIDC do **mesmo destino**, além de todas as provas já exigidas de
cadastro, consentimento, bot protection, rate limit, recuperação,
sessões e exportação/sincronização HTTP.

## Transporte autenticado de serviço na nova Conta (2026-10-08)

A implantação restrita `ordax-account-gateway` **v1**
possui `verify_jwt=true`, isto é, o gateway Supabase valida
`Authorization: Bearer <JWT da própria instância Supabase>` *antes*
da execução do código. O `ordax-public-account-gateway` existente,
porém, encaminha ao interno uma credencial de backend
**exclusivamente em `apikey`**, e não um bearer Supabase válido.
Chaves modernas `sb_secret_...` e `sb_publishable_...` são
**API keys, não JWTs**. O OIDC assinado da Vercel também **não** é
JWT emitido pelo Supabase. Portanto a cadeia atual é incapaz de
comprovar um transporte autenticado ponta-a-ponta apenas com um
status `ACTIVE` das Edge Functions.

Fontes normativas:
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/functions/auth

**Desenho para futura correção no owner da identidade (não implantado
nesta etapa):** verificar a prova criptográfica do OIDC Vercel na
fronteira pública, exigir a identidade do projeto/equipe/ambiente
de destino, e autenticar a chamada interna por chave de serviço com
validação nativa Supabase `auth: 'secret:<nome>'`. A opção
`verify_jwt=false` seria permitida **apenas** se a validação de
credencial própria do handler fosse previamente instalada, coberta
por testes negativos e comprovada em runtime; nunca deve ser usada
sozinha para contornar o 401. Os endpoints Native autenticados
devem seguir validando individualmente o JWT do usuário sob
`auth: 'user'`, sem conceder a `service_role` autorização do sujeito
final nem abrir as rotas anônimas por engano.

O contrato SSOT `docs/contracts/public-auth-hardening.json`
registra `destination_service_transport_runtime_verified=false`,
e o pré-check bloqueia o cutover até que um teste HTTP real confirme
identidade, autorização, rate limit e isolamento de usuário do
**mesmo destino**, sem legados ou dual-write.

## Segregação da credencial entre gateways de Conta (2026-10-08)

O header `x-ordax-public-site: 1` **não é uma identidade** e
não pode ser autorizado com a chave administrativa padrão
`SUPABASE_SECRET_KEYS.default` ou com `SUPABASE_SERVICE_ROLE_KEY`.
O código passou a compartilhar **um único verificador** em
`infra/supabase/functions/_shared/account_service_bridge.mjs`,
usado pelo gateway público para construir a chamada e pelo interno
para autenticar a proveniência.

Esse verificador só aceita `SUPABASE_SECRET_KEYS["ordax_account_public_bridge"]`
com formato atual `sb_secret_...`, escopo exclusivo
de **transporte serviço-para-serviço**. Nunca autentica um usuário,
não deduz sessão da chave nem aceita credenciais legadas. Ausência
do segredo nomeado implica recusa fechada, não fallback ao admin.
Sua concessão e rotação devem usar o gerenciador de chaves nomeadas
do Supabase, fora do Git; não registrar seus bytes em documentos,
CI, env pública ou commits. Um token OIDC da Vercel continua sendo
autenticado separadamente na fronteira pública.

**Importante:** este contrato de código não contorna o gate de
plataforma. O gateway interno implantado usa `verify_jwt=true` e
vai rejeitar chamadas de serviço que só enviem `apikey`. Não
desativar a verificação até implementar e testar explicitamente
a autenticação handler-scoped de `auth: 'secret:<nome>'` e dos
usuários Native com `auth: 'user'`, preservando rotas anônimas
restritas, abuso e rate limit. Requer E2E no projeto definitivo
com credenciais reais, OIDC do tenant novo e teste de chave
inválida/faltante. Flags de implantação e cutover continuam
`false` em `docs/contracts/public-auth-hardening.json`.

## Admissão de transporte por rota no gateway interno (2026-10-08)

O owner `_shared/account_transport_admission.mjs` separa as três
classes de entrada **antes de qualquer handler de Conta**:

- **Serviço público OrdaX:** qualquer presença de
  `x-ordax-public-site` exige valor exatamente `1` e a chave
  `ordax_account_public_bridge` conferida pelo verificador
  **já canônico** `_shared/account_service_bridge.mjs`. Marcador
  inválido não pode virar requisição Native por fallback.
- **Native autenticado:** rotas protegidas de Conta, Sync e Rede
  exigem uma sessão de usuário confirmada pelo Supabase Auth via
  `getUser()` (token fornecido por cookie HttpOnly ou Bearer JWT)
  ou por `refreshSession()`. O resultado é cacheado por
  `Request` e reutilizado pelo handler. Não há segunda
  implementação de verificação de assinatura JWT ou segunda fonte
  de identidade.
- **Native sem sessão:** somente métodos/caminhos exatos de
  bootstrap (login, cadastro, recuperação, logout, política,
  estado de sessão e health) podem prosseguir. As operações de
  autenticação continuam sob o limitador RPC autoritativo e
  respectiva validação de endereço na camada existente; flags
  de cadastro e recuperação continuam fechadas.

Nunca permitir `/account/*`, `/sync/*` ou `/network/*`
por correspondência de prefixo num bootstrap. A camada de admissão
deve continuar **antes** de qualquer bypass de rate limit e antes
do roteamento. Testes de negação estão em
`tests/test_account_transport_admission.mjs`.

**Não confundir deploy interno com promoção pública:** a PR #1433
implantou inicialmente a versão v3; após a PR #1441, a Edge Function
`ordax-account-gateway` do `ordax-platform` está na versão **v5**,
`ACTIVE`, `verify_jwt=true`, com os cinco arquivos do owner canônico.
O SHA-256 atual do artefato é
`34723d12ab996771c00633f4defe7a485125870309b7a30fc1b16e9b643dff33`.
A versão v5 mantém os controles v4 de validação de Sync e usa `accountGatewayRoutePath` ligado ao parser compartilhado `stripEdgeFunctionPrefix` para aceitar apenas prefixos
exatos da Edge e retorna erro controlado quando o JSON da mutação Sync
não é um objeto, evitando exceções não tratadas.
A consulta posterior de versão, flags, lista de arquivos e conteúdo
confirmou o deploy; banco após deploy: 0 usuários, 0 políticas legais
ativas e 0 registros Sync. Essas verificações **não equivalem a
testes HTTP com uma credencial real**: o contrato único registra
`destination_transport_admission_deployed=true`, mas
`destination_transport_admission_negative_http_verified=false`,
`destination_named_bridge_key_provisioned=false`,
`destination_service_transport_runtime_verified=false` e
`public_account_gateway_deployed=false`. A implementação pública
permanece desativada.

Somente após provisionar a chave nomeada, comprovar o OIDC do projeto
Vercel real, testar os fluxos Native e HTTP negativos e revisar
os controles poderá ser avaliada uma mudança de `verify_jwt`,
sempre preservando um autenticador próprio antes do roteamento.

## Preparação para cutover de serviço — allowlist canônica (2026-10-09)

A política de rotas públicas agora reside **somente** em
`infra/supabase/functions/_shared/account_transport_admission.mjs`.
Vercel, Edge pública e Edge interna aplicam `isPublicBridgeRoute`;
a chave nomeada `ordax_account_public_bridge` autentica o serviço,
mas não libera rotas Native extras, Rede ou mutações por método incorreto.
Testes negativos impedem regressão antes de qualquer mudança do gate de JWT.

**O transporte continua BLOQUEADO em produção.** Na instância atual,
`ordax-account-gateway` usa `verify_jwt=true` e a chamada interna com
`apikey=sb_secret_...` não satisfaz esse gate da plataforma. A modalidade
recomendada para um serviço com chave nomeada exige configuração explícita
`verify_jwt=false` **somente após** validar o autenticador próprio do
handler (bridge nomeada, sessão Native Supabase Auth e bootstrap restrito),
a chave nomeada e sua rotação, testes de rejeição por HTTP, rate limit,
origem OIDC e gates legais. Não converter apikey em bearer de service_role,
não criar JWT paralelo nem ativar Conta sem E2E. O estado observado e os
gates de promoção permanecem em `docs/contracts/public-auth-hardening.json`.

## Estado real do gateway público no projeto novo (2026-10-09)

Consulta MCP Supabase somente leitura em `ordax-platform`
(`jhfphsjptrpmtnzkpwud`) observou a função
`ordax-public-account-gateway` como **ACTIVE v2**, `verify_jwt=false`,
artefato SHA-256 `1d882e54d3d51eeca6570e28e6905d5874707ca5e9f037c5465ead87647252e4`.
O conteúdo efetivamente implantado declara issuer
`https://oidc.vercel.com/ordaxsystems`, audience
`https://vercel.com/ordaxsystems`, subject
`owner:ordaxsystems:project:ordax-os-public:environment:production`.
A função pública exige validação OIDC no handler; `verify_jwt=false`
**nessa função pública** não autoriza acesso anônimo ao gateway.

A versão v7 e o time OIDC legado registrados anteriormente pertenciam a
outra implantação e **não são evidências do projeto canônico**. O commit
exato que produziu o pacote da v2 não foi comprovado, portanto
`deployment_source_commit=null`; guardamos somente o hash do artefato
observado, sem inventar proveniência GitHub. A centralização da allowlist
(#1520) está integrada no source, **ainda não implantada** nessa v2.
A função interna segue v5 com `verify_jwt=true`, chave nomeada ainda
não provisionada e testes E2E pendentes. Conta pública continua fechada;
não marcar OIDC, gateway service-to-service, login ou cadastro como prontos.

## Diferenciação de falhas na ponte de Conta (source, 2026-10-09)

As provas HTTP reais do domínio `ordax.com.br/auth/session` retornaram
`503 account-gateway-unavailable`. No Supabase canônico, a função pública
v2 registrou `503 EDGE_FUNCTION_ERROR` nas mesmas janelas, com tempos de
execução aproximados de 206–440 ms. Um pedido direto **sem** OIDC à Edge
v2 retornou `403 public-proxy-authentication-required` (segurança ativa).
A URL `ORDAX_ACCOUNT_GATEWAY_URL` de produção corresponde ao destino
canônico da Edge pública, conforme inspeção autenticada read-only na Vercel.

O código da Edge pública (ainda **não implantado** nesta revisão) separa
agora `account-public-bridge-unconfigured` (credencial nomeada ausente) de
`account-gateway-unavailable` (transporte interno rejeitado/falhou). Ambos
mantêm status 503 e não acionam cadastro/login. A implantação anterior v2
pode produzir o segundo código nos dois cenários e **não permite concluir
qual deles aconteceu** sem nova prova após implantação revisada. Não tratar
falhas como estado normal de Conta desativada no monitor público.

## Prova runtime publicada v3/v6 (2026-10-09)

Owner imutável do código: `ordaxsystems/ordax-os`, commit `fd17f81a1092c3c587bd1c6009c6c1c80c93779d`.
Supabase canônico `jhfphsjptrpmtnzkpwud`:

- Pública `ordax-public-account-gateway`: ACTIVE v3, platform `verify_jwt=false`, artefato SHA256 `2fdfb1f177e40e294ebdc0215de0c64675ff5b51bd12e13b9e350bbd63fe03bf`; autorização OIDC Vercel assinada ocorre no handler. Consulta direta sem OIDC devolveu **403**.
- Interna `ordax-account-gateway`: ACTIVE v6, platform `verify_jwt=false`, artefato SHA256 `6f27b767012ec06ddaa470f0fcb9d866aac83697bd703c46c21645cab82c0758`. A autenticação do handler permanece em `_shared/account_transport_admission.mjs`: named `sb_secret_` somente para serviço, `getUser`/refreshSession Supabase para Native e bootstrap anônimo com método/caminho exatos.
- HTTP de prova (sem contas nem secrets): interno `/health` **200**; `/account/export` sem sessão **401**; marcador público sem chave **403**; sessão Native anônima **200**. Portanto a mudança do JWT de plataforma não implicou liberação indevida de rotas protegidas nesses casos.
- Site público `/auth/session` devolveu **503 `account-public-bridge-unconfigured`**: identidade Vercel assinada chegou à Edge pública, mas a chave de serviço nomeada `ordax_account_public_bridge` não está provisionada. NÃO usar `default`/`service_role` como substituto. Provisionar a chave pelo Supabase Settings > API keys no projeto canônico, então testar HTTP positivo/negativo e rotação.
- Cadastro/login web continuam fechados porque os documentos legais não são versões finais aprovadas, política ativa ausente, registros de consentimento não disponíveis e o E2E real de email/sessão/recovery ainda não passou. Não ativar flags antes dessas provas.

A liberação do MVP **não** se fundamenta só nesses testes negativos: `destination_service_transport_runtime_verified=false`, `destination_named_bridge_runtime_e2e_verified=false`, `internal_gateway_runtime_e2e_verified=false` e `active_legal_policy_present=false` continuam bloqueados.

## Correção de nome da Secret API Key (2026-10-09)

A tela de criação do Supabase aceita **somente letras minúsculas, números e `_`** no **nome** de Secret API Keys. O nome anterior com hifens não podia ser salvo, mantendo a ponte fechada. O identificador canônico agora é **`ordax_account_public_bridge`**. Essa chave secreta confere privilégios elevados e **nunca deve aparecer no frontend, chat, logs ou Git**; só o nome pode ser documentado. O verificador aceita exclusivamente a chave nomeada no objeto `SUPABASE_SECRET_KEYS`, sem fallback para `default`, service_role, publishable key ou antiga chave com hifens. Depois de implantar ambas as Edge Functions com o mesmo código, crie a chave nomeada no projeto Supabase canônico. Verifique o HTTP `/auth/session` e a negação de rotas não autorizadas antes de prosseguir com registro e aceite legal.
