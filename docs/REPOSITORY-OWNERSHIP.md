# Arquitetura oficial de repositórios OrdaX

Status: **SSOT CANÔNICO**

Status de migração: `cutover-complete-legacy-retired` conforme `docs/contracts/repository-migration-status.json`. Repositórios e responsabilidades atuais são definidos por `docs/contracts/repository-ownership.json`; nomes anteriores identificam apenas histórico, não rotas operacionais.

Este documento define a divisão oficial de responsabilidade entre os repositórios first-party do ecossistema OrdaX. Ele existe para evitar ownership duplicado, migrações oportunistas e dependências acidentais entre app, sistema, runtime e infraestrutura remota.

> **Nota sobre nomes do contrato:** em `docs/contracts/repository-ownership.json`, a chave interna `repositories.platform` representa a camada de plataforma/sistema do **`ordaxsystems/ordax-os`**; a chave `repositories.control_plane` representa o repositório **`ordaxsystems/ordax-platform`**. Esses IDs são nomes de papéis do schema, não nomes de repositório. Não inferir ownership pelo rótulo da chave; usar sempre o campo `repo`.

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
- OrdaX MCP para Windows como **distribuição independente**, sem depender do Studio ou do Electron;
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

### 5. Surface ? m?dulo integrado ao ordaxsystems/ordax-os

A interface visual compartilhada e o workspace pertencem ao pr?prio OS.
Sua ?nica fonte edit?vel est? em system/surface/ui/ e system/surface/workspace/
na MESMA revis?o Git do OS; o host e os servi?os mant?m limites modulares pr?prios.
N?o existe checkout externo, lock transitivo ou outro dono do c?digo visual.
O contrato docs/contracts/surface-source.json v2 representa a pol?tica da
fonte ?nica, e o Supervisor mant?m a ativa??o e rollback da release.

### 6. Desktop Windows — módulo `ordax-os/desktop/`

**Papel:** host, shell Electron, ciclo de janela e empacotamento/entrega Windows do OrdaX Desktop.

É owner de:
- shell Electron e integração de host Windows;
- empacotamento NSIS e proveniência do candidato Desktop;
- ciclo de vida da janela/processo host e atualização da própria shell;
- consumo de uma composição OrdaX/OS exata e verificável.

Não é owner de:
- source visual da Surface, que pertence ao mesmo OS em `system/surface/` e é consumido pelo host sem segundo pin;
- serviços Native, contratos sistêmicos, kernel/boot ou lifecycle de componentes, que permanecem no OS;
- Runtime/Computer Control local, que pertence a `ordax-runtime`;
- Creator Core/política de mídia;
- Product MCP/grants remotos.

Desktop consome a composição da **mesma revisão Git do OS**; não mantém pins independentes de Surface, Apps ou Intelligence quando esses componentes já são transitivos ao candidato OrdaX.
### 7. Site público — módulo site/ no ordax-os

**Papel:** apresentação pública, páginas legais, login/recuperação e Conta visual, com raiz estática em site/public/.

O único código do Site, seus estilos, assets, internacionalização, renderizador, contratos e testes estão em ordaxsystems/ordax-os/site/. O Site usa o mesmo commit Git do OS, sem pin de outro repositório, clone externo, submódulo ou segundo owner.

Os entrypoints Vercel de Conta e OAuth apenas expõem as APIs existentes em `api/` e `lib/` do OS. Identity, sessão, autorização, billing, assinatura de releases e grants permanecem sob seus owners. Não existe bridge, materializador de gateway ou API alternativa. **A produção `ordax.com.br` pertence ao projeto Vercel `ordax-os-public`, já conectado a `ordax-os/main`**; a origem foi comprovada por manifesto público e SHA do deployment. O projeto Vercel `ordax-site` é staging protegido e distinto, com vínculo Git histórico ainda pendente de reconexão ou descontinuação.

A origem Git `ordaxsystems/ordax-site` já está arquivada e contém somente `README.md` na ponta de suas branches; os commits históricos foram preservados. Nenhum código ativo deverá retornar a esse repositório.

### 8. Creator no monorepo ordax-os/creator/

**Owner ativo:** ordaxsystems/ordax-os/main, módulo creator/.

O aplicativo Win32, Go Core, consumidores assinados e adaptadores físicos pertencem ao mesmo commit do OS. Os produtores de mídia e provas continuam exclusivamente em tools/creator/; assinatura, autorização de escrita física e trust permanecem nos contratos e publicadores do OS, com os gates já existentes. Não manter Core Go, criador ou atualizador paralelo em desktop/, tools/creator/ ou repositório Git externo.

O repositório histórico ordaxsystems/ordax-creator foi arquivado após a migração verificada do executável Windows, do sincronizador local e da publicação. Sua `main` contém apenas README de encaminhamento, preservando o histórico Git; o código e os releases ativos pertencem a `ordax-os/creator/`. A consolidação de fonte não autoriza escrita física nem release Stable/MVP.

### 9. OrdaX Intelligence — módulo canônico no OS

O Intelligence pertence integralmente ao mesmo commit de ordaxsystems/ordax-os:
system/intelligence/ contém o núcleo portátil de inferência, roteamento,
streaming, ferramentas, validação e testes. Os serviços Native já existentes
injetam contratos do OS sem implementar um segundo motor.

docs/contracts/intelligence-source.json declara source_revision=same-os-commit.
tools/intelligence/verify.py compara blobs Git e composições Native com o
recibo de proveniência. O Supervisor conserva a transação e o rollback.

ordax-intelligence é um repositório histórico, não uma autoridade operacional.
Runtime e Platform permanecem independentes. Cutover de código não concede
ativação, instalação, publicação Stable, mudança de grants ou engines.

## Fluxos oficiais

