# Inbox de planejamento

Use esta pasta para relatórios, pesquisas, ideias ou handoffs recém-chegados que ainda não foram confrontados com a `main` e a documentação canônica.

`INBOX` significa **não aprovado / não implementado / não priorizado / não executável**.

Antes de sair daqui, o material deve:

1. ser confrontado com `docs/CURRENT-STATE.md`, `MVP.md`, contratos e source atuais;
2. verificar se já existe owner/plano equivalente;
3. ganhar ID estável somente se realmente precisar sobreviver como item próprio;
4. declarar data, origem, limitações e fatos externos que precisam de revalidação;
5. receber prioridade, status documental e elegibilidade de execução;
6. ser movido para `reports/` ou convertido em plano em `plans/` somente quando isso reduzir ambiguidade, não para multiplicar documentos;
7. entrar no `REGISTRY.md` quando tiver identidade estável.

Durante o fechamento atual do MVP, novo material de planejamento deve assumir `DEFERRED FOR EXECUTION` por padrão. Exceção: um owner canônico do MVP já exige explicitamente a frente; nesse caso o trabalho pertence ao owner canônico, não ao arquivo da inbox.

Não implementar diretamente a partir de um arquivo em `inbox/` e não abrir task/issue/PR de produto apenas para triá-lo.
