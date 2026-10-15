# DESKTOP-001 — Experiência cotidiana do OrdaX Desktop

- **Tipo:** PLAN / PRODUCT EXPERIENCE
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION, exceto quando um item for promovido por owner canônico do MVP
- **Prioridade:** P1
- **Criado:** 2026-10-14
- **Atualizado:** 2026-10-14
- **Owner canônico:** Surface/System/Files/Preferences/Diagnostics/Update owners existentes; este plano não cria novos owners por padrão
- **Base factual:** `main` em 2026-10-14; `PLANO-FUNCIONAL-SURFACE-E-APPS.md`, `docs/DESKTOP-IDENTITY.md`, `docs/CURRENT-STATE.md`, Files/Preferences/Diagnostics/Update contracts
- **Relatórios de apoio:** comparação de experiência cotidiana com Spaced Linux em 2026-10-14
- **Dependências:** NATIVE-001 para instalação; HARDWARE-001 para driver packs; existing Surface/Files/Diagnostics/Update capabilities

## Problema

O OrdaX já possui Surface compartilhada, OOBE, Preferences, acessibilidade, Loja, diagnostics, update/recovery e várias fundações de produto. A lacuna principal não é criar um desktop novo, mas fechar experiências cotidianas que usuários esperam depois que o sistema passa a ser usado como computador principal.

A comparação com sistemas Linux voltados ao desktop mostrou quatro áreas em que uma experiência já acabada traz grande valor sem exigir mudança de arquitetura do OrdaX:

1. Tela e monitores;
2. Ajuda/primeiros passos integrada;
3. Arquivos com fontes externas locais/rede;
4. apresentação mais simples e humana de updates/estado do sistema.

Temas mais ricos e descoberta de apps por intenção também são úteis, mas têm prioridade inferior.

## Objetivo

Evoluir a experiência do OrdaX para uso diário sem duplicar serviços já existentes.

```text
Surface
├── Ajustes
│   ├── Tela e monitores
│   ├── Aparência
│   └── Acessibilidade
├── Arquivos
│   ├── OrdaX
│   ├── unidades locais/USB autorizadas
│   ├── telefone conectado
│   ├── rede/SMB
│   └── cloud/device sources quando MODE-001 existir
├── Sistema
│   ├── Atualizações
│   ├── Recovery
│   ├── Hardware
│   └── Diagnóstico
└── Ajuda
    ├── Primeiros passos
    ├── Instalação
    ├── Wi-Fi/Arquivos/Loja/Updates
    └── Resolver um problema com diagnóstico autorizado
```

## Não objetivos

- não substituir a Surface atual;
- não criar outro Files service;
- não criar outro updater;
- não criar outro diagnostic store;
- não duplicar Hardware/Drivers de HARDWARE-001;
- não incorporar Caja/GVfs/MATE/Compiz como solução estrutural só por referência externa;
- não bloquear Native P0 com Theme Packs ou recursos cosméticos;
- não fingir MTP/SMB/cloud quando o provider/capability não está implementado.

## Estado atual verificado

### Já implementado

- Surface compartilhada Web/Native;
- identidade visual SSOT;
- temas claro/escuro e paleta OrdaX USB;
- wallpaper/prefs reais;
- acessibilidade com contraste, redução de movimento e escala de texto;
- OOBE persistente;
- diagnostics estruturados, sanitizados, copy/export;
- System/Update/Recovery presentation e contracts existentes;
- Store e app discovery foundation;
- Mobile Companion contracts incluem file/share handoff, mas runtime mobile permanece não implementado/promovido;
- Files/permissions architecture já existe em vez de acesso arbitrário.

### Parcialmente implementado

- Updates possuem engine/canais/estado mais maduros que a apresentação ao usuário comum;
- Ajuda existe de forma distribuída em docs/Creator/system copy, não como experiência unificada dentro da Surface;
- hardware status/diagnostics existem em partes, mas o painel final depende de HARDWARE-001;
- mobile/device file handoff possui contratos, não uma jornada cotidiana equivalente a conectar telefone por USB.

