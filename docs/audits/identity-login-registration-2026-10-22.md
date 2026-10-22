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

## Proveniência recuperada do HTML jurídico e lock gráfico (2026-10-22)

**Origem exata do descompasso legal, confirmada por bytes:** Git history de `sites/public/privacidade/index.html` e `sites/public/termos/index.html` foi percorrido no worktree remoto autorizado sem editar produção. O commit [`25bd5e855452d42d97d8e173a219977c7a5194c6`](https://github.com/ordaxsystems/ordax-os/commit/25bd5e855452d42d97d8e173a219977c7a5194c6) contém os documentos versão `2026.10.09` com SHA-256 **idêntico** à política legal ainda ativa:
- Privacidade: `0f79381f43b5ac69f0978d4d28eaa30844dd33eb20d03396f30dc268e5a04a80`.
- Termos: `efba2ef11af9a46eaad985b15b7f5612b5846d37f2b53f96f4eff87ebea38a4b`.

O commit subsequente [`f68e75f401a0569d23d319ceec225342cde8001d`](https://github.com/ordaxsystems/ordax-os/commit/f68e75f401a0569d23d319ceec225342cde8001d), intitulado `fix(account): atualizar header com sessão real OrdaX (#1543)`, modificou **três linhas de cada HTML** (cabeçalho) em 2026-10-09, mudando os hashes da resposta inteira sem uma nova ativação da política. A prova elimina especulação quanto à origem do descompasso, mas **não** autoriza desfazer funcionalidades do cabeçalho, publicar versões jurídicas antigas sem revisão, mudar hashes ou reescrever recibos anteriores. O tratamento correto exige instantâneos imutáveis, controle de versão da política e a aprovação do responsável definida no contrato legal.

**Gate de servidor desta PR:** `PUBLIC_WEB_AUTH_ENABLED` preserva login público e `PUBLIC_WEB_REGISTRATION_ENABLED=false` desliga o cadastro independentemente da interface. O preflight só permite mudar esse switch se `registration_activation_allowed=true` e o ledger possuir `approved-versioned-snapshots`. Até deployment do Gateway, o endpoint de produção pode divergir do source branch; nenhuma validação de interface substitui o bloqueio do servidor.

**Build Creator USB:** o erro `brotli-libs=1.1.0-r2` foi verificado pelo workflow oficial [Surface Runtime Candidate #39727906716](https://github.com/ordaxsystems/ordax-os/actions/runs/39727906716), que comprovou 253/253 pacotes, `missing=[]`, `extra=[]` e **apenas** `brotli-libs: 1.1.0-r2 → 1.1.1-r0`. Artefato `12403842578`, SHA-256 ZIP `751c94bdd078bd9202abc3195cfb632755aec7f3a0c47fef8980325265283d95`, lock resolvido `90e8b9621790ab22c41f1a4325a7cbc3a1ef6403c0b200d15b348b3fa8bd58ba`. A atualização do lock em `bootstrap/surface-runtime/source.json` incorpora a evidência completa sem fingir reaproveitamento de provas QEMU anteriores. A nova execução do workflow Surface Runtime Candidate em `3047fda0` aprovou a dupla construção EROFS byte-reprodutível; a comprovação física permanece independente.

## Gate de visibilidade da criação de contas na Surface (22/10/2026)

O Gateway canônico `GET /auth/registration-policy` passa a incluir dois campos Boolean de autoridades **diferentes**:
- `registrationEnabled`: o canal que fez a chamada pode registrar diretamente? Na Surface Native continua `false`.
- `publicRegistrationEnabled`: o **site público** tem registro liberado pelo switch operacional `PUBLIC_WEB_REGISTRATION_ENABLED`? Mesmo em chamadas Native, é apenas uma projeção read-only da autoridade pública, não uma autorização para POST Native.

O contrato compartilhado `system/contracts/identity-credentials.mjs` trata a ausência do novo campo (Gateway antigo) como `false` e recusa tipos não Boolean. Primeira execução e área Conta usam o mesmo `isHostedSignupEnabled`; a opção de abrir `/cadastro/` só aparece quando o servidor afirma explicitamente `publicRegistrationEnabled=true`. Caso contrário, apresentam a indisponibilidade real, mantendo login com conta existente e continuidade local sem conta. O URL permanece o único origin público de `PRODUCT_FAMILY_PUBLIC_ENDPOINTS` e a janela GTK isolada; esse campo não instala serviço, não cria conta e não contorna comprovantes legais.

**Estado da produção ao preparar esta alteração:** Gateway v17 (deploy Supabase 14) responde `registrationEnabled=false` e continua com `PUBLIC_WEB_REGISTRATION_ENABLED=false`; não há autorização para alterar o switch. A implantação do código desta melhoria terá que ocorrer depois do merge, sem mudança dessa política. O CI de deploy GitHub depende de `SUPABASE_ACCESS_TOKEN` ausente e falha fechado; o conector autenticado Supabase permite verificação explícita, mas não corrige o segredo faltante para próximos releases.
