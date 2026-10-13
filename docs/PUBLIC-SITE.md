# OrdaX Public Site

Este documento descreve **arquitetura, ownership e invariantes atuais** do site público OrdaX.
Ele não é um diário de deploy nem substitui contratos machine-readable ou evidências datadas.

## Autoridades canônicas

A ordem de autoridade é:

1. contratos machine-readable em `docs/contracts/`;
2. código e testes que implementam esses contratos;
3. evidências datadas em `docs/evidence/`;
4. este documento, como explicação humana da arquitetura vigente.

Estado histórico não deve ser copiado para cá como se ainda fosse atual. Quando uma prova de runtime muda, preserve a evidência em `docs/evidence/` e atualize o contrato proprietário correspondente.

Contratos principais:

- `docs/contracts/public-site.json` — superfície, rotas e capacidades do portal;
- `docs/contracts/public-site-deployment.json` — hosting, domínio, roteamento e observações de deploy;
- `docs/contracts/public-identity.json` — fronteira pública de identidade;
- `docs/contracts/public-auth-hardening.json` — endurecimento e evidências do owner de Conta;
- `docs/contracts/public-legal-readiness.json` — gates legais;
- `docs/contracts/public-release-catalog.json` — catálogo de releases públicas;
- `docs/contracts/release-compliance.json` — conformidade de distribuição.

## Fronteiras de produto

O site público é uma superfície de entrega independente do runtime do OrdaX OS e do produto OrdaX Web.

```text
ordax.com.br
  ├─ site público / marketing / download
  ├─ entrada pública de identidade
  ├─ portal autenticado /conta/
  └─ entrada do produto /web/ quando autorizada
```

O portal apresenta o **Stable/MVP** ao usuário final. Operações Owner/Development, Git, branches, PRs e mecanismos internos não fazem parte da experiência pública normal.

Uma mudança apenas no site não deve reconstruir kernel, bootstrap, Surface compartilhada ou release Native.

## Ownership de rotas

| Família | Rotas principais | Owner de apresentação | Owner funcional |
| --- | --- | --- | --- |
| Landing/marketing | `/` | `sites/public/` + assets próprios | public-site |
| Download | `/download/` | `assets/download.css` | catálogo público de releases |
| Identidade pública | `/login/`, `/cadastro/`, `/recuperar/`, `/recuperar/nova-senha/` | **`assets/account.css`** | `assets/site.js` + gateway público de Identity |
| Conta autenticada | `/conta/` e subrotas autorizadas | implementação canônica de Conta vigente | `GET /auth/session` + APIs server-side autorizadas |
| Legal | `/privacidade/`, `/termos/`, `/licencas/` | public-site | contratos legais e de compliance |
| Produto Web | `/web/` | Surface Web quando habilitada | owner do OrdaX Web |

### Família pública de identidade

Login, cadastro e recuperação são uma única família visual e usam o mesmo owner:

```text
sites/public/assets/account.css
```

Não existem owners visuais independentes `login.css` ou `cadastro.css`, e recuperação não pertence a `portal.css`.
As quatro rotas usam primitives `account-*` compartilhados e mantêm o fluxo mobile **task-first**: acesso/formulário antes do conteúdo institucional.

`assets/site.js` continua sendo o owner do comportamento de readiness, navegação autenticada, política de registro, Turnstile e habilitação dos formulários. CSS não decide disponibilidade de autenticação.

### `/conta/` é um portal, não um formulário de entrada

`/conta/` pertence ao mesmo modelo de Conta OrdaX, mas é uma superfície autenticada de aplicação. Ela não deve ser fundida artificialmente ao CSS dos formulários públicos apenas por compartilhar o conceito de Conta.

A implementação atualmente promovida na `main` continua sendo a autoridade até uma substituição **atômica** ser aprovada. O candidato React/Lovable do PR `#1596` não é fonte de verdade enquanto permanecer draft/bloqueado; não mantenha duas UIs de Conta ativas no produto depois de uma eventual promoção.