### Site público canônico no OS

ordaxsystems/ordax-os/main:site/
  -> site/public/ (páginas, estilo, assets e i18n)
  -> site/scripts/build.py (builder e validador)
  -> api/ e lib/ do próprio OS (Identity compartilhada sem cópia)
  -> bundle verificado para o projeto Vercel existente e bootstrap Web
  -> sem outro commit Git, clone ou segundo pipeline

### Surface visual compartilhada Web / Native

```text
ordaxsystems/ordax-surface (revisão fixa em docs/contracts/surface-source.json)
  -> composição com serviços e adapters de ordaxsystems/ordax-os
  -> build/release verificada com uma única interface
  -> host Web/Native do OS e rollback da própria release
```

O repositório da Surface não instala serviços nativos nem atualiza dispositivos; a verificação, staging e ativação pertencem aos owners do OS.

### Creator integrado com artefatos OS verificados

```text
ordaxsystems/ordax-os
  -> Base / boot / componentes físicos / contratos / assinatura (owner produtor)
  -> artefatos com proveniência verificável
  -> creator/ (Core + UI + adaptadores Windows no mesmo commit)
  -> verificação independente de integridade + gates de autorização física
```

O Creator **não** aciona rebuild da Base por mudar sua interface. A autorização
para gravar mídia depende de assinatura, gates físicos e confirmação explícita,
não da existência de um instalador do Creator ou de testes isolados.

### Desktop Windows como consumidor da composição

```text
ordax-os/system/surface / ordax-apps / outros producers
  -> ordaxsystems/ordax-os (composição e dependência direta)
  -> candidato OrdaX/OS verificável
  -> ordaxsystems/ordax-os/desktop (host Electron + NSIS do mesmo commit)
  -> instalação Windows + recibo/proveniência
```

O Desktop não reabre a árvore de dependências transitivas nem copia a Surface. Mudanças no host/packaging ficam em `desktop/` do `ordax-os`; adoção de nova composição ocorre quando um candidato Windows realmente precisa dela.
### ChatGPT controlando um computador Windows

```text
ChatGPT
  -> ORDAX for ChatGPT / Product MCP
  -> ordaxsystems/ordax-platform
  -> ordaxsystems/ordax-runtime
  -> capability tipada no dispositivo
  -> receipt/audit
```

### OrdaX MCP independente para Windows

```text
ordaxsystems/ordax-runtime
  -> instalador e processo OrdaX MCP / ORDAX Runtime (mesmo executor)
  -> capabilities locais sujeitas a política e consentimento
  -> ordaxsystems/ordax-platform (Conta, OAuth, grants, sessões e MCP remoto)
  -> ChatGPT e outros clientes autorizados
```

A distribuição Windows do **OrdaX MCP** pertence exclusivamente a
`ordax-runtime`, e não ao Studio. O candidato independente foi validado
na [PR #278 do Runtime](https://github.com/ordaxsystems/ordax-runtime/pull/278)
com build, instalação e desinstalação em runner Windows; não é release
público assinado nem comprovação de onboarding gráfico completo.
`ordax-platform` permanece a autoridade remota. Não existe segundo MCP,
executor, base de identidade ou atualização sob a responsabilidade de apps.

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
implementa a política e as capacidades locais; a instalação e a vinculação
Owner pertencem ao produto independente **OrdaX MCP**, e não ao Studio.
O Studio consome capabilities autorizadas como qualquer outro aplicativo,
sem assumir onboarding obrigatório, grant minting ou autoridade de permissões.
A interface gráfica própria do OrdaX MCP ainda exige gates de produto.

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


## Estado operacional dos owners

Atualizado em **2026-11-13**. Esta tabela resume roles; a autoridade executável continua em `docs/contracts/repository-ownership.json` e nos locks específicos de componentes.

| Camada | Repositório canônico | Estado |
| --- | --- | --- |
| OrdaX OS / composição Native | `ordaxsystems/ordax-os` | canônico |
| Desktop Windows host/packaging | `ordaxsystems/ordax-os/desktop/` | canônico; mesma revisão Git da composição OS |
| Surface visual compartilhada | `ordaxsystems/ordax-os/system/surface/` | canônico; revisão `same-commit` do OS |
| Apps first-party / Forge / Studio | `ordaxsystems/ordax-apps` | canônico |
| Runtime / Device Host Windows | `ordaxsystems/ordax-runtime` | canônico |
| Product MCP / Control Plane / connectors | `ordaxsystems/ordax-platform` | canônico |
| Creator Core/UI/consumer Windows | ordaxsystems/ordax-os:creator/ | canônico; mídia/release produzidas pelo OS |
| Site público | `ordaxsystems/ordax-os:site/` | canônico para apresentação/build público |
| Intelligence portátil | `ordaxsystems/ordax-intelligence` | source candidate; autoridade ativa depende do lock/cutover do OS |
| Incubação antiga | `washingtonmsdj/mcp-blender` | legado aposentado; não recebe novas features |

### Rastreamento histórico da migração inicial
- `ordaxsystems/ordax-apps#31` — retirar dependência operacional de `mcp-blender`;
- `ordaxsystems/ordax-runtime#1` — migrar Runtime/Device Host;
- `ordaxsystems/ordax-platform#2` — migrar Product MCP/Control Plane e connector;
- `ordaxsystems/ordax-apps#22` — roadmap operacional do Studio;
- `ordaxsystems/ordax-apps#23` a `#27` — projetos, continuidade, preview, transactions/undo e Blender tipado.

### Regra de atualização

Mudanças relevantes de ownership ou cutover devem atualizar este documento e `docs/contracts/repository-ownership.json` no mesmo PR. Issues são rastreamento; este documento + contrato são o SSOT.
