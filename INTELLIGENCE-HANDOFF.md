# OrdaX Intelligence — HANDOFF TRANSVERSAL

> **Guia de retomada, não nova autoridade de código.** Este arquivo existe para que outros chats/agents entendam o trabalho e prossigam sem reiniciar, duplicar sistemas ou interpretar testes simulados como release. Revalidar a `main` e as PRs antes de implementar. Em divergência prevalecem código + contratos públicos, `docs/CURRENT-STATE.md`, `docs/README.md`, `MVP.md` e os documentos canônicos de domínio.

## Atualização operacional — 2026-10-13

A integração Native de Intelligence já ultrapassou o antigo estado de “runtime isolado”: `ordax.intelligence/1`, Local AI, model router, Memory autorizada, Assistant/Canvas e consumidores first-party possuem composição real em source. O gap transversal prioritário agora é **transporte/composição Web e integrações externas**, sem transformar a Surface em owner de provider.

A execução corrente está em:

- **#1757 — Intelligence integration closure**: tracking de Web transport, provider adapters, voz/arquivos e prova de release;
- **PR #1756 — canonical Web Intelligence boundary**: primeira fatia, ainda sem provider remoto. A composição Web atual (`Central`/Aura) recebe um client de `ordax.intelligence/1`; a ausência de transporte é representada por adapter Web fail-closed. O contrato público permanece inalterado.
- `docs/plans/INTELLIGENCE-INTEGRATION-CLOSURE-2026-10-13.md`: plano executável, invariantes e sequência de promoção.

**Não interpretar #1756 como IA Web já conectada a um backend.** A fatia cria a boundary correta para que um transporte suportado possa ser composto depois. ChatGPT/OpenAI/xAI, voz, arquivos, egress, credenciais remotas e prova física continuam gates separados.

O antigo caminho WebShell/demo de Intelligence não é a composição Web atual e não deve ser ressuscitado para “fazer a IA funcionar”. Ele só pode ser removido depois que busca de dependências + cobertura de replacement comprovarem que nenhum consumidor ativo depende dele.

## Tarefa de implementação ativa — próxima continuidade

1. Fechar **Phase 1 da #1756** com Intelligence Foundation, App SDK, Surface Web e demais CI canônicos verdes, sem relaxar gates.
2. Só depois iniciar **Phase 2 de #1757**: um adapter de transporte Web/remoto suportado, same-origin/owner-bound, fora da Surface, com contexto explícito e fail-closed.
3. Providers externos permanecem atrás de `ordax.model-router/1` e exigem adapter + egress + consentimento + isolamento de segredo + E2E antes de serem habilitados.
4. Voz/arquivo só entram quando os respectivos owners de mídia/arquivo e grants reais existirem; placeholders visuais não contam como integração.
5. Limpeza de demo/duplicação é posterior à prova de substituição; não apagar por nome ou idade.

A experiência adaptativa/Jarvis de #1572 continua relevante como UX/resultado, mas não deve voltar a ser tratada como ausência total de fundação: Work/Activity/Result, Canvas e fluxo foreground já tiveram implementação posterior. Revalidar a issue e a `main` em vez de reexecutar suas fases antigas mecanicamente.

## Leitura obrigatória

