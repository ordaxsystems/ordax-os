# Arquitetura oficial de repositórios OrdaX

Status: **SSOT CANÔNICO**

Status de migração: `cutover-complete-legacy-retired` conforme `docs/contracts/repository-migration-status.json`. Repositórios e responsabilidades atuais são definidos por `docs/contracts/repository-ownership.json`; nomes anteriores identificam apenas histórico, não rotas operacionais.

Este documento define a divisão oficial de responsabilidade entre os repositórios first-party do ecossistema OrdaX. Ele existe para evitar ownership duplicado, migrações oportunistas e dependências acidentais entre app, sistema, runtime e infraestrutura remota.

## Regra central

Cada responsabilidade canônica pertence a **um único repositório**.

Nenhum repositório pode absorver uma responsabilidade de outro apenas para simplificar uma migração. Mudanças entre owners exigem contrato público, plano de migração, prova de compatibilidade e remoção do owner antigo.

## Repositórios canônicos por responsabilidade

### 1. ordaxsystems/ordax-os

**Papel:** plataforma/sistema operacional OrdaX.

É owner de:
- Base, boot, host Native da Surface, composição e ciclo transacional de release/rollback;
- Identity;
- Memory global/plataforma;
- Intelligence/router/provider abstractions;
- permissions/grants de plataforma;
- trust, signing roots e package lifecycle authority;
- Store estrutural;
- Settings, Account e System estruturais;
- App SDK e contratos públicos;
- component install/verify/stage/health/promote/rollback;
- serviços nativos do OrdaX OS.

Não é owner de:
- source portátil do ORDAX Studio;
- Runtime Windows;
- Product MCP/Cloudflare remoto;
- connectors específicos de ChatGPT/Grok;
- adapters especializados como Blender como produto separado.

### 5. ordaxsystems/ordax-surface

**Papel:** apresentação visual compartilhada, componentes e área de trabalho da Surface, com histórico e fonte canônicos independentes.

É owner de `system/surface/ui/` e `system/surface/workspace/` (caminhos de montagem do artefato), design tokens, identidade visual e comportamento de interação. Não é owner de serviços nativos, Supervisor, boot, permissões, grants, assinatura, runtime de host ou atualizações do dispositivo. O OS consome um único commit pinado em `docs/contracts/surface-source.json`, preservando os ports e contratos públicos existentes.

### 2. ordaxsystems/ordax-apps

**Papel:** source first-party dos aplicativos removíveis/atualizáveis.

É owner de:
- ORDAX Studio portátil em `apps/studio`;
- Notes e outros apps first-party externos;
- UI/core provider-neutral de apps;
- estado app-owned permitido;
- assets, i18n e testes dos apps.

Não é owner de:
- Identity, Memory global, permissions/grants;
- Windows device host;
- Computer Control local;
- OAuth/Product Grants;
- Cloudflare/Control Plane;
- provider connectors como runtime;
- unrestricted shell/device authority.

### 3. ordaxsystems/ordax-runtime

**Papel:** Runtime/host local para ambientes que não fornecem os serviços nativos do OrdaX OS, inicialmente Windows.

É owner de:
- ORDAX Runtime para Windows;
- device host/agent;
- Computer Control;
- filesystem/process/input/screenshot/app launch;
- Windows process/service lifecycle;
- política local e enforcement;
- pairing/device runtime;
- execução tipada de adapters runtime-owned;
- host adapter Windows para contratos públicos consumidos pelo Studio.

Não é owner de:
- UI/core portátil do Studio;
- Product MCP remoto;
- OAuth/Cloudflare/Product Grants;
- serviços estruturais do OrdaX OS.

### 4. ordaxsystems/ordax-platform

**Papel:** infraestrutura remota/provider-neutral e conectores externos.

É owner de:
- Product MCP;
- Cloudflare/Control Plane;
- OAuth remoto;
- Product Grants;
- queue/request/receipt/audit remoto;
- connector ORDAX for ChatGPT;
- futuros connectors equivalentes;
- autorização remota server-authoritative.

Não é owner de:
- Studio portátil;
- Runtime local/Computer Control;
- serviços nativos do OrdaX OS.

## Fluxos oficiais

### ChatGPT controlando um computador Windows

```text
ChatGPT
  -> ORDAX for ChatGPT / Product MCP
  -> ordaxsystems/ordax-platform
  -> ordaxsystems/ordax-runtime
  -> capability tipada no dispositivo
  -> receipt/audit
```

### ORDAX Studio no Windows

```text
ordaxsystems/ordax-apps/apps/studio
  -> host adapter Windows
  -> ordaxsystems/ordax-runtime
  -> capabilities locais/remotas autorizadas
```

