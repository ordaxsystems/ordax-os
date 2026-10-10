# Migração literal da Minha Conta — Lovable → OrdaX oficial

## Estado em 2026-10-10

**Branch de trabalho, não publicada.** Os arquivos de React, modelo e CSS
copiados em `lovable-original/` preservam os mesmos SHA de blob do commit
`washingtonmsdj/account-hub-pro@0f955ece6e570801976d8ed77d2cada101b7a3fa`.
Os hashes individuais são registrados em `lovable-source.json`.
A fonte privada continua privada; não copiar credenciais, .env, tokens ou
dados de usuários. Nenhum arquivo dessa branch foi mesclado em `main`.

A migração anterior `sites/public/conta/` era uma reimplementação HTML/CSS.
Esta migração tem outro objetivo: **usar de fato a árvore de componentes, CSS e
assets do Lovable**, com adaptadores explícitos para o backend OrdaX.

### Dependência externa para completar a cópia

A captura final usa `src/assets/ordax-landscape.jpg`,
`src/assets/ordax-mark.png` e outros binários. O GitHub App permite ler o
código em texto, mas a transferência de binários de um repositório privado
entre as duas instalações GitHub não está disponível nesse conector. Um
workflow isolado da fonte tentou gerar um artifact de exportação e recebeu
`Artifact storage quota has been hit`. **Não usar imagens substitutas para
alegar fidelidade.** Para completar, materializar/exportar o ZIP original
do Lovable (Code → Download ZIP) com `src/assets/`, juntamente com as fontes
necessárias, e conferir SHA contra o GitHub. Não fazer a fonte privada pública.

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
