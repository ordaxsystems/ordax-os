# COMMERCE-001 — Assinaturas, benefícios e adicionais

- **Tipo:** plano de implementação
- **Maturidade:** READY para catálogo/apresentação; billing depende de integração real
- **Execução:** autorizada explicitamente pelo operador em 2026-10-22
- **Escopo atual:** catálogo canônico, benefícios, adicionais e apresentação pública/Conta
- **Owners:** `docs/contracts/entitlements.json`, `docs/ACCOUNT-SYNC-AND-PLANS.md`, `system/services/entitlements`, `docs/PUBLIC-SITE.md`

## Resultado

Free, Personal, Professional e Team mantêm os IDs existentes. O mesmo catálogo
registra preços/capacidades de referência, MCP avulso e adicionais. Landing e
Conta usam uma projeção determinística sem inventário comercial paralelo.

Valores numéricos vivem exclusivamente no contrato. Capacidade de membros de
Space não é quantidade de assentos pagos. Não contratar planos enquanto essas
condições e os respectivos serviços reais não estiverem fechados.

## Incrementos

1. **Catálogo e apresentação — implementado neste incremento:** ofertas de
   referência, tradução PT/EN, projeção compartilhada, validação e testes.
2. **Medição:** tool calls MCP, retries idempotentes, presença/polling internos,
   SQL/CPU/tráfego/logs, armazenamento lógico, automações e taxas externas.
3. **Billing:** selecionar/configurar provedor real, confirmar preços/assentos,
   checkout server-side, eventos verificados/idempotentes, reconciliação,
   pagamento recusado, cancelamento e downgrade. Compra não é autorização de ação.
4. **Assinatura na Conta:** ler plano, vigência e consumo do owner real; não
   converter catálogo de referência em assinatura contratada.
5. **Serviços cloud:** provar upload/download/restore, cotas transacionais,
   isolamento e continuidade antes de comercializar os benefícios.
6. **Produtos adicionais:** Flow com orçamento de API; conteúdo/pesquisa/compute
   e módulos empresariais somente conforme disponibilidade própria.

## Regras

- identidade, OS local e dados próprios independem de assinatura;
- categorias de Profile não criam cobrança ou permissões;
- MCP incluído e avulso não se cobram duas vezes para a mesma capacidade;
- uso do GPT pessoal do cliente não é inferência paga pela OrdaX;
- Flow/API, pesquisa paga, mídia cloud e compute têm orçamento próprio;
- referências não concedem cotas: billing e alocação paga permanecem desligados;
- downgrade mantém dados e export/delete; retenção pós-cancelamento é explícita;
- não promover Food/Fabrication/Healthcare ou outros roadmaps por este plano;
- homologação de source, CI, deploy público e pagamento real são evidências distintas.

## Aceite do incremento atual

- alterar preço/capacidade na autoridade muda a apresentação sem editar páginas;
- landing e Conta mostram o mesmo catálogo, sem checkout nem sessão fictícia;
- conteúdos gerados e preços são traduzidos/formatados sem acesso a credenciais;
- build/manifest e viewport são verificados; publicação usa o projeto existente;
- apenas a integração real de billing futura pode mudar o gate de compra.