1. `AGENTS.md`, `docs/README.md`, `docs/contracts/repository-ownership.json` e `docs/CURRENT-STATE.md` — autoridade e estado atual.
2. `docs/INTELLIGENCE.md`, `docs/contracts/intelligence.json`, `system/services/intelligence/` — Intelligence, model router e limites de inferência.
3. `docs/APPLICATION-INTELLIGENCE.md`, `docs/APP-INTELLIGENCE-MANIFEST.md`, `docs/APPLICATION-ACTIONS.md` — catálogo semântico, intents, provedores de ações.
4. `PERSONAL-ORDAX.md` e `docs/PERSONAL-ORDAX.md` — Work, Activity, Result, approvals, grants e receipts.
5. `docs/plans/INTELLIGENCE-INTEGRATION-CLOSURE-2026-10-13.md` e issue #1757 — fechamento da integração corrente.
6. [Apps: Studio + ChatGPT em três superfícies](https://github.com/ordaxsystems/ordax-apps/blob/main/docs/STUDIO-CHATGPT-THREE-SURFACES.md), [Studio Web](https://github.com/ordaxsystems/ordax-apps/blob/main/docs/STUDIO-WEB-INTEGRATION.md).
7. [Platform: providers](https://github.com/ordaxsystems/ordax-platform/blob/main/docs/ORDAX_PROVIDER_CONNECTORS.md), [Product MCP](https://github.com/ordaxsystems/ordax-platform/blob/main/docs/PRODUCT_MCP_CONNECT.md), [Runtime: bridge experimental](https://github.com/ordaxsystems/ordax-runtime/pull/63).

## Decisão do produto

**OrdaX Intelligence pertence ao sistema, não ao Studio.** O OS/Web, Studio e os demais aplicativos são CLIENTES da mesma camada `ordax.intelligence/1`. O painel do OrdaX Web deve oferecer conversa contextual, seleção/estado de provedor e ações autorizadas sem uma segunda implementação de IA. Identidade visual e componentes podem ser adaptados por ambiente, mas não autoridade, Memory ou router.

**Modelo híbrido e neutro a provedores:** IA local (baseline offline); APIs remotas autorizadas com egress consentido; ChatGPT externo com plugin MCP; ChatGPT Web como possível fonte da UI nativa **somente quando existir um canal autorizado e comprovado**. A preferência do usuário por conectar ChatGPT/plugin não prova uma API de inferência para a Surface nem autoriza automação de chatgpt.com.

**Aplicativos como capacidades nativas:** a IA compreende apps pelo registro verificado e `ai/manifest.json`, resolve intenção/parameters de maneira limitada, consulta capabilities reais e solicita o binding apropriado. Leitura de tela/mouse é fallback para integrações sem contrato apropriado, sujeito às mesmas políticas; nunca é autoridade irrestrita.

## Dois fluxos diferentes — não confundir

**A. Chat OrdaX → modelo:** usuário digita no OrdaX Web/OS/Studio → UI/client tipado → `ordax.intelligence/1` e router → modelo local ou provider explicitamente disponível/autorizado → eventos/resultado na UI. Plugin MCP instalado no ChatGPT **não fornece automaticamente uma API para que o painel OrdaX envie mensagens ao chatgpt.com**. Bridge ChatGPT Web via browser, cookies, DOM ou infraestrutura não oficial continua experimental; não ativar em produção sem canal permitido e E2E.

**B. ChatGPT externo → ações OrdaX:** usuário no cliente ChatGPT compatível conecta e autoriza `ordax-chatgpt` → Platform Product MCP/OAuth/grants → destino Runtime/OS selecionado e autorizado → ação canônica → receipt/status. Pode funcionar sem Studio aberto; depende de plugin, credenciais OrdaX, device real, target e grants. Conta ChatGPT ≠ Conta OrdaX. O fluxo B é independente da inferência do fluxo A.

```text
OS Web / OS Native / Studio / apps (clientes)
     -> OrdaX Intelligence + Model Router (OS)
         -> modelo local / adapter remoto autorizado
         -> catálogo semântico / ação proposta (authority=none)
              -> Action Catalog + approval/grants + Action Gateway
              -> Runtime/adapter autorizado -> receipt + Activity

ChatGPT externo -> plugin MCP Platform -> grants + target -> Runtime/OS
        (fluxo B independente; catálogo/autoridade existentes, sem duplicação)
```

## Ownership (SSOT)

| Responsabilidade | Repositório |
| --- | --- |
| OrdaX Intelligence, model router, Memory/autorização de contexto, app semantics/action contracts, Surface Web/OS | `ordaxsystems/ordax-os` |
| Studio e demais UIs first-party e seus manifests | `ordaxsystems/ordax-apps` |
| Host/dispositivo Windows, política local, execução, bridge experimental de provider | `ordaxsystems/ordax-runtime` |
| `ordax-chatgpt`, MCP, OAuth, grants remotos, fila/audit e provider connectors | `ordaxsystems/ordax-platform` |
| Experiência visual Lovable (não backend) | `washingtonmsdj/account-hub-pro` |

“Plugin conectado à raiz do OrdaX” significa **serviço e autoridade disponíveis ao ecossistema**, não transferir a fonte do plugin para `ordax-os`. Não renomear ID, URLs, OAuth scopes ou migrations sem plano de compatibilidade e testes.

## Estado observado — 2026-10-13

- Intelligence consultativo mantém `authority=none` e `toolExecution=false`; modelo não recebe autoridade por prompt, Memory, manifest ou escolha de provedor.
- Local model router existe e a rota local é a única rota de inferência habilitada no OS; providers externos continuam fail-closed.
- Memory autorizada e consumidores Native reais existem; source/CI não equivalem a prova física Stable.
- A Web atual monta `Central`, não o WebShell antigo. Antes da #1756, Aura só apresentava indisponibilidade; #1756 introduz o client/adapter boundary canônico sem ligar provider remoto.
- Surface Web não deve armazenar credenciais, escolher endpoint de provider, possuir Memory policy ou importar adapter Native.
- Product MCP/plugin e provider connectors têm owners fora da Surface; source, testes, implantação, consentimento, plugin instalado, target online, execução real e publicação são gates distintos.

## Sequência de implementação segura

1. Revalidar `main`, PRs abertas e owners antes de cada fatia; não reutilizar branch antiga por conveniência.
2. Manter `ordax.intelligence/1` como API sistêmica estável; comportamento específico de Web fica em adapter/composition, não no contrato público.
3. Compor transporte real fora da UI: endpoint/host/auth/contexto/egress pertencem ao owner confiável; Surface recebe port/client já autorizado.
4. Manter providers atrás do router. Credenciais nunca entram em bundle Web, prompt, Memory ou logs.
5. Para apps first-party: manifesto verificado → roteamento semântico → binding real → proposta `authority=none` → approval/grant → executor → receipt/Activity.
6. Validar mudanças de owner/Space/projeto, logout, offline, revogação, resposta tardia, cancelamento, streaming e ACK incerto sem retarget ou replay silencioso.
7. Remover código legado somente quando a substituição está coberta; não manter dois caminhos ativos nem apagar evidência histórica tratada como documentação.
8. Separar explicitamente provas de source/CI, deploy, E2E credentialled e físico Stable/MVP.

## Lovable / UI

A interface do OrdaX Intelligence é um cliente global reutilizável, com conversa, status de modelo/provider quando factual, contexto autorizado, Activity e resultados. No `washingtonmsdj/account-hub-pro` isso é **prototipação visual** até os adapters públicos existirem. Não usar iframe automático de ChatGPT, login espelhado, ferramentas falsas que retornam sucesso, backend paralelo ou dados reais fabricados.

## Critérios de aceite

- Um só owner de Intelligence e um só model router; apps/OS/Web/Studio reutilizam contratos existentes.
- Surface não possui provider, credencial, Memory ou autoridade.
- Fluxos A e B testados independentemente, sem prometer assinatura Web do ChatGPT como backend sem canal autorizado.
- Actions só após autorização real, escopo explícito, resultado rastreável e revogação.
- Ausência de transporte/provider permanece indisponibilidade honesta, não mock de sucesso.
- Provas separadas para código, CI, release, deploy, conta/plugin/device conectados e E2E.
- Cleanup deixa um caminho corrente, sem duplicação ativa e sem remover owners ainda necessários.

Este arquivo é ponto de retomada; **não** é permissão para reimplementar o stack.