### Ausente/não comprovado como experiência final

- display manager real para resolução/escala/orientação/arranjo/múltiplos monitores;
- Help Center integrado ao sistema;
- provider SMB no Arquivos;
- provider MTP/PTP/telefone USB equivalente para arquivos locais;
- fluxo de descoberta de apps por intenção/tarefa plenamente desenvolvido;
- Theme Packs amplos;
- UX consolidada de detalhes/progresso/reboot/history em Updates para usuário não técnico.

## Decisões arquiteturais

### 1. Tela e monitores pertencem a capability/adapter, não a CSS da Surface

A UI deve consumir um contrato de displays. Detecção/configuração real pertence ao adapter/runtime Native.

### 2. Ajuda reutiliza documentação canônica e diagnóstico

Não criar base de conhecimento divergente. Ajuda deve apontar para conteúdo versionado/offline e, quando Intelligence for usada, ela deve consultar somente fontes oficiais/permitidas e não inventar estado do dispositivo.

### 3. Arquivos usa providers/sources explícitas

```text
Files
 -> local user space
 -> removable media
 -> phone USB (MTP/PTP quando suportado)
 -> SMB/network share
 -> cloud/device providers futuros
```

Cada source tem capability/grant e estado próprio. Nenhuma source externa vira path arbitrário implícito.

### 4. Updates: melhorar UX, preservar engine

A apresentação deve mostrar linguagem simples por padrão e detalhes técnicos recolhíveis, reutilizando o mesmo update owner.

### 5. Theme Packs são cosméticos e tardios

Podem existir depois, mas não justificam duplicar tokens nem atrasar MVP.

## Fases

### Fase 0 — auditoria de capacidades existentes

- reconciliar `SURFACE-001`, Preferences, Files, Diagnostics, System Update e Mobile Companion;
- identificar exatamente quais adapters faltam;
- não criar serviço novo quando um port existente puder ser estendido.

**Gate D0:** owner map fechado.

### Fase 1 — Tela e monitores

Contrato sugerido de capability, sem fixar API de compositor antecipadamente:

- listar outputs;
- resolução atual e modos válidos;
- refresh rate disponível;
- escala;
- orientação;
- posição relativa;
- primary output;
- apply/revert com timeout seguro;
- persistência apenas após confirmação.

UX deve oferecer preview e rollback automático se o usuário não confirmar a nova configuração.

**Gate D1:** configuração inválida ou tela perdida reverte automaticamente.

### Fase 2 — Ajuda/Primeiros passos

- home de Ajuda offline;
- links contextuais a partir de Sistema/Ajustes/Arquivos/Loja;
- tópicos para instalação Native, rede, updates, recovery, arquivos e privacidade;
- ação explícita `Preparar diagnóstico` reutilizando o controller existente;
- integração opcional com Intelligence para explicar docs + estado permitido.

**Gate D2:** Ajuda funciona offline e nunca envia diagnóstico sem ação explícita.

### Fase 3 — Files providers externos

#### 3A — mídia removível/telefone local

- detectar volumes removíveis já suportados;
- avaliar MTP/PTP para Android/câmeras sem depender do futuro Mobile Companion;
- iOS somente quando existir protocolo/implementação legal e tecnicamente justificável;
- mount/session/grant explícitos;
- eject/disconnect seguro.

#### 3B — SMB

- `smb://`/discovery opcional;
- credentials no credential owner, nunca em app state/plaintext;
- mount/session lifecycle explícito;
- offline/reconnect/degraded states.

**Gate D3:** disconnect/revocation remove acesso; credentials não vazam para Files UI/logs.

### Fase 4 — Updates UX

- visão simples: atualizado / update disponível / precisa reiniciar / falhou e reverteu;
- progresso baseado em etapas reais, não percentuais fabricados;
- `Ver novidades`;
- detalhes técnicos recolhíveis: versão, component, channel, signature/health state quando seguro;
- histórico baseado nos owners existentes;
- nenhum clique na UI muda policy de canal sem consentimento explícito.

