# Migração literal da Minha Conta — Lovable → OrdaX oficial

## Estado em 2026-10-10

**Branch de trabalho, não publicada.** A importação inicial dos arquivos
em `lovable-original/` preservou os mesmos SHA de blob do commit
`washingtonmsdj/account-hub-pro@0f955ece6e570801976d8ed77d2cada101b7a3fa`.
Os hashes individuais são registrados em `lovable-source.json`.
A fonte privada continua privada; não copiar credenciais, .env, tokens ou
dados de usuários. Nenhum arquivo dessa branch foi mesclado em `main`.

A migração anterior `sites/public/conta/` era uma reimplementação HTML/CSS.
Esta migração tem outro objetivo: **usar de fato a árvore de componentes, CSS e
assets do Lovable**, com adaptadores explícitos para o backend OrdaX.

### Fonte e assets originais recebidos — comprovados

O proprietário anexou `account-hub-pro-main.zip` nesta conversa.
Todos os componentes importados foram comparados por SHA de blob Git com a
fonte privada, e os binários essenciais foram transferidos ao owner oficial
via blobs binários com os mesmos hashes Git:
- `src/assets/ordax-landscape.jpg` SHA-256 `7ddb6607fa2584e9702fe55a7c9d06e610ab1fe3db0f31e40757b7d9e0347294`;
- `src/assets/ordax-mark.png` SHA-256 `e261b8e4e12dccb83c9dc2bbb77155ec7e6e69fe70c5b0a1e6bfee58f492827c`.

A dependência de transferência de imagens está **resolvida**. O protótipo
original foi preservado byte a byte no primeiro commit de importação; os
componentes de Shell, Overview e Details receberam depois as adaptações
pontuais listadas em `lovable-source.json`.

### Candidato React compilável (ainda não publicado)

`lovable-original/src/account-entry.tsx` define uma SPA dedicada a
`/conta`, sem importar a landing page, Loja, Intelligence ou outros
produtos prototipados. A mesma árvore React e CSS original é compilada
estaticamente com Vite e Tailwind, usando `bun.lock` original, pelo
`Account Lovable Source Candidate`. Foram comprovados build e repetição
determinística, com imagens originais incluídas no bundle.

O adaptador `official-session.tsx` usa exclusivamente o contrato
`prototype-ordax.public-identity-session/1` do `/auth/session` same-origin,
sem criar backend, login alternativo, tokens no cliente ou memória de sessão.
Os controles de conta passam a expor os links reais de login/cadastro,
perfil verificado e o formulário `POST /auth/logout`. Sessões expiradas
limpam a identidade antes de revalidar. Informações de assinatura, consumo,
faturas e dispositivos ainda não integradas permanecem indisponíveis.

O caminho público `/conta/` continua com a implementação anterior até que
a SPA compilada seja integrada ao builder determinístico do `public-site`,
as rotas profundas e a autenticação passem nos testes E2E, e o deploy seja
promovido no projeto Vercel existente. **Não fazer merge da PR de importação
nem substituir a produção sem essas provas.**

### Arquitetura-alvo

1. **UI:** os componentes e estilos do Lovable são a fonte visual,
   incluindo Dashboard, cabeçalho, lateral, modais e telas internas.
2. **Adaptador único:** identidade via o owner existente
   `/auth/session`, logout via `/auth/logout`, demais mutações exclusivamente
   pelos contratos públicos oficiais. Não introduzir outro backend, sessão,
   memória ou conta.
3. **Estado real:** não afirmar plano pago, consumo, dispositivos,
   faturamento, confirmação de conta ou operação efetuada sem resposta válida
   dos owners reais. Remover fixtures apenas no runtime de produção; uma
   fixture pode permanecer em teste, claramente identificada.
4. **Roteamento:** manter `/conta/` e ações/links normais do site oficial,
   preservando login, cadastro, recuperação, políticas, versão Web,
   hash/back/forward/teclado e deep links funcionais. Não depender de um
   servidor TanStack Start separado na Vercel.
5. **Build:** pacote React estático versionado, saída determinística dentro
   do builder do site público; dependências pinadas e repetibilidade. A
   aplicação não deve pedir CSS/JS/fonts de terceiros durante a execução
   (CSP same-origin atual). Usar fonte/asset local.
