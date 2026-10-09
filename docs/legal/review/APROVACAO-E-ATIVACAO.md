# Fechamento jurídico da Conta OrdaX — decisões para aprovação

**Estado: PENDENTE, não vigente.** Este é o único roteiro de revisão das
minutas em `docs/legal/review/`. Não altera os avisos públicos,
versões, data de vigência nem switches de cadastro.

| Decisão | Responsável | Estado |
| --- | --- | --- |
| Entidade controladora/prestadora real, CNPJ se aplicável, endereço e contato de suporte | Operador | PENDENTE |
| Canal de privacidade/titulares e encarregado quando aplicável | Operador e jurídico | PENDENTE |
| Mapeamento real dos dados/fluxos e bases legais LGPD por finalidade | Produto e jurídico | PENDENTE |
| Fornecedores, regiões, compartilhamento e transferência internacional | Operação e jurídico | PENDENTE |
| Prazos e políticas de retenção, exclusão, logs e backups | Produto e jurídico | PENDENTE |
| Público-alvo/idade mínima e regras de menores | Produto e jurídico | PENDENTE |
| Regras de cobrança, apps, marketplace, conteúdos e suporte efetivamente lançados | Produto e jurídico | PENDENTE |
| Direitos, exportação, encerramento, suporte e exceções legais | Produto e jurídico | PENDENTE |
| Textos jurídicos completos, versão e data de vigência | Jurídico e operador | PENDENTE |
| Validação dos HTML publicados e ativação via workflow, com recibo sanitizado | Operação | BLOQUEADO ATÉ APROVAÇÃO |
| E2E de cadastro, confirmação e recuperação com aceite real e logs sanitizados | QA/Segurança | BLOQUEADO ATÉ APROVAÇÃO |

## Sequência de ativação sem bypass

1. Aprovar textos finais, identidade do controlador, canais e decisões de
   privacidade/comércio. Não substituir pendências por fatos presumidos.
2. Gerar HTML acessível, versionado e imutável em
   `sites/public/privacidade/index.html` e `sites/public/termos/index.html`.
3. Atualizar de forma revisada `docs/contracts/public-legal-readiness.json`,
   com `final=true`, identificadores estáveis e datas efetivas. A marcação
   **não é** autorização para ativar toda a Conta.
4. Publicar no domínio canônico e comprovar os **bytes exatos** das duas
   páginas. O workflow manual compara o SHA-256 com a fonte e ativa a
   política PostgreSQL por RPC privilegiada no `ordax-platform`.
5. Verificar política ativa, intenção de cadastro válida e seu consumo
   em uma única transação com criação de conta/recibo legal.
6. Executar E2E de confirmação de e-mail, login, sessão e logout,
   recuperação, revogação, limites de abuso, exportação e encerramento;
   verificar redirecionamentos Supabase e fluxos Web/Native.
7. Ativar os switches de produção apenas no commit e deploy homologados;
   manter rollback e Guest Mode.

**Distinção legal importante:** o aceite obrigatório dos Termos de Uso não
é autorização genérica de tratamento de dados pessoais. As bases legais
devem ser fundamentadas separadamente.

SSOT de gate: `docs/contracts/public-legal-readiness.json`,
`docs/contracts/public-auth-hardening.json` e
`infra/supabase/product/account_destination_migration_plan.json`.