## Identity boundary

O navegador não implementa um provedor de identidade e não armazena senha, access token, refresh token, session ID ou segredo de serviço.

A fronteira é same-origin:

```text
browser
  -> /auth/* no domínio público canônico
  -> adapter/gateway OrdaX
  -> owner real de Identity
```

Invariantes:

- formulários nativos permanecem ocultos/desabilitados até o serviço autoritativo declarar readiness;
- `site.js` não lê valores de senha;
- cookies de sessão são responsabilidade server-side e devem respeitar os contratos de segurança;
- nenhuma rota pública pode criar uma conta apenas no navegador;
- nenhum provider externo é exposto como API privilegiada direta do browser;
- sessão anônima, política legal e disponibilidade de recuperação são gates distintos.

### Auth-only não é Full Account

O rollout público pode admitir login/cadastro em modo `auth-only` sem declarar a Conta/Cloud completa pronta.

`legal.auth_only_source_enabled` e `legal.account_activation_ready` têm responsabilidades diferentes. Uma sessão anônima válida ou uma política de registro ativa não prova recovery, sync, exportação, fechamento de conta, revogação global ou demais funções de Cloud.

Recuperação permanece **fail-closed** enquanto `recovery_url` / `recovery_complete_url` e as provas E2E correspondentes não estiverem configuradas e aprovadas. As páginas podem existir e explicar o estado, mas o formulário não pode ser habilitado por apresentação ou mock.

## Turnstile

Cloudflare Turnstile é a única dependência JavaScript remota permitida nessa fronteira e deve ser carregada apenas quando exigida pelos fluxos públicos protegidos.

O sitekey é configuração pública. O secret nunca pertence ao repositório ou ao browser. O token do widget não concede acesso sozinho: o servidor precisa validar Siteverify, hostname e action antes de encaminhar a operação.

Falha de configuração, timeout, token inválido/expirado/reutilizado ou mismatch de hostname/action deve falhar fechado.

## Brand e design SSOT

A linguagem visual pública deriva dos tokens canônicos da Surface através do pipeline de brand. O bundle público recebe `assets/ordax-design-tokens.css`; páginas públicas não devem manter uma segunda paleta literal concorrente.

Para identidade pública:

```text
system/surface/ui/tokens.css
  -> pipeline de brand
  -> ordax-design-tokens.css
  -> account.css
  -> login / cadastro / recuperação
```

`account.css` pode definir aliases semânticos locais, mas não pode se tornar uma segunda autoridade de cor, raio, tipografia ou estado.

O portal autenticado `/conta/` pode ter composição própria de aplicação, desde que continue consumindo os mesmos tokens e contratos. Compartilhar identidade visual não significa compartilhar markup ou CSS monolítico.

## Localização

O owner de localização do portal é:

```text
sites/public/i18n/
```

PT-BR é locale fonte/default e en-US deve manter paridade de chaves e placeholders para o escopo declarado como bilíngue.

Locale altera somente apresentação. Ele nunca altera:

- readiness de Identity;
- política legal;
- autorização de release;
- same-origin policy;
- gates fail-closed.

Não crie um segundo dicionário dentro de componentes React ou páginas isoladas. Novas implementações da Conta devem consumir o catálogo oficial antes de alegar paridade en-US.

## Download e execução USB

O site nunca hardcodeia uma release como “latest” nem fabrica disponibilidade.

`/download/` consome o catálogo same-origin gerado deterministicamente a partir do owner de publicações. Sem release explicitamente autorizada, o catálogo válido permanece vazio e a UI não apresenta download inventado.

Fluxo público do MVP:

```text
site público
  -> OrdaX Creator autorizado
  -> release Stable/MVP autorizada
  -> verificação de integridade/confiança
  -> confirmação destrutiva do USB correto
  -> preparação e verificação do USB
  -> boot e execução direta do USB
```

Conta online não é requisito para download público autorizado nem para o primeiro uso do MVP. Instalação em disco interno permanece fora do MVP enquanto o owner de produto não mudar esse contrato.

