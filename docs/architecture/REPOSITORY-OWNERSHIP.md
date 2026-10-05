# OrdaX — ownership canônico de repositórios

Status: **SSOT arquitetural**.

Este documento define os repositórios oficiais do ecossistema OrdaX e o que cada um pode ou não possuir. O objetivo é impedir sobreposição de responsabilidade, forks acidentais, dependências circulares e migrações improvisadas.

## Repositórios oficiais

### 1. `washingtonmsdj/prototipo-ordax-os`

**Papel:** plataforma/sistema operacional.

Owns:
- Base, boot, recovery e Surface/Shell;
- Identity/account boundary;
- Memory global;
- OrdaX Intelligence e contratos públicos;
- permissions/grants/policy da plataforma;
- Component Manager, trust, install/update/rollback;
- Store service e surfaces estruturais;
- App SDK e contratos públicos;
- services estruturais de Spaces/Projects.

Não owns:
- source portátil de apps first-party;
- Windows ORDAX Runtime;
- Product MCP/Cloudflare/provider connectors;
- implementações específicas do Blender/Unity dentro da plataforma.

### 2. `washingtonmsdj/ordax-apps`

**Papel:** source canônico dos apps first-party removíveis/atualizáveis independentemente.

Owns:
- `apps/studio` — ORDAX Studio portátil;
- Notes e futuros apps first-party externalizados;
- UI/core de produto;
- estado app-owned permitido;
- testes, assets, i18n e package metadata dos apps.

Não owns:
- Identity, Memory global, grants ou sync;
- Runtime/Device Host;
- Control Plane/Product MCP;
- provider credentials;
- Computer Control authority;
- package install/update authority da plataforma.

### 3. `washingtonmsdj/ordax-runtime`

**Papel:** Runtime/Device Host para ambientes que não fornecem nativamente os serviços do OrdaX OS, com foco inicial em Windows.

Owns:
- ORDAX Runtime para Windows;
- device host/agent;
- Computer Control;
- filesystem/process/input/screenshot/application launch;
- lifecycle do host local;
- política local e enforcement;
- pairing/device runtime;
- adapters de execução runtime-owned, incluindo Blender/Unity quando aplicável.

Não owns:
- UI/core portátil do ORDAX Studio;
- OAuth/Product Grants remotos;
- Control Plane;
- Identity/Memory/Intelligence da plataforma.

### 4. `washingtonmsdj/ordax-control-plane`

**Papel:** infraestrutura remota/provider-neutral.

Owns:
- Product MCP;
- Cloudflare/Control Plane;
- OAuth/autenticação remota;
- Product Grants;
- request queue/correlation/receipt/audit remoto;
- connector `ORDAX for ChatGPT`;
- futuros provider connectors equivalentes.

Não owns:
- ORDAX Studio portátil;
- Runtime local/Computer Control implementation;
- autoridade de Identity/Memory da plataforma;
- grants locais ou policy do host.

## Fluxos canônicos

### ChatGPT para dispositivo

```text
ChatGPT / provider client
        ↓
ordax-control-plane
        ↓
ordax-runtime
        ↓
device / project / adapter
```

### ORDAX Studio no Windows

```text
ordax-apps/apps/studio
        ↓ public Studio/runtime ports
ordax-runtime
        ↓
Windows / projects / tools
```

### ORDAX Studio no OrdaX OS

```text
ordax-apps/apps/studio
        ↓ public platform ports
prototipo-ordax-os
```

O OrdaX OS não empacota um segundo Windows Runtime.

## Regra de autoridade

Contexto pode aumentar inteligência, nunca autoridade.

- apps não mintam grants;
- provider connectors não ampliam policy local;
- Runtime não vira dono de Identity/Memory;
- Control Plane não controla policy local por bypass;
- sistema não importa source privado de app para funcionar;
- nenhum repositório deve duplicar outra camada apenas por conveniência.

## Regra de dependência

Dependências permitidas devem ser por contratos públicos/versionados, não por imports privados entre repositórios.

Direção esperada:

- `ordax-apps` → contratos públicos do OrdaX OS;
- `ordax-runtime` → contratos públicos compatíveis;
- `ordax-control-plane` → protocolo/contratos públicos;
- `prototipo-ordax-os` não depende do source dos outros três para bootar.

## Migração do legado mcp-blender

`washingtonmsdj/mcp-blender` é legado em retirada.

Destino das responsabilidades:

- Studio portátil → `ordax-apps`;
- Runtime/Device Host/Computer Control → `ordax-runtime`;
- Product MCP/Cloudflare/provider connector → `ordax-control-plane`.

O legado só pode ser apagado depois de:
1. source portátil do Studio estar canônico em `ordax-apps`;
2. Runtime ser construído/publicado a partir de `ordax-runtime`;
3. Control Plane/connector serem construídos/publicados a partir de `ordax-control-plane`;
4. builds, deploys e installers não referenciarem o legado;
5. smoke E2E provar provider -> Control Plane -> Runtime -> capability -> receipt;
6. busca de dependência funcional residual retornar zero.

## Política de novos repositórios

Não criar um novo repositório apenas para organizar pastas. Um novo repo só faz sentido quando houver:
- ownership independente;
- lifecycle/release independente;
- failure domain separado;
- CI e rollback próprios;
- boundary contratual claro.

Para o estágio atual, **quatro repositórios são a arquitetura oficial**. Blender, Unity e conectores adicionais permanecem dentro de seus owners atuais até existir razão concreta para separação adicional.
