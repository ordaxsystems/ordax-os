# OrdaX Intelligence — HANDOFF TRANSVERSAL

> **Decisão 2026-10-10 — guia de retomada, não nova autoridade de código.** Este arquivo na raiz foi criado para que outros chats/agents entendam o trabalho e prossigam sem reiniciar, duplicar sistemas ou interpretar testes simulados como release. Revalidar a `main` e as PRs antes de implementar. Em divergência prevalecem código + contratos públicos, `docs/CURRENT-STATE.md`, `docs/README.md`, `MVP.md` e os documentos canônicos de domínio.

## Tarefa de implementação ativa — próximo chat

**[Issue #1572 — Resultados adaptativos e progresso real de missões](https://github.com/ordaxsystems/ordax-os/issues/1572)** é o roteiro executável desta experiência Jarvis. **Comece pela P0**: auditar os contratos `ordax.intelligence-conversation-capabilities/1`, `ordax.personal-activity/1` e `ordax.personal-work-result/1` existentes, depois entregar uma **PR pequena de código + testes** com projeção segura read-only do resultado e dos eventos reais para a UI. Só então compor Canvas minimalista, receitas/docs/gráficos/galeria e progresso real com estados verificados. Não criar PR documental vazia, novo broker, store ou pipeline para contornar owners existentes. Acompanhar #848 (Work) e #1154 (coordenação entre clientes) sem duplicar suas responsabilidades.

**Estado da experiência pretendida:** repouso = apenas símbolo + campo de comando/voz/anexo quando habilitados; solicitações simples exibem resultados visuais adaptativos; missões usam progressos de Work/Activity/receipts reais. A estrutura da tela não é a imagem de receita ou um Studio simplificado. As imagens e protótipos Lovable são referências de UI, não provas de operação de IA. Sem evento verificável, não afirmar que uma etapa foi realizada.

## Leitura obrigatória

1. `AGENTS.md`, `docs/README.md`, `docs/contracts/repository-ownership.json` e `docs/CURRENT-STATE.md` — autoridade e estado atual.
2. `docs/INTELLIGENCE.md`, `docs/contracts/intelligence.json`, `system/services/intelligence/` — Intelligence, model router e limites de inferência.
3. `docs/APPLICATION-INTELLIGENCE.md`, `docs/APP-INTELLIGENCE-MANIFEST.md`, `docs/APPLICATION-ACTIONS.md` — catálogo semântico, intents, provedores de ações.
4. `PERSONAL-ORDAX.md` e `docs/PERSONAL-ORDAX.md` — Work, Activity, Result, approvals, grants e receipts.
5. [Apps: Studio + ChatGPT em três superfícies](https://github.com/ordaxsystems/ordax-apps/blob/main/docs/STUDIO-CHATGPT-THREE-SURFACES.md), [Studio Web](https://github.com/ordaxsystems/ordax-apps/blob/main/docs/STUDIO-WEB-INTEGRATION.md).
6. [Platform: providers](https://github.com/ordaxsystems/ordax-platform/blob/main/docs/ORDAX_PROVIDER_CONNECTORS.md), [Product MCP](https://github.com/ordaxsystems/ordax-platform/blob/main/docs/PRODUCT_MCP_CONNECT.md), [Runtime: bridge experimental](https://github.com/ordaxsystems/ordax-runtime/pull/63).

## Decisão do produto

**OrdaX Intelligence pertence ao sistema, não ao Studio.** O OS/Web, Studio e os demais aplicativos são CLIENTES da mesma camada `ordax.intelligence/1`. O painel do OrdaX Web deve oferecer conversa contextual, seleção/estado de provedor e ações autorizadas sem uma segunda implementação de IA. Identidade visual e componentes reaproveitados, shells adaptados a cada ambiente.

**Modelo híbrido e neutro a provedores:** IA local (baseline offline); APIs remotas autorizadas com egress consentido; ChatGPT externo com plugin MCP; ChatGPT Web como possível fonte da UI nativa **somente quando existir um canal autorizado e comprovado**. A preferência do usuário é conectar opcionalmente ChatGPT e o plugin, sem API key própria para o uso do cliente externo onde suportado. Essa preferência não prova suporte a automação do ChatGPT Web nem torna assinatura ChatGPT API de inferência.

**Aplicativos como capacidades nativas:** a IA deve compreender apps pelo registro verificado e `ai/manifest.json`, resolver intenção/parameters de maneira limitada, consultar capabilities reais e solicitar o binding apropriado. Não deve usar leitura de tela/mouse como primeiro caminho para first-party apps. Automação visual é fallback sujeito às mesmas políticas, para integrações sem API apropriada; nunca acesso irrestrito.

## Dois fluxos diferentes — não confundir

**A. Chat OrdaX → modelo:** usuário digita no OrdaX Web/OS/Studio → UI/port tipado → `ordax.intelligence/1` e router → modelo local ou provider explicitamente disponível/autorizado → eventos/resultado na UI. Plugin MCP instalado no ChatGPT **não fornece automaticamente uma API para que o painel OrdaX envie mensagens ao chatgpt.com**. Bridge ChatGPT Web via browser, cookies, DOM ou infraestrutura não oficial continua experimental; não ativar em produção sem prova de canal permitido e E2E.

**B. ChatGPT externo → ações OrdaX:** usuário no cliente ChatGPT compatível conecta e autoriza o plugin `ordax-chatgpt` → Platform Product MCP/OAuth/grants → destino Runtime/OS selecionado e autorizado → ação canônica → receipt/status. Pode funcionar sem Studio aberto; depende de disponibilidade de plugin, credenciais OrdaX, device real, target e grants. Conta ChatGPT ≠ Conta OrdaX. A seleção da ferramenta pelo ChatGPT e o consentimento do usuário não são garantidos como automáticos; plugin é independente da inferência A.

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
| OrdaX Intelligence, model router, memória/autorização de contexto, app semantics/action contracts, Surface Web/OS | `ordaxsystems/ordax-os` |
| Studio e demais UIs first-party e seus manifests | `ordaxsystems/ordax-apps` |
| Host/dispositivo Windows, política local, execução, bridge experimental de provider | `ordaxsystems/ordax-runtime` |
| `ordax-chatgpt`, MCP, OAuth, grants remotos, fila/audit e provider connectors | `ordaxsystems/ordax-platform` |
| Experiência visual Lovable (não backend) | `washingtonmsdj/account-hub-pro` |

“Plugin conectado à raiz do OrdaX” significa **serviço e autoridade disponíveis ao ecossistema**, não transferir a fonte do plugin para `ordax-os`. A fonte atualmente usa display name `ORDAX Studio` e ID estável `ordax-chatgpt`; eventual nome `OrdaX Connector` é proposta de branding sujeita a compatibilidade/versionamento. Não renomear o ID, URLs, OAuth scopes ou migrations sem plano e testes.

## Estado observado — 2026-10-10

- Intelligence consultativo com `authority=none` e `toolExecution=false`; modelo não recebe autoridade por prompt, memória, manifest ou escolha de provedor. Local model router existe em source; rota externa ainda fail-closed.
- Awareness semântico e roteamento limitado de apps existem em source. Manifesto descritivo não significa ação instalável/ativada.
- [Apps PR #192](https://github.com/ordaxsystems/ordax-apps/pull/192): **draft aberto**, chat nativo experimental; não comprovou uso real ChatGPT.
- [Runtime PR #63](https://github.com/ordaxsystems/ordax-runtime/pull/63): **draft aberto**, bridge loopback DEV com testes fake; sem login real/ativação.
- [Apps PR #197](https://github.com/ordaxsystems/ordax-apps/pull/197): aberta para escopo Studio Web + PC autorizado; documentação/source não equivalem a Web E2E publicada.
- Plugin Product MCP possui fonte no Platform; source, testes, implantação, consentimento, plugin instalado, target online, execução real e publicação são gates **distintos**. Revalidar versões/estados ao retomar.

## Sequência para próxima IA (agir, não apenas relatar)

1. Auditar `main` e patches/heads das PRs nos quatro owners. Conciliar alterações de outros chats. **Não mesclar experimental #192/#63 e não fechar #197 por conveniência**; cada uma requer avaliação de diff, testes e compatibilidade com estado atual.
2. Consolidar um **contrato de UX de conversa no owner OS** com envio, stream, cancelamento, histórico, provedor/disponibilidade e contexto explícito (owner/Space/projeto/dispositivo); reusar portas tipadas do Studio, sem reimplementar conversas ou identidade em cada cliente.
3. Centralizar **registro/estado de providers e conectores** atrás do router/contratos atuais; manter credenciais e sessões no host/owner confiável, nunca no código do Lovable/JS público; não extrair cookies/DOM de ChatGPT.
4. Compor capacidades first-party existentes: manifesto verificado → roteador semântico → capability com binding real → proposta `authority=none` → approval/grants exatos → executor autorizado → receipt/Activity. Não criar API `execute(anything)`, shell genérico, paths livres ou bypass de políticas.
5. Compor transport Web/phone → Platform → PC Runtime escolhido e autorizado, sem `localhost` remoto como prova, sem retarget e sem POST duplicado após ACK incerto. Ausência de PC/consentimento deve aparecer como indisponibilidade honesta.
6. Integrar interface Web/OS de Intelligence e Studio **como clientes**, não criar segundo plugin, segunda memória, histórico ChatGPT fictício ou app Studio duplicado. Manter browser ChatGPT como fallback humano independente.
7. Validar E2E consentido por fluxo: conta real autorizada, plugin instalado, OAuth/grants, Runtime PC, operações de leitura/ação, offline, revogação, troca de owner/Space/projeto, streaming/cancelamento, egress/contexto, histórico/receipts, falha segura. Registrar evidência sem tokens/segredos. Atualizar docs e PRs com estados precisos.

## Lovable / UI

A interface do OrdaX Intelligence será painel global reutilizável (lateral/flutuante/expandido), com conversa, status de modelo e conexão ChatGPT opcional, contexto de Space/projeto, permissões, Activity e resultados. No `washingtonmsdj/account-hub-pro` isso é **prototipação visual** até os adapters públicos existirem. Não iframe automático de ChatGPT, login espelhado, ferramentas falsas que retornam sucesso, backend independente ou registros de dados reais fabricados.

## Critérios de aceite

- Um só owner de Intelligence e um só catálogo de ações; apps/OS/Web/Studio reutilizam.
- Fluxos A e B testados independentemente, sem promessa de uso da assinatura Web do ChatGPT como backend sem canal autorizado.
- Actions só após autorização real, escopo explícito, resultado rastreável e revogação.
- Provas separadas para código, CI, release, deploy, conta/plugin/device conectados e E2E.
- Backlog, PRs e documentos atuais alinhados com source e owners. Este arquivo é o ponto de partida do próximo chat, **não** uma permissão para reimplementar tudo.