## Build e validação

Comandos canônicos do artefato:

```bash
python tools/public-site/build.py check
python tools/public-site/build.py build --source-commit <40-hex-sha> --out-dir out/public-site
python tools/public-site/build.py verify --out-dir out/public-site
```

O `Public Site Candidate` é o gate de PR da superfície pública. Ele deve validar build determinístico, contratos, localização e testes de browser/viewport aplicáveis.

Para provar o domínio real sem credenciais:

```bash
python tools/public-site/prove_deployment.py --origin https://ordax.com.br
```

Uma prova anônima verde não substitui E2E credenciado de login, cadastro, logout, expiração, recovery ou outras mutações de Conta.

## Deployment canônico

Há um único projeto oficial de produção do site público:

```text
Vercel team:    ordaxsystems
Project:        ordax-os-public
Git repository: ordaxsystems/ordax-os
Production:     main
Domain:         https://ordax.com.br
```

Não crie segundo projeto Vercel, domínio alternativo ou proxy paralelo para contornar quota, proteção, OIDC ou indisponibilidade temporária.

PRs são validados pelo `Public Site Candidate`. Deploy Git automático deve ficar restrito à `main`; previews automáticos de branches não são owner de validação.

**Merge não significa deploy.** O domínio só pode ser declarado atualizado depois que o deployment da `main` estiver `READY` e a prova externa confirmar o conteúdo esperado.

### Estado operacional observado em 2026-10-13

Após a consolidação da família pública de identidade, a Vercel registrou no commit da `main`:

```text
Deployment rate limited — retry in 24 hours.
```

Isso é um bloqueio externo de publicação, não autorização para criar hosting paralelo. A `main` continua sendo a fonte de código; produção pode permanecer temporariamente atrás dela até um deployment canônico concluir.

Detalhes operacionais e observações de runtime pertencem a `docs/contracts/public-site-deployment.json` e às evidências datadas, não devem ser duplicados indefinidamente aqui.

## Segurança

Invariantes permanentes do portal:

- nenhum private key, service-role key, password ou bearer token em `sites/public/`;
- nenhum token de sessão legível pelo JavaScript público;
- nenhum acesso browser direto a storage privilegiado;
- Identity e Sync same-origin por padrão;
- state changes exigem as proteções de origem/CSRF declaradas pelo gateway;
- responses de Conta/Sync sensíveis permanecem `no-store`;
- `Set-Cookie` só pode atravessar adapters conforme allowlist e atributos do contrato;
- disponibilidade de Conta e download falham fechado;
- fixtures, playgrounds e mocks nunca contam como prova de runtime;
- conteúdo legal aceito é versionado e ligado a digest; não reescreva receipts históricos.

## Regras para evolução

Ao alterar o site:

1. identifique o owner existente antes de criar arquivo, stylesheet, catálogo ou serviço novo;
2. reutilize o owner quando o conceito for o mesmo;
3. se uma nova superfície tiver responsabilidade distinta, documente a fronteira em vez de compartilhar estado implicitamente;
4. não use CSS/JS para contornar um gate server-authoritative;
5. não duplique estado do contrato em documentação narrativa;
6. preserve evidência histórica em `docs/evidence/`, mas mantenha este arquivo descrevendo somente a arquitetura vigente;
7. não promova `/conta/` React ou qualquer substituição grande sem remoção atômica da implementação anterior e gates equivalentes ou mais fortes;
8. não declare produção atualizada sem prova do deployment canônico.

## Referências

- `MVP.md`
- `docs/BRAND-SSOT.md`
- `docs/RELEASE-COMPLIANCE.md`
- `docs/contracts/public-site.json`
- `docs/contracts/public-site-deployment.json`
- `docs/contracts/public-identity.json`
- `docs/contracts/public-auth-hardening.json`
- `docs/contracts/public-legal-readiness.json`
- `docs/contracts/public-release-catalog.json`
- `docs/contracts/release-compliance.json`
- `docs/evidence/`
