# OrdaX — Design System e publicação dos e-mails (SSOT)

**Status (09/10/2026):** ponte de distribuição implementada; publicação
de templates de produção somente mediante autorização e segredo configurado.
A composição Meia-noite/Gelo, o símbolo vetorial simplificado e seus temas
foram reconciliados e integrados na `main` pela PR #1546, preservando
a implementação original da PR #1532, encerrada como substituída.

## Dono único

- Paleta semântica/tema: `system/surface/ui/tokens.css`. Não copiar cores
  para CSS do site, aplicativos ou HTML de e-mails.
- Composição e símbolo: `system/surface/ui/identity.css` e
  `system/surface/ui/brand/ordax-symbol.png`. A imagem transparente aprovada
  pelo usuário em 09/10/2026 é a única fonte do símbolo. O compilador público
  deriva `/assets/ordax-symbol.png` por cópia verificada; o site não mantém
  outra imagem no source. OS, inicialização, Minha conta e acesso Web
  exibem as cores originais. Alto contraste usa a transparência do mesmo
  arquivo para produzir a silhueta.
- Estrutura e conteúdo de e-mails: `infra/supabase/identity/email-templates/src`.
  Os arquivos adjacentes `confirmation.html` e `recovery.html` são
  **resultados compilados e versionados**, não fontes a editar manualmente.
- O build do site injeta automaticamente `/assets/ordax-design-tokens.css`
  derivado da Surface em todas as páginas sem reescrever o source do layout
  Web em andamento. Componentes passam a usar as variáveis CSS
  `--ordax-*` conforme são migrados; o layout atual é preservado.

## Comandos

```bash
python3 tools/brand/build.py render-emails
python3 tools/brand/build.py check
python3 tools/public-site/build.py check
python3 tools/public-site/build.py build --source-commit <SHA-40>
python3 tools/public-site/build.py verify
```

O gate `check` exige que o HTML versionado corresponda aos tokens oficiais.
Se a Surface alterar a paleta, execute `render-emails` e envie **as saídas
geradas no mesmo PR**. A validação falhará caso alguma origem e saída divirjam.
A ponte Web é regenerada automaticamente em cada build, sem novas alterações
manuais após a aprovação visual.

## Publicação no Supabase Auth

O Supabase Auth é dono dos tokens de confirmação e recuperação; Resend é somente
transporte SMTP. A publicação dos templates usa a API oficial de gestão,
`PATCH /v1/projects/{ref}/config/auth` e **altera apenas**:
`mailer_templates_confirmation_content`, `mailer_subjects_confirmation`,
`mailer_templates_recovery_content` e `mailer_subjects_recovery`.
Não toca em SMTP, remetente, autenticação, sessões ou URL Configuration.

A publicação requer token de gerenciamento restrito via
`SUPABASE_ACCESS_TOKEN` (preferir token fino com `auth_config_write`),
projeto exato `ordax-platform`, checagem prévia do Site URL HTTPS,
SMTP Resend e confirmação obrigatória e autorização explícita:

```bash
python3 tools/brand/build.py publish-emails --project-ref jhfphsjptrpmtnzkpwud --approve-production-write
```

Nunca colocar token/segredo em commits, logs, templates ou mensagens.
A edição manual no painel do Supabase pode causar drift; reexecutar
`check` e o publish após aprovação reconcilia a saída. Publicação de
recuperação **não habilita** o endpoint de redefinição, que mantém seus
gates de produto e testes E2E separados.

**Limites atuais:** o novo vetor da marca precisa passar pelos testes da
Surface. A etapa de publicação gerenciada requer segredo e autorização; sem
eles, o pipeline apenas prepara/valida artefatos, não afirma sincronização
com o Supabase em produção. E-mails dependem de estilos inline compatíveis
com clientes de e-mail; layouts de tela Web/OS não são copiados literalmente.

## Publicação contínua após integração inicial

O workflow `.github/workflows/ordax-auth-email-templates.yml` é acionado
**somente após** sucesso de `Public Site Candidate` na `main`, e rejeita
um SHA que já não seja o HEAD da branch. Usa o ambiente GitHub protegido
`ordax-auth-templates-production`, com secret
`SUPABASE_AUTH_TEMPLATES_TOKEN` (token de gestão Supabase de permissão
mínima), sem criar ou expor credenciais na execução. O workflow também permite
republicação por acionamento explícito (sempre do HEAD da main).