6. **SSOT:** textos internacionais com o catálogo existente ou um ponto único
   consumido pela UI, sem dois dicionários independentes; manter política
   de segurança/cookies/cabeçalhos/proxy do site oficial. Não manter
   indefinidamente dois frontends concorrentes em produção.
7. **Troca controlada:** primeiro layout idêntico em preview e teste em
   sete viewports; depois integração autenticada e regressão dos fluxos
   existentes; somente então substituir `/conta/` em um único deploy,
   remover o antigo código de apresentação que deixar de ser necessário.

### Continuação: menu oficial e pacote reprodutível

O cabeçalho React oferece menu suspenso de identidade por
`@radix-ui/react-dropdown-menu` (dependência já presente no lockfile
original). Ações de perfil e segurança, bem como o botão **Sair da conta**,
ficam visíveis somente após a sessão verificada pelo contrato
`/auth/session`; login/cadastro aparecem na sessão anônima.
Não há identidade presumida nem segundo estado de autenticação.

O adaptador TSX é o único dono da leitura de sessão no React. O arquivo
antigo `official-session.ts` foi removido para impedir shadowing do
provador real. A camada `account-live.css` contém somente adaptações
necessárias de comportamento, sem reescrever `styles.css` Lovable.

O workflow Stage Original Account UI Bundle gera arquivos
`sites/account-ui/prebuilt` a partir da fonte e remove hashes antigos
antes de substituir o conjunto. Account Lovable Source Candidate
recompila e exige igualdade byte a byte entre fonte e prebuilt.
Public Site Candidate monta o pacote final e executa viewport/teclado/
menu/deep links nos sete tamanhos de tela, além de manter a prova do
layout HTML anterior até a ativação canônica.

A criação do bundle compilado **não constitui publicação ou aprovação
de produção**. As provas requeridas abaixo continuam independentes.

### Correções de prontidão para publicação

- `src/lib/account/navigation.ts` adapta o caminho absoluto de `/conta/*`
  ao catálogo de seções original; `model.ts` continua com SHA original
  intacto. Breadcrumb e destaque lateral usam o mesmo caminho.
- O rodapé jurídico usa o endpoint público `/privacidade/`, em vez de
  confundi-lo com o painel privado de dados e privacidade.
- O adaptador de sessão revalida no foco, na visibilidade e no retorno de
  histórico (bfcache). Identidade exibida no resumo é sempre derivada da
  resposta autenticada, nunca de fixtures.
- A prova Chromium exercita expiração de uma sessão autenticada **simulada
  somente dentro do navegador de teste**, exigindo que a identidade
  desapareça imediatamente; login real segue gate independente.
- `tools/public-site/should_skip_vercel_build.sh` agora inclui
  `sites/account-ui` no mesmo filtro do Vercel já existente. Testes impedem
  que edições na fonte ou no bundle sejam ignoradas em produção.
- O workflow de staging tem concorrência cancelável por branch e
  nunca usa force push. Um build ultrapassado não pode sobrescrever
  arquivos de versão posterior.
- A UI React atual é original em pt-BR. Antes de afirmar paridade de
  idiomas com o restante do site, traduzir os textos React pelo catálogo
  oficial `sites/public/i18n`, sem dicionário paralelo.

### Gates antes do merge

- Comparação de composição/asset em desktop, tablet, celular, teclado,
  elementos focáveis, contraste e redução de movimento.
- Sessão anônima, sessão verificada, sessão expirada, erro de backend,
  login/logout, página de conta e retorno do navegador; dados sensíveis
  nunca persistem indevidamente no frontend.
- Dados financeiros, permissões e dispositivos vazios de forma honesta;
  sem botões fictícios.
- `Public Site Candidate`, `Surface Web Candidate`, `Foundation Contract`
  verdes e build determinístico comprovado.
- Publicação apenas no Vercel `ordax-os-public`, com domínio
  `ordax.com.br`; nenhum projeto Vercel adicional e sem retrocesso de auth.

**A presença do código original nesta branch não significa migração concluída
nem UI disponível na produção.**
