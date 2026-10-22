# Auditoria de identidade OrdaX — 2026-10-22

## Escopo, evidência e limites
Auditoria de login, registro, sessão e consentimento em USB Dev/MVP, Surface Native, emulador Windows, OrdaX Web, site público e Account Gateway. Fontes: branch `main` do `ordaxsystems/ordax-os`, contratos canônicos do repositório e inspeção somente leitura no projeto Supabase `ordax-platform`. A consulta ao banco encontrou **uma política legal ativa** nesta data, mas **não comprova** configuração SMTP/redirect/antibot ou cadastro E2E. Não houve criação de usuários, alteração de tokens, mudança da mídia física nem ativação de funcionalidades na produção.

## Fonte única de verdade (SSOT)
| Responsabilidade | Dono canônico | Não deve ser reimplementado em |
| --- | --- | --- |
| Usuário, credenciais e sessão autenticada | Supabase Auth do `ordax-platform`, mediado pelo Account Gateway | USB, JS do navegador, emulador, site |
| Política legal de cadastro e aceite vinculante | `private.ordax_account_legal_policies` e RPCs de cadastro; `infra/supabase/functions/ordax-account-gateway/index.ts` | Flags locais no USB/emulador ou documentos com status manual |
| API de identidade | `/auth/session`, `/auth/registration-policy`, `/auth/login`, `/auth/register`, `/auth/logout` no Account Gateway | Novas APIs paralelas por plataforma |
| Borda pública e proteção da sessão Web | `ordax-public-account-gateway` + integração same-origin do site | Cookies de provedor expostos à Surface |
| Transport Native | `system/surface/runtime/native_account_gateway.py` via `native_host_server.py` | Cliente Supabase direto no JS |
| Modelo de sessão/açao/apresentação | `system/contracts/identity-*.mjs` e serviços de conta | Estado alternativo independente no site |
| Modo local e PIN | First Run / Local Session Native | Senha da conta em nuvem |

## Achados confirmados
1. **P0 — bloqueio paralelo no USB:** `native_host_server.py` forçava `registrationEnabled=false` e interceptava `POST /auth/register` com 503. A suíte de integridade exigia essa constante. Corrigido em `fix/identity-ssot-20261022`: agora o resultado é da autoridade remota, sem mudança do contrato de aceite obrigatório.
2. **P0 — emulador divergente:** `tools/windows-emulator/account-gateway.mjs` replicava a proibição mesmo se o serviço permitisse o registro. Corrigido na mesma branch, com validação de credenciais, status de confirmação pendente e testes.
3. **P0 — fronteira de ativação ainda distinta no backend:** `ACCOUNT_REGISTRATION_ENABLED=false` e `PUBLIC_WEB_AUTH_ENABLED=true` na versão de fonte inspecionada do Gateway. Cadastro pela Web não prova cadastro liberado para chamadas nativas. Não mudar essa decisão sem provas de segurança do canal Native. A legal policy ativa no banco não equivale a autorização de toda superfície.
4. **P1 — evidência operacional desatualizada:** `docs/contracts/public-auth-hardening.json` e `docs/contracts/public-auth-provider-policy.json` incluem observações de 2026-10-16 e 2026-10-09; a política legal observada no banco mudou desde então. Não reescrever flags de `verified` sem testes atuais.
5. **P1 — infraestrutura de confirmação/recovery não comprovada:** os contratos registram pendências históricas de SMTP, allowlist de redirecionamento, recuperação, revogação e Turnstile E2E. O cadastro deve continuar subordinado ao Gateway. O estado real precisa de nova comprovação operacional.
6. **P2 — múltiplos adaptadores não são múltiplas autoridades:** `sites/public/assets/site.js`, `system/adapters/web/identity-credentials.mjs`, `native_account_gateway.py` e o emulador têm transportes específicos. Não duplicar regras de negócio nesses adaptadores; consolidar testes de contrato.

## Regras de arquitetura
- **Uma conta, vários canais**: nenhuma Surface cria identidade própria nem salva JWT em armazenamento do JS. O USB segue usando sessão em memória/kernel keyring, sem tokens de provedor persistidos em texto aberto.
- **Serviço falhou = disponibilidade desconhecida; não cadastro aprovado**. Não renderizar autenticação bem-sucedida antes de revalidar `/auth/session`.
- **Consentimento é versionado e server-side**: exibir versões/hashes dos documentos; não criar conta sem aceite e recibo; revogação na autoridade desabilita também Native.
- **Não confundir modo local com login em nuvem**. O MVP permanece utilizável sem conta e sem rede.
- **Fluxo de produção não é fluxo de desenvolvimento**. Dev pode receber rapidamente novos builds, mas nunca contornar controles de registro, identidade, segredo ou consentimento.
- **Sem substitutos de provedor e sem write paralelo**. Migrar backend por cutover comprovado, não por múltiplos bancos de usuários.