Se o ambiente/secret não estiver configurado, a saída é explicitamente
`AUTH_EMAIL_TEMPLATES=NOT_PUBLISHED`, sem fingir sincronização com produção.
Depois que o responsável configurar o ambiente e suas aprovações, novas
alterações de tokens/templates aprovadas e compiladas são publicadas sem
recopiar HTML no dashboard. Revisões estruturais do layout Web não
alteram automaticamente a estrutura dos e-mails: compartilham somente os
valores semânticos da marca.

## Aplicação ao Web sem substituir o logotipo (2026-10-09)

As páginas públicas de **Conta OrdaX** (login, cadastro, conta,
recuperação e documentação legal) agora consomem variáveis canônicas
`--ordax-*` em seus tokens semânticos de fundo, superfície, texto,
bordas, foco, CTA e status. O compilador exporta os estados/raios
necessários diretamente de `system/surface/ui/tokens.css`; não cria
nova paleta nem sobrescreve temas ou CSS de aplicativos.

A marca do cabeçalho, incluindo o atual HTML `.brand-mark` e as suas
regras CSS, permanece **intocada**. O SVG geométrico existe como
asset separado, mas **não é aplicado** nas páginas enquanto o asset
final do conceito visual não for aprovado. Nenhum PNG de geração é
copiado automaticamente para GitHub ou produção.

A landing `sites/public/index.html` e seu `playground.css` também
permanecem intocados, pois **não são o OrdaX Web como produto**.
Gradientes e arte decorativa legados são migrados por etapas, com
testes visuais; os tokens semânticos agora têm dono único e validação
no `tests/test_brand_pipeline.py`.

O build do Web injeta `/assets/ordax-design-tokens.css` em todas as
páginas. As páginas de identidade não dependem de configurações
duplicadas: a Surface é a única origem das cores, e o Supabase mantém
a autoridade sobre autenticação e sessões.

## Materiais e estados sem duplicar paleta (2026-10-09)

Os componentes existentes de cadastro/login, conta, recuperação e documentos
públicos agora derivam também **fundos de cartões, gradientes, camadas,
bordas, radius, focus, botões e estados semânticos** de `--ordax-*`.
Estados de autenticação prontos usam `--ordax-success[-bg]`; falhas de
serviço usam `--ordax-warning[-bg]`. Valores decorativos translúcidos
são obtidos de `color-mix(in srgb, var(--ordax-*), transparent)`, sem
introduzir uma segunda paleta nem cor de referência no HTML.

A imagem decorativa `aurora-titanium.png`, os estilos e estrutura do
logotipo existente (`.brand*`) e **toda a landing/experiência demonstrativa**
permanecem intocados. Nenhuma substituição de asset está implícita nesta
etapa. A autenticação, o Supabase e os modelos Resend não são alterados.

Regressões adicionais em `tests/test_brand_pipeline.py` inspecionam os
materiais visíveis para bloquear o retorno acidental de cores CSS literais
em fundos e bordas estruturais. A Surface mantém a responsabilidade
exclusiva pelos tokens de identidade.

## Downloads públicos — SSOT visual (09/10/2026)

A página `/download/` passa a consumir os tokens da Surface em seus
materiais principais: superfícies do Creator, status do catálogo, botão de
publicação, cartões do preparo e alerta de apagamento de dados do USB. O
aviso de risco usa `--ordax-warning` e `--ordax-warning-bg`. Gradientes
transparentes utilizam `color-mix` sobre a paleta canônica.

O logotipo antigo da navegação, `download-hero.png`, a landing e o controle
de releases públicas permanecem sem mudanças. O logo novo fica para uma PR
separada após aprovação do asset correto. Há cores decorativas secundárias
ainda elegíveis a migrações posteriores, sem bloquear o MVP.

## Substituição pelo símbolo aprovado — 2026-10-09

A aprovação explícita do usuário substitui o vetor simplificado no OS, na
inicialização e nos portais Minha conta/Web. Os registros anteriores sobre
preservação da marca pública descrevem aquela etapa. O arquivo tem SHA-256
registrado no owner da Surface. A publicação continua sujeita aos gates de
cada produto. Identidade, planos e autenticação mantêm os serviços canônicos.