**Gate D4:** presentation nunca diverge do estado autoritativo do updater.

### Fase 5 — descoberta de apps por intenção

Sem criar catálogo paralelo:

- exemplos: "editar imagens", "vídeo", "desenvolvimento", "escritório";
- mapear intenção para tags/categories do catálogo oficial;
- apenas itens realmente presentes no catálogo aparecem;
- não inventar disponibilidade.

### Fase 6 — Theme Packs

P2 dentro deste plano:

- tokens semânticos;
- contraste/accessibility gates;
- wallpaper/icons onde aplicável;
- signed metadata se distribuídos externamente;
- tema nunca pode injetar código/authority.

## Gates de aceite

1. nenhum serviço duplicado de Files/Update/Diagnostics/Preferences;
2. Display apply tem confirmação/revert seguro;
3. Help funciona offline;
4. diagnóstico só é coletado/exportado por ação explícita;
5. MTP/PTP/SMB respeitam capabilities/credentials;
6. desconectar/revogar source remove acesso;
7. Update UI reflete estado real e fail-closed;
8. app discovery consome catálogo oficial;
9. Theme Pack não altera permissions/capabilities.

## Segurança/privacidade

- credenciais SMB ficam fora do estado serializado da UI;
- Help/Intelligence não recebe filesystem amplo por padrão;
- display adapters não aceitam comandos arbitrários;
- diagnostics preservam redaction atual;
- phone/media access é session/grant-bound;
- arquivos externos não são sincronizados automaticamente para cloud.

## Custos/limites

A maior parte é desenvolvimento local/desktop. Protocolos e bibliotecas externos precisam de revisão de licença/segurança. Nenhuma VPS/cloud é requisito para Displays, Help offline, MTP/PTP ou SMB local.

## Testes/evidências

- single/multi-monitor, resolução inválida e auto-revert;
- unplug/replug de monitor;
- Ajuda totalmente offline;
- diagnostics explicit action only;
- MTP/PTP connect/disconnect/read/write conforme grant;
- SMB auth fail/revoke/reconnect;
- update progress/state mismatch negatives;
- catalog unavailable em discovery;
- accessibility/keyboard navigation;
- physical validation quando comportamento depende de hardware.

## Rollback/degradação

- sem display adapter: manter configuração atual e esconder/desabilitar controls reais;
- sem MTP/SMB: source aparece indisponível, sem mock;
- Help continua local mesmo sem Intelligence/cloud;
- update presentation failure não afeta updater;
- Theme Pack inválido reverte para identidade canônica.

## Relação com outros planos

- `NATIVE-001`: fecha instalação e hardware mínimo; este plano melhora uso diário depois.
- `HARDWARE-001`: owner da instalação/rollback de packs; aqui só existe navegação/apresentação integrada.
- `MODE-001`: futuramente adiciona Cloud/Device sources ao mesmo modelo de Files; não bloquear providers locais esperando Web.
- `SURFACE-001`: continua owner funcional da Surface; este plano não redesenha shell.
- `WEB-001`: Help pode futuramente usar Web Research somente quando explicitamente online; base de ajuda continua oficial/offline.

## Próxima ação documental

Quando o MVP fechar, começar pela Fase 0 e decidir se Display/Help/Files providers já têm owners/contracts suficientes ou se precisam de ADR/contrato próprio.

## Próxima ação de execução

**DEFERRED**, salvo promoção explícita por owner canônico.

## Handoff para outro chat/agente

1. não recriar Surface, Files, Diagnostics ou Update;
2. ler os owners reais antes de propor paths;
3. tratar Display como capability nativa, não UI-only;
4. Help deve reutilizar docs/diagnóstico e funcionar offline;
5. MTP/PTP é independente do futuro APK/Mobile Companion;
6. SMB precisa de credential boundary real;
7. updates recebem apenas polimento de UX sobre o engine atual;
8. Theme Packs são P2 e nunca bloqueiam Native/MVP;
9. qualquer capacidade não implementada deve aparecer como indisponível, não mock.
