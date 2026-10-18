# MCP e capacidades compartilhadas do OrdaX OS

Status: **fronteira de arquitetura + preflight compartilhado implementado; despacho geral de apps NÃO ativado**.

## Decisão de ownership

O MCP **não é um aplicativo** e o OrdaX OS não depende do Studio para funcionar.
É uma interface/protocolo para clientes autorizados consumirem capacidades do
sistema e, quando permitido, de apps instalados. O servidor remoto MCP pertence
à Platform e o broker local/permits ao OrdaX OS. No Windows, o Runtime fornece
o host equivalente; Studio apresenta telas administrativas Owner no Windows,
sem se tornar a autoridade.

```text
ChatGPT / Grok / cliente MCP externo     Jarvis / Intelligence local
                 |                              |
                 v                              v
             Product MCP                 System tool contract
          (Platform + OAuth)                     |
                 |                               |
                 +-------> OrdaX capability boundary <-------+
                                   |                          |
                        system identity / policies        apps autorizados
                        Space / project / device          Pedidos, Notas,
                        local + remote grants             Files, impressão 3D...
                                   |
                             canonical Action Gateway
                                   |
                           adapter instalado/verificado
                                   |
                             receipt + audit
```

Cada consumidor tem identidade independente: **conta/actor + cliente OAuth
externo ou appId instalado + deviceId + Space + projeto/escopo + capability
+ modo de acesso**. A identidade da IA, o nome do app, o manifesto de intents
ou a presença na Loja não conferem permissão.

## Responsabilidades

- **OrdaX OS**: políticas e execução local nativa, registro/identidade dos apps
  verificados, contexto de Space, painel de permissões do sistema e composição dos
  ports. Studio, Pedidos, Files ou qualquer outro app são consumidores.
- **Platform/Product MCP**: OAuth, grants remotos vigentes, cliente, conta,
  device, Space/projeto e auditoria/receipts remotos. Um token OAuth nunca substitui
  a permissão local do dispositivo.
- **Runtime Windows**: implementa Device Agent, enforcement/execução no Windows;
  o Studio Windows pode apresentar UI Owner, mas não armazena nem cunha grants.
- **Apps**: descobrem somente capacidades autorizadas, enviam ações tipadas ao
  host e recebem receipts; não recebem tokens, grants assináveis, raw execute ou
  acesso universal à máquina. Remover Studio não pode revogar capacidades dos
  outros apps nem interromper o MCP de sistema.

## Estado efetivamente implementado

- `system/contracts/device-agent.mjs` e
  `system/contracts/device-action-envelope-v2.mjs` são contratos canônicos de
  capabilities, conta, Space, projeto, dispositivo, cliente e request/receipt.
- `system/services/device-agent/action-preflight.mjs` compartilha com apps e
  consumidores MCP a validação de um grant apresentado e de capabilities atuais,
  **sem** executar, conceder ou provar a proveniência do grant
  (`dispatchAuthority: "none"`). A adaptação legada do Studio delega a ele.
- `system/services/device-agent/installed-app-capability-reader.mjs` projeta
  **somente descoberta** para um app de cada vez, usando duas dependências
  estritamente OS-private: o resolvedor da identidade real do pacote/processo
  e o leitor de permissões locais vigentes. A cada leitura, compara identidade
  (appId + publisher do pacote verificado + SHA-256 do pacote + conta + Space + dispositivo), cruza modos
  permitidos com as capabilities efetivamente disponíveis e não reutiliza
  cache após revogação ou troca de Space. Não expõe métodos de concessão,
  execução, seleção de outro app ou alteração de escopo. **O host ainda deve
  implementar e conectar os dois resolvedores confiáveis**: não aceitar
  conteúdo de renderer, manifesto ou modelo como atestação.
- `system/composition/native/installed-app-capability-context.mjs`
  implementa o **provider opcional de contexto Native** que injeta o leitor
  anterior na composição de componentes de slot verificado. A identidade do
  aplicativo vem de `resolveCurrentInstalledApp` privado do host, que deve
  provar publisher, pacote atual, appId e escopos. Ausência de comprovação
  não injeta o port, e atualização, troca de Space ou revogação são
  rechecadas a cada consulta. O provider não é registrado automaticamente
  na Surface enquanto o bootstrap Native não fornecer resolvers
  autenticados e conectados ao Settings/Permissions. Seu contrato é testado
  com contextos independentes de dois aplicativos.
- A consulta revalida a identidade depois das leituras assíncronas para
  recusar uma resposta autorizada por um Space/pacote que mudou durante
  a operação. Sessões de convidado usam `accountId: null` e `spaceId: null`
  **somente quando o host tiver resolvido esse escopo de fato**; isso não
  infere permissões de conta inexistente.
- Manifestos de App Intelligence são declarativos (`authority=none`).
  A ligação de um intent a um adapter tipado exige autorização posterior.

**Não entregue ainda:** um broker nativo geral que autentique o appId do
processo chamador, obtenha a decisão local do Settings/Permissions e a concessão
remota do PostgreSQL, revalide imediatamente antes do dispatch e produza receipt.
Não confundir a existência do preflight ou do catálogo MCP externo com suporte
executável de todo app; a composição nativa em produção permanece fail-closed.

## Gates obrigatórios antes de ativar ações de apps

1. Identificar app chamador **pelo processo/pacote verificado**, nunca por
   `appId` vindo da requisição ou do modelo. Associar Conta e Space atuais.
2. Construir um port de consumo público único que não exponha
   `grant()`, `authorize()` ou `execute()`. Um app recebe um port limitado
   às capabilities pertinentes, não o Device Agent privado.
3. Para cada chamada, confrontar identidade do chamador, capability,
   modo read/write, escopo exato (Space/projeto/recurso), permissões locais e,
   quando remota, grant vigente de OAuth/Platform. Sem conectividade ou estado
   confiável, negar mutação; leitura offline é uma política separada e explícita.
4. Adaptadores de Pedidos, Notes, Files, Studio e terceiros passam pelo **mesmo**
   serviço. Uninstall/update do app não apaga permissões de outros apps;
   versão e identidade do pacote devem ser revalidadas.
5. Provar E2E: ações entre dois apps e dois Spaces não podem cruzar dados;
   remoção/revogação impede novas ações; receipt é ligado a caller, device,
   Space, project, capability e request_id; evitar retry cego após timeout.
6. A execução remota com terminal nativo permanece uma capability
   especialmente sensível: nunca deriva de `full_access` local e nunca torna
   a automação do teclado uma forma alternativa de shell.

Esta fronteira NÃO cria um segundo MCP, Runtime, serviço de autorizações ou
Store, nem ativa um shell geral no OS.
