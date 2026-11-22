# OrdaX Intelligence — módulo canônico

O único código-fonte ativo de roteamento, inferência e streaming do Intelligence está em system/intelligence/src/ no mesmo commit Git do ordax-os.
Os serviços Native em system/services/intelligence/ e system/services/local-ai/ apenas injetam contratos e políticas canônicos do OS; não implementam uma segunda IA.

As portas públicas permanecem ordax.intelligence/1, ordax.model-router/1 e ordax.local-ai/1.
A Aura consome os serviços nativos de contexto do OS. Memória, permissões, Supervisor, assinatura, recuperação e seleção de modelos continuam sob autoridade do OS; MCP no Runtime e controle remoto na Platform.

Testes direcionados: npm --prefix system/intelligence run ci e npm --prefix system/intelligence run test:compat.
A empacotadora produz somente source, sem engine, GGUF ou ativação.

Plano contextual canônico: docs/plans/INTELLIGENCE-001-AURA-CONTEXTUAL-INTELLIGENCE.md (fases futuras não autorizam ativação).
