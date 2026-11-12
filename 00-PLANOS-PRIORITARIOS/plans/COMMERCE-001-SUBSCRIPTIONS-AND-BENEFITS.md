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
2. **Medição — implementação pronta, homologação MCP P0 bloqueada:** tool
   calls MCP, retries idempotentes e exclusão de presença/polling internos
   possuem agregador privado na Platform e leitura autenticada na Conta;
   coleta real ainda não comprovada. SQL/CPU/tráfego/logs, armazenamento
   lógico, automações e taxas externas continuam incrementos separados.
3. **Billing:** selecionar/configurar provedor real, confirmar preços/assentos,
   checkout server-side, eventos verificados/idempotentes, reconciliação,
   pagamento recusado, cancelamento e downgrade. Compra não é autorização de ação.
4. **Assinatura na Conta:** ler plano, vigência e consumo do owner real; não
   converter catálogo de referência em assinatura contratada.
5. **Serviços cloud:** provar upload/download/restore, cotas transacionais,
   isolamento e continuidade antes de comercializar os benefícios.
6. **Produtos adicionais:** Flow com orçamento de API; conteúdo/pesquisa/compute
   e módulos empresariais somente conforme disponibilidade própria.

## Gate canônico de homologação MCP (não comercial)

**Bloqueio em produção em 2026-10-22:** o Worker Cloudflare `ordax-mcp`
autentica sessões, mas `ordax_targets` retorna
`product_targets_unavailable`. O incidente autoritativo é
[ordax-platform #235](https://github.com/ordaxsystems/ordax-platform/issues/235)
(Hyperdrive → PostgreSQL). Diagnósticos de Supavisor/IPv6, credenciais e
restrições de rede permanecem sob esse incidente e seus probes oficiais.
Não criar REST/D1 alternativo, segundo medidor ou SQL em outros serviços.

**Implementado, distinto de homologado:** a Platform já possui
`ordax_record_product_mcp_usage_v1` e
`ordax_get_product_mcp_usage_v1`; a Conta tem a apresentação e os
gateways publicados. O medidor ainda depende das flags/segredos de
implantação, desligados por padrão. Dados ausentes **não são zero uso**.

A passagem a `medição homologada` exige evidência na mesma execução:

1. O script canônico `scripts/verify_ordax_mcp_live.py` em
   `ordax-platform` prova `postgres_ready`, `oauth_discovery_ready`
   e `supports_remote_actions`; `ordax_targets` autentica e enumera o
   dispositivo autorizado com os grants corretos.
2. Antes de coletar amostras, validar por consulta somente leitura as ACLs
   das RPCs e a presença das migrations no PostgreSQL canônico; guardar
   os identificadores de revisão/implantação, sem credenciais ou PII.
3. Habilitar **apenas** a coleta `shadow` por configuração versionada,
   com chave HMAC protegida na infraestrutura autorizada. Nunca por
   mudança no catálogo comercial, grant de Conta ou script de marketing.
4. Executar chamadas MCP reais e bem-sucedidas, incluindo tentativa
   repetida, erro, ping e polling. Comparar o delta de chamadas do owner
   autorizado no agregado privado, verificando deduplicação, exclusões,
   janela UTC e isolamento. Não fabricar linhas de consumo no banco
   de produção para completar a prova.
5. Verificar a projeção autenticada da Conta sem expor bearer ao navegador.
   A leitura pública só poderá ser ativada depois dos gates de identidade,
   privacidade e publicação já existentes no OS; a exibição deve continuar
   marcada `partial_observational`, nunca `billable`.
6. Registrar relatório E2E no owner canônico do incidente e somente
   então atualizar este plano como homologado. Ativar plano pago, quotas,
   checkout e cobrança exige **outro** gate de billing, contrato e
   reconciliação financeira; não é consequência da medição.

O owner das ações de computador, permissões e sessão continua na
Platform/Runtime/OS conforme seus contratos; o Commerce não promove
`ordax_targets`, contorna o heartbeat nem altera credenciais Hyperdrive.

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