### ORDAX Studio no OrdaX OS

```text
ordaxsystems/ordax-apps/apps/studio
  -> public App SDK/runtime ports
  -> ordaxsystems/ordax-os
```

O OrdaX OS não deve empacotar um segundo ORDAX Runtime apenas para executar o Studio.

## MCP como capacidade transversal do sistema

O OrdaX OS é owner dos **serviços nativos de permissões e capabilities**
consumidos por todos os apps, não apenas Studio. A Platform é owner do
Product MCP remoto e dos grants OAuth/PostgreSQL. No Windows, o Runtime
implementa a política e as capacidades locais; o Studio pode apresentar a
interface Owner para autorizações Windows, mas não se torna serviço de
permissões universal.

No OrdaX OS, Settings/Permissions e o host de sistema administram acesso
tipado por app verificado/cliente + conta + Space/projeto + dispositivo +
capability. Apps (Pedidos, Files, Notas, Studio e outros) consomem ports
públicos, sem raw Device Agent, grant minting, distribuição ou exec próprios.
A remoção ou falha de Studio não pode desativar o MCP de sistema.
Os contratos e gates de ativação estão em
[`docs/MCP-SYSTEM-CAPABILITIES.md`](MCP-SYSTEM-CAPABILITIES.md).

## Adapters especializados

Blender, Unity e integrações futuras são adapters/capabilities. Eles não justificam um novo owner de autorização nem um segundo Device Agent.

Regra atual:
- execução local/runtime-owned -> `ordaxsystems/ordax-runtime`;
- UI/apresentação de capability -> `ordaxsystems/ordax-apps/apps/studio`;
- autorização remota -> `ordaxsystems/ordax-platform`;
- contrato público -> `ordaxsystems/ordax-os`.

## Regra para o legado mcp-blender

`washingtonmsdj/mcp-blender` é repositório legado de incubação.

Ele não é owner canônico de nenhuma nova feature.

A exclusão só é permitida depois que:
1. Studio portátil estiver canônico em `ordax-apps`;
2. Runtime/Device Host estiver canônico e buildável em `ordaxsystems/ordax-runtime`;
3. Product MCP/Control Plane/connectors estiverem canônicos e deployáveis em `ordaxsystems/ordax-platform`;
4. produção e Windows packaging estiverem repointados;
5. smoke E2E provar ChatGPT -> Control Plane -> Runtime -> capability -> receipt;
6. busca de build/deploy/launch provar ausência de dependência funcional do legado.

## Princípios

- sem gambiarras ou project ids sintéticos;
- sem duplicar authority;
- sem shell genérico como atalho de produto;
- contexto não concede autoridade;
- provider identity é contexto, não permissão;
- mutações devem ser tipadas, auditáveis e receber receipts;
- contratos entre repositórios devem ser públicos/versionados;
- cada release deve poder evoluir sem exigir rebuild indevido dos outros repos;
- migration residue nunca pode virar segunda fonte de verdade.


## Estado operacional da migração

Atualizado em 2026-10-08 após validação da migração concluída e dos quatro owners no GitHub.

| Camada | Repositório canônico | Estado |
| --- | --- | --- |
| OrdaX OS / plataforma | `ordaxsystems/ordax-os` | canônico |
| Apps first-party / ORDAX Studio | `ordaxsystems/ordax-apps` | canônico; Studio portátil em `apps/studio` |
| Runtime / Device Host Windows | `ordaxsystems/ordax-runtime` | canônico; namespace transferido e histórico preservado |
| Product MCP / Control Plane / connectors | `ordaxsystems/ordax-platform` | canônico; transferido e renomeado, histórico preservado |
| Incubação antiga | `washingtonmsdj/mcp-blender` | legado aposentado; conteúdo funcional removido conforme contrato de migração; exclusão do repositório é decisão independente |

### Rastreamento cruzado

- `ordaxsystems/ordax-apps#31` — retirar dependência operacional de `mcp-blender`;
- `ordaxsystems/ordax-runtime#1` — migrar Runtime/Device Host;
- `ordaxsystems/ordax-platform#2` — migrar Product MCP/Control Plane e connector;
- `ordaxsystems/ordax-apps#22` — roadmap operacional do Studio;
- `ordaxsystems/ordax-apps#23` a `#27` — projetos, continuidade, preview, transactions/undo e Blender tipado.

### Regra de atualização

Mudanças relevantes de ownership ou cutover devem atualizar este documento e `docs/contracts/repository-ownership.json` no mesmo PR. Issues são rastreamento; este documento + contrato são o SSOT.