## Gates de aceite antes de ativar Native e integrar em main
1. Contratos e testes automáticos Python/Node aprovados: policy true/false/offline, 400/401/403/429/503, registro 202, confirmação, sessão autenticada, saída e não persistência de cookies/tokens.
2. Provider e borda: política ativa/verificável, SMTP e domínio de envio, confirmação por email, URL HTTPS exata sem `localhost`, rate limit, Turnstile quando exigido, legal receipt, anti-replay, CSRF e erros sem enumeração de contas.
3. **Prova real** isolada no Account Gateway e no site público, com usuário descartável autorizado, sem expor senhas. Provar depois o caminho Native no QEMU/emulador e, só com autorização de gravação, no USB físico.
4. Validar CI canônica e revisão de alterações de `main` concorrentes antes do merge. A instalação USB deve usar o caminho de atualização versionado e A/B, nunca escrita física informal.
5. Registrar em documentação oficial **resultados comprovados e falhas pendentes**, em vez de promover source-readiness a produção.

## Estado desta execução
PR dedicada: https://github.com/ordaxsystems/ordax-os/pull/2104. A remoção das duas proibições locais e os testes foram preparados em branch; até aprovação de CI e provas de canal nativo, **não afirmar cadastro Native funcional em produção, não publicar nova Base e não atualizar USB físico**.

## Verificação adicional (2026-10-22) — depois do merge #2104
- PR #2104 integrada na main no commit `296d809d77cc3464f2c6cc8f40aeae563717dfa9`, com 13/13 workflows concluídos em sucesso, inclusive QEMU.
- HTTP de produção consultado pelo OrdaX MCP: `https://ordax.com.br/cadastro/` → 200; `https://ordax.com.br/auth/registration-policy` → 200, `active=true`, `registrationEnabled=true`; `https://ordax.com.br/auth/session` → 200, sessão anônima correta.
- Gateway Native assinado `https://jhfphsjptrpmtnzkpwud.supabase.co/functions/v1/ordax-account-gateway/auth/registration-policy` → 200, `active=true`, `registrationEnabled=false`. Portanto a divergência restante está na **admissão de registro do servidor**, não no cliente USB. A política legal ativa é compartilhada; disponibilidade por canal é diferente.
- O último deployment automático Vercel referente ao merge #2104 foi `CANCELED` pelo `Ignored Build Step`; a versão `READY` associada aos aliases `ordax.com.br` e `www.ordax.com.br` continua a ser a implantação `5e8f1d1b`. Não republicar o site por uma alteração somente Native.
- PR de continuação #2107: enquanto Native permanece bloqueado, a Surface oferece **navegação explícita ao cadastro público canônico** na primeira execução e na Conta, usando `HOSTED_ACCOUNT_SIGNUP_URL` derivado do contrato `PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin`. Isso mantém o sistema sem cadastro falso ou duplicação de identidade; o usuário confirma o e-mail no fluxo de domínio oficial e então pode voltar e entrar. O registro direto Native não é habilitado nesta PR.
- Provas E2E de SMTP/confirmar e-mail e cadastro real com credenciais autorizadas **não realizadas**, assim como abertura de navegador em USB físico e atualização da mídia. Não promover esses estados como comprovados.

## Próximo gate para registro direto Native
Comprovar primeiro a configuração **atual** do provedor (Site URL, allowlist de redirects, template oficial com token-hash, entrega SMTP, confirmação e revogação) e o controle antibot proporcional ao canal; só depois habilitar servidor Native mediante alteração versionada única no Account Gateway e testes negativos. Nenhum frontend deve converter `registrationEnabled=false` em autorização.

## Bloqueio P0 atual — site anuncia registro, mas falha integridade jurídica (2026-10-22)
- A política pública consultada informa `registrationEnabled=true`, `active=true` e documentos versão `2026.10.09`. Isso **não** é uma prova de que o formulário de registro possa ser habilitado.
- Verificação HTTP do conteúdo **binário** de `https://ordax.com.br/privacidade/` e `https://ordax.com.br/termos/` contra o SHA-256 anunciado pela própria API: **ambos divergem**. A verificação foi efetuada sobre bytes completos via SHA256 em .NET, não apenas texto, e não houve POST nem criação de usuário.
- Em `sites/public/assets/site.js`, `verifyPublishedRegistrationDocuments(policy)` faz o hash de cada página servida e retorna `false` quando diverge, antes de `renderRegistrationPolicy` habilitar o formulário. O modo público responde `legal.account_activation_ready=false`, `auth_only_source_enabled=true`.
- Divergência histórica já registrada na evidência `docs/evidence/public-legal-integrity-2026-10-10.md`: não é causada pela PR #2107 nem pode ser curada trocando hashes em políticas antigas.
- `docs/contracts/public-legal-snapshots.json` está com `status=no-approved-snapshots` e `snapshots=[]`; `docs/contracts/public-legal-readiness.json` não autoriza ativação, e ainda exige aprovação de dados do operador. É incorreto alegar que o fluxo de cadastro do site esteja funcional.
- **Gate obrigatório:** revisão do responsável legal; criar nova versão de Política e Termos em `/legal/<versao>/...` com bytes imutáveis, hashes e ledger; publicar e verificar esses bytes; só depois ativar por `.github/workflows/public-legal-policy-activation.yml` na main com autorização. Comprovar navegador, SMTP/confirmacão, sessão, rate limit/revogação e Native antes de declarar aceite.
- A navegação para `HOSTED_ACCOUNT_SIGNUP_URL` da PR #2107 é apenas fonte/UI candidata. **Não a promover como solução funcional** enquanto o formulário hospedado for bloqueado. A PR deve permanecer em draft ou ter lançamento condicionado à integridade legal e à prova real de registro.
