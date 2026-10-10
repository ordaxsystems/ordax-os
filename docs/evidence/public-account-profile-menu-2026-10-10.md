# Menu de Conta no cabeçalho público — 10/10/2026

O menu de **Minha conta** utiliza exclusivamente a sessão verificada de
`/auth/session` no domínio canônico `ordax.com.br`. Não possui cookies,
armazenamento local, executor ou cadastro próprios.

O owner de interação é `sites/public/assets/site.js`; o CSS compartilhado
reside em `sites/public/assets/site.css` e os textos são localizados pelo
`sites/public/i18n/catalog.js`. Após sessão autenticada, o botão no
cabeçalho revela **Visão geral, Segurança, Dispositivos, Preferências e
Sair da conta**. As rotas de gerenciamento apontam para suas seções
reais em `/conta/#...`; sair faz POST no endpoint oficial
`/auth/logout`. O elemento de menu é criado uma vez por validação e
removido em revalidação, troca de idioma ou sessão revogada.

Requisitos de UX: funcionamento em desktop e mobile, teclado (Enter,
Espaço, seta para baixo, Escape), clique fora, foco controlado e
`aria-expanded` consistente. Para sessão anônima ou falha de serviço,
o cabeçalho mantém somente opções públicas; o menu nunca deve indicar
autenticação fictícia. Toda ação de logout usa POST do navegador,
sem simular resposta e sem criar outro owner.

O teste `tests/test_public_profile_menu.mjs` valida as transições
da interação, origens das rotas, POST, remoção dos listeners e ausência
para visitantes anônimos. `.github/workflows/public-site-candidate.yml`
inclui o novo teste nos gates oficiais.
