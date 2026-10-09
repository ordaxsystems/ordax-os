# OrdaX — Design System e publicação dos e-mails (SSOT)

**Status (09/10/2026):** ponte de distribuição implementada; publicação
de templates de produção somente mediante autorização e segredo configurado.
O novo símbolo, a Surface e a composição Meia-noite/Gelo estão sob a PR
[#1532](https://github.com/ordaxsystems/ordax-os/pull/1532) e não são
reimplementados neste incremento.

## Dono único

- Paleta semântica/tema: `system/surface/ui/tokens.css`. Não copiar cores
  para CSS do site, aplicativos ou HTML de e-mails.
- Composição e símbolo: `system/surface/ui/identity.css` e a Surface, quando
  a PR visual correspondente for validada; o logo raster do conceito não é
  um SVG geométrico aprovado.
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
