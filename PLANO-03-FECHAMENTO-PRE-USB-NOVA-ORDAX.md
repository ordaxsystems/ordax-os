# OrdaX — parte 3: fechamento funcional pré-USB da visão Nova OrdaX

**Status:** plano canônico de auditoria pré-USB; fechamento de source concluído e preservado como baseline para retestes físicos.  
**Data:** 28/09/2026.  
**Protótipo auditado originalmente:** `main@8405feedb05421ea321cc277c0b7b912b6da7117`.  
**Referência Nova OrdaX:** `washingtonmsdj/novo-ordax-os@49fe41fa67d9032f2e349e86592304e64d6c2d88`.

**Continua, sem substituir:**

- `MVP.md`;
- `PLANO-FUNCIONAL-SURFACE-E-APPS.md`;
- `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md`;
- contratos e estado canônicos em `docs/`.

Este documento existe para evitar que uma capacidade estrutural da Nova OrdaX seja
descoberta somente depois da primeira mídia Stable/MVP. A existência de uma
especificação no legado não a torna requisito do MVP; da mesma forma, a existência
de um backend no protótipo não prova que a experiência de sistema correspondente
está integrada.

Nenhuma seção deste plano autoriza escrita física. O primeiro proof físico governado
já ocorreu; qualquer reteste ou nova gravação continua subordinado ao contrato de
autorização corrente e aos gates de `docs/PROMOTION-GATES.md`.

---

## 0.1 Progresso após a auditoria

A primeira lacuna P0 já foi atacada na mesma linha arquitetural deste plano:

- composição Native: `ordax.local-ai/1 -> ordax.intelligence/1`;
- descoberta do modelo ativo fica dentro do owner local-AI, não na Surface;
- Notas possui consumidor consultivo de resumo, com contexto bounded + provenance;
- Sistema possui consumidor consultivo de explicação de estado, limitado ao snapshot local permitido;
- nenhum dos consumidores ganha autoridade de mutação ou importa provider/modelo diretamente;
- ausência do backend continua degradável e não crítica para o boot.

Isso fecha `INTELLIGENCE_REAL_SYSTEM_CONSUMER` e o handoff v4 em **source**:
Portable v2 verifica o manifest v4, monta `local-ai-runtime.erofs` read-only e
Stable Base inicia o backend loopback quando o runtime verificado está disponível.
Falha da IA continua degradável e não bloqueia o boot. A candidata Stable v4 real
já foi assinada/materializada como prerelease canônica e o primeiro proof físico
controlado completou 17/17 readback e boot UEFI. O hardening pós-boot foi integrado
na PR #588; o candidato atual ainda exige reteste físico separado e autorização fresca.

### 0.2 Sessão local/lock Native — fechamento em source

O segundo fundamento P0 também foi implementado no recorte pré-USB:

- contrato independente `ordax.local-session/1`;
- capability `session.local-lock` exclusiva do Native;
- conta online/identity continua separada;
- credencial local é opcional no MVP;
- sem credencial, o sistema funciona local/offline e não finge oferecer bloqueio autenticado;
- com credencial, um novo start da Surface inicia bloqueado;
- segredo não entra em `first-run.json`, telemetria ou persistência JS;
- host persiste somente salt + verificador scrypt em arquivo `0600`, com troca atômica;
- tentativas incorretas recebem backoff limitado;
- arquivo de credencial presente ou inválido falha fechado;
- lock preserva Workspace/estado montado e torna a Surface inerte até unlock;
- o escopo é explicitamente sessão, **não criptografia dos arquivos do USB**;
- First Run possui etapa Segurança separada de Conta e Ajustes permite configurar/remover/bloquear depois.

```text
LOCAL_SESSION_LOCK_POLICY=PASS_SOURCE
LOCAL_SESSION_LOCK_IMPLEMENTATION=PASS_SOURCE
LOCAL_SESSION_LOCK_PHYSICAL_PROOF=PENDING
```

### 0.3 Arquivos — remoção segura fechada em source

A jornada cotidiana de Arquivos agora possui remoção recuperável no mesmo owner de
`ordax.file-space/11`:

- `trashEntry()`, `listTrash()` e `restoreTrashEntry()`;
- namespace interno reservado e não navegável pela API pública;
- metadata bounded com caminho lógico original e ID interno aleatório;
- arquivo/pasta no mesmo filesystem vai para a Lixeira por rename no-clobber;
- restauração também é no-clobber e nunca substitui um item criado depois no caminho original;
- symlinks e payloads inválidos falham fechados;
- tentativa cross-device para a Lixeira é rejeitada e preserva a origem;
- Recentes deixa de apontar para o item movido;
- continuidade de Projeto afetada é limpa somente depois de trash confirmado;
- não há exclusão permanente nem “esvaziar Lixeira” no fluxo cotidiano do MVP.

```text
FILES_DAILY_OPERATIONS=PASS_SOURCE
FILES_SAFE_REMOVAL=PASS_SOURCE
FILES_PERMANENT_DELETE_MVP=NO
FILES_TRASH_PHYSICAL_PROOF=PENDING
```

### 0.4 Diagnóstico/Recovery e hardware — fechamento em source

O owner diagnóstico já existente agora é composto na Surface Native, em vez de
permanecer apenas como serviço/teste. Sistema passa a oferecer revisão local explícita
e sanitizada, com cópia/exportação quando os adapters reais estão disponíveis.

Recovery ganhou um observer read-only `ordax.recovery-status/1`, limitado ao
`portable-v2`. Ele lê somente:

- slot/release em execução;
- `current`;
- `known-good`;
- candidato e transação pendente;
- a entrada `ordax-portable-recovery.conf` no ESP, validando os marcadores mínimos.

O observer não possui rollback, reboot, repair, rede automática ou mutação automática.
A matriz conservadora `hardware-support-matrix/1` já fecha a política de suporte em
source, sem promover um único notebook de desenvolvimento a claim amplo de hardware.

```text
DIAGNOSTICS_RECOVERY_PRESENTATION=PASS_SOURCE
RECOVERY_STATUS_AUTHORITY=READ_ONLY
RECOVERY_STATUS_PHYSICAL_PROOF=PENDING_PHYSICAL
SUPPORTED_HARDWARE_MATRIX=PASS_SOURCE
CANONICAL_STABLE_TARGET_HARDWARE_PROOF=PENDING_PHYSICAL
```

## 1. Decisão principal

**O primeiro proof físico Stable/MVP já ocorreu; não repetir a escrita com a autorização antiga.**

O conjunto **A — obrigatório pré-USB** abaixo foi criado para impedir que lacunas
estruturais chegassem à primeira mídia física. Essa missão cumpriu sua função: o primeiro
writer governado executou o plano de 39 operações/17 artefatos, verificou 17/17 por
readback e chegou a boot UEFI real. Os achados físicos motivaram o hardening integrado
na PR #588.

A decisão corrente é diferente da decisão original deste plano: **qualquer novo reteste
do candidato pós-hardening permanece bloqueado até existir e ser vinculado um replacement canonical v4 proof; somente depois disso a autorização explícita fresca volta a ser alcançável**, além
dos gates de target, UAC e confirmação destrutiva. O proof anterior é evidência histórica,
não autoridade reutilizável.

A auditoria já fechou em source as omissões estruturais que estavam abertas quando
este plano foi criado: consumidores reais de Ordax Intelligence, sessão/lock local Native,
remoção recuperável em Arquivos, cobertura pública PT-BR/en-US, diagnóstico/recovery,
matriz mínima de hardware e lifecycle Stable v4 canônico. As provas físicas restantes
são agora do candidato endurecido: Surface completa, rede, cold-health, recovery/rollback
e Secure Boot quando aplicável.

Portanto **“boot/release avançado” continua não equivalendo a “produto fisicamente promovido”**.

---

## 2. Três classes de fechamento

### A — obrigatório antes de uma missão física Stable/MVP

Precisa estar implementado e provado em source/CI antes de uma escrita física autorizada.

1. **Ordax Intelligence realmente composta no produto.**
   - inicializar `ordax.local-ai/1` + `ordax.intelligence/1` na composição Native;
   - expor estado degraded/ready sem bloquear boot;
   - pelo menos dois consumidores first-party reais e somente-leitura, por exemplo:
     - Notas: resumir/explicar conteúdo selecionado com provenance;
     - Sistema/Diagnóstico: explicar um relatório sanitizado;
   - nenhum acesso implícito a arquivo, shell, rede externa, pacote ou disco;
   - contexto sempre bounded e com provenance;
   - engine/modelo continuam substituíveis.

2. **Sessão local/offline e bloqueio do dispositivo.**
   - separar conta online de usuário/sessão local;
   - definir e implementar política Native de lock/unlock;
   - preservar Workspace/janelas/estado suportado ao bloquear;
   - não depender de Supabase, Web ou internet;
   - segredo local não pode entrar em telemetria, first-run state ou Git;
   - decidir e documentar se o MVP permite sessão sem PIN/senha e qual é o comportamento
     de bloqueio nesse caso.

3. **Idiomas oferecidos pelo OOBE coerentes com a Surface. — PASS_SOURCE**
   - PT-BR permanece fonte;
   - o MVP público oferece somente PT-BR e en-US, ambos completos na Surface compartilhada;
   - es-ES, de-DE e fr-FR continuam aceitos em estados persistidos e mantêm o OOBE traduzido, mas ficam ocultos dos seletores públicos até a Surface correspondente atingir o mesmo padrão;
   - a seleção pública não leva mais a uma Surface principal significativamente misturada com português;
   - não anunciar cobertura falsa.

4. **Arquivos: fechar jornada cotidiana mínima. — PASS_SOURCE**
   - `ordax.file-space/11` mantém list/create/read/rename/copy/move/import/export e preview;
   - remoção segura foi implementada por Lixeira recuperável;
   - restore é no-clobber e não substitui arquivos existentes;
   - namespace interno da Lixeira não é navegável pelo file-space público;
   - delete irreversível/esvaziar não faz parte do fluxo cotidiano do MVP;
   - confinamento à raiz do usuário, limites, colisões e erros tipados permanecem.

5. **OOBE/primeiro uso como fluxo real do produto.**
   - persistência Native/USB do estado;
   - idioma/fuso;
   - rede opcional;
   - continuar sem conta;
   - privacidade;
   - chegada à Surface;
   - teclado com comportamento honesto: o seletor não promete troca imediata se Cage
     exige reinício da Surface;
   - reentrada/reboot não pode refazer indevidamente etapas concluídas.

6. **Diagnóstico e recuperação visíveis e coerentes.**
   - Sistema deve mostrar saúde/update/recovery usando owners existentes;
   - exportação diagnóstica deve permanecer sanitizada;
   - recovery não pode depender da IA;
   - não criar segundo owner de update/recovery.

7. **Inventário mínimo de hardware e matriz de suporte.**
   - declarar hardware oficialmente suportado no MVP;
   - mostrar no Sistema o que o host realmente conhece, sem simular sensores;
   - separar “detectado”, “suportado” e “fisicamente provado”;
   - usar isso como entrada do tour físico do Stable USB.

8. **Release Stable v4 completa.**
   - `system.erofs`;
   - `native-surface-runtime.erofs`;
   - `local-ai-runtime.erofs`;
   - manifest v4 assinado;
   - aquisição/materialização offline exata;
   - handoff de boot preservando o v3 conhecido-bom;
   - IA continua não crítica para o boot.

### B — source deve estar pronto antes; prova final acontece no USB

Esses itens não podem ser “provados fisicamente antes do pendrive”, mas a
implementação e os testes descartáveis devem estar fechados antes da escrita.

- boot UEFI Stable/MVP;
- Wi-Fi real no hardware-alvo, incluindo os tipos de rede que forem oficialmente
  declarados como suportados;
- teclado/mouse;
- relógio/fuso após reboot;
- browser WebKit real;
- áudio, suspend/resume e aceleração gráfica se forem declarados como suportados
  no lançamento;
- Surface smoke completa;
- cold-health e commit do known-good;
- rollback após candidato defeituoso;
- boot offline;
- local AI carregando no hardware real sem impedir o OS se falhar.

### C — pós-MVP consciente

Ficam fora do primeiro USB **por decisão**, não por esquecimento:

- instalação Native em SSD/NVMe/HD;
- dual boot e resize;
- OrdaX Mobile completo;
- OrdaX Desktop como produto instalado (o Creator desktop é outra responsabilidade);
- sync cloud e continuidade entre dispositivos;
- backup cloud;
- Store **pública/instalação de terceiros**;
- package manager geral para terceiros;
- SDK público completo;
- ativação comercial e UI de perfis profissionais;
- Object System universal/grafo de objetos;
- ferramentas mutáveis de IA;
- Agent Manager;
- sync/cloud de memória e histórico remoto;
- automações gerais;
- multi-agent coordination;
- Federation / Research Lab / Mission Control;
- controle remoto geral.

Esses itens podem conservar contratos de extensão, mas não devem aumentar o bootstrap
nem criar owners duplicados no MVP.

---

## 3. Reclassificação atual das capacidades C01–C27 do PLANO-02

| ID | Capacidade | Estado no fechamento corrente | Classe pré-USB |
|---|---|---|---|
| C01 | Arquivos | **Fechado para a jornada cotidiana pré-USB em source.** `ordax.file-space/11` acrescenta Lixeira recuperável e restore no-clobber ao fluxo existente. Delete permanente continua deliberadamente fora do MVP. | **PASS_SOURCE; prova física=B** |
| C02 | Wi-Fi cotidiano | **Implementado em source.** scan/connect/disconnect/forget/reconnect e quick panel existem. Cobertura física por tipo de rede continua limitada. | **B** |
| C03 | Sessão local, login, lock/unlock | **Sessão/lock local fechado em source.** `session.local-lock` é Native/offline, independente de conta cloud, usa verificador scrypt e falha fechado. Conta online continua opcional e separada. | **PASS_SOURCE; prova física=B** |
| C04 | Workspace/projeto | **Parcial avançado.** workspace-store v2, áreas/janelas/targets, projetos e recent files existem. | A somente no que sustenta continuidade local |
| C05 | Checkpoint de sessão | **Parcial.** janelas/targets persistem, mas não existe checkpoint genérico de estado interno por app/documento/posição/rascunho. | A mínimo; riqueza pós-MVP |
| C06 | Home contextual/continuar trabalho | **Implementado em recorte útil.** Projetos, Recentes e Pendências existem. | Fechado para MVP |
| C07 | Inventário/suporte de hardware | **Política mínima fechada em source.** `hardware-support-matrix/1` separa driver presente, evidência física e claim de suporte; não generaliza o notebook de desenvolvimento para outras famílias. | **PASS_SOURCE; prova física=B** |
| C08 | Conta/identidade entre modos | **Backend real + gateway de sessão implementados em source.** Ativação pública continua bloqueada por deployment/hardening/legal; conta segue opcional no MVP. | C |
| C09 | Sync/continuidade cloud | **Backend account-scoped, transporte Web e ponte Native/USB existem em source.** Rollout público, gateway implantado e prova real entre dispositivos continuam pendentes. | C |
| C10 | Mobile Companion | **Futuro.** | C |
| C11 | Desktop instalado e Creator | Creator é trilha MVP; Desktop como produto é futuro. | Creator=A/B; Desktop=C |
| C12 | Apps instaláveis/SDK | **FUNDAÇÃO PRÉ-MVP.** Contrato de distribuição/manifesto assinado existe; instalação externa e SDK público continuam fora do primeiro USB. | **PASS_SOURCE foundation; C para instalação/SDK** |
| C13 | Store | **FUNDAÇÃO PRÉ-MVP.** Store futura compartilha manifesto, assinatura, permissions e updater; UI pública/publicação/billing permanecem posteriores. | **PASS_SOURCE foundation; C para Store pública** |
| C14 | Perfis profissionais | **FUNDAÇÃO PRÉ-MVP via Spaces/Profile Packs.** Conta pessoal é separada; Developer e Legal-BR existem apenas como packs draft. | **PASS_SOURCE foundation; C para ativação comercial/domain runtime** |
| C15 | Objetos com provenance | **Não existe Object System universal.** Usar metadata/provenance pequenos onde necessários, inclusive IA. | C; provenance mínimo=A |
| C16 | IA nativa/contexto/tools | **IA consultiva fechada em source + fundação de memória/router.** Native compõe `local-ai -> intelligence`; `ordax.memory/1` mantém memória provider-neutral e `ordax.model-router/1` prepara rotas externas sem egress implícito. Handoff Stable v4 do backend está `PASS_SOURCE`; cloud memory/tools mutáveis continuam deferidos. | **PASS_SOURCE consumidores/foundation; A/P2 para lifecycle v4; C para cloud/tools/agents** |
| C17 | Conhecimento/integrações/automações | **BOUNDARY PRÉ-MVP.** Product MCP/OAuth, Space/project scope e GitHub App ficam especificados; conectores ativos, automações e mutações continuam deferidos. | **PASS_SOURCE boundary; C para runtime público** |
| C18 | Diagnóstico/receipts/captura | **Fechado em source para o MVP.** Controller diagnóstico sanitizado é composto no Native; Sistema prepara/copia/exporta revisão explícita e apresenta recovery Portable v2 read-only sem autoridade de rollback/reboot. | **PASS_SOURCE; prova física=B** |
| C19 | Controle remoto/Companion | Não é requisito do bootstrap/MVP. | C |
| C20 | Update transacional/rollback | **Muito avançado em CI/source.** Falta Stable físico/cold-health. | **B** |
| C21 | Native/durable storage | Native pós-MVP. USB durável é a trilha atual. | USB=A/B; Native=C |
| C22 | Build Intelligence/cache | Build/reprodutibilidade já resolvidos por mecanismos atuais; não portar framework antigo. | Fechado/continuar medindo |
| C23 | Project Intelligence/Mission Control | Visão futura. | C |
| C24 | Federation/Research Lab/agentes de engenharia | Visão futura. | C |
| C25 | Navegador/produtividade | Internet e Notas existem; WebKit Native ainda exige prova física Stable. | **B** |
| C26 | Notificações/acessibilidade/onboarding | Notification Center e OOBE existem; idiomas completos da Surface e alguns gates físicos seguem abertos. | **A/B** |
| C27 | Backup/histórico de dados pessoais | Serviço completo de backup do usuário não existe; não é requisito atual do MVP. Exportação local e recuperação do sistema não equivalem a backup. | C, com export local segura no MVP |

---

## 4. O que a visão Nova OrdaX exige preservar na arquitetura atual

### 4.1 Runtime único e APIs públicas

Não criar um “runtime da IA”, “runtime do app” ou “runtime do sync” com autoridade
paralela. A camada de Intelligence chama serviços através de contratos do produto.

### 4.2 Workspace e Session são diferentes

- Workspace = contexto de trabalho.
- Session = continuidade/autenticação/bloqueio.
- Conta online = identidade de ecossistema.

A Surface atual já possui Workspace; isso não deve ser usado como substituto de
sessão local.

### 4.3 Intelligence é uma camada, inference é um backend

Continuar preservando:

```text
Files / Notes / System / future Assistant
 -> ordax.intelligence/1
 -> ordax.local-ai/1
 -> llama.cpp + model
```

Não permitir:

```text
Notes -> llama.cpp diretamente
Files -> modelo diretamente
Assistant -> owner da Intelligence
```

### 4.4 Contexto não concede autoridade

O MVP pode enviar contexto local sanitizado e proveniente para explicar/resumir.
Isso não concede permissão para executar ações.

O mínimo pré-USB é **contexto consultivo real**; Tool Manager e Capability Bridge
mutáveis continuam pós-MVP.

### 4.5 Observabilidade e degradação

Cada serviço estrutural deve ser capaz de expor pelo menos estado/health útil.
Falha da IA, conta ou rede não pode derrubar a Surface ou bloquear arquivos locais.


### 4.6 Fundação de ecossistema sem ampliar o primeiro USB

O pré-MVP agora também preserva as fronteiras que seriam caras de migrar depois de contas/dados reais:

```text
Account
 -> Spaces
    -> Profile Packs
    -> projects
    -> memory
    -> memberships

ordax.intelligence/1
 -> ordax.memory/1
 -> ordax.model-router/1
    -> local
    -> external adapters (future)
```

Isso é **fundação de source/backend**, não escopo funcional do primeiro USB. Billing, cloud memory,
Store pública, GitHub App público, Product MCP implantado e Profile Packs profissionais ativados
continuam fora do gate físico. O Control Plane de desenvolvimento não empresta credenciais ou
autoridade administrativa a usuários finais.

---

## 5. Anti-omission gate

Aplicar esta regra a qualquer preparação Stable/MVP física:

```text
PRE_USB_NOVA_ORDAX_AUDIT=PASS
INTELLIGENCE_REAL_SYSTEM_CONSUMER=PASS
LOCAL_SESSION_LOCK_POLICY=PASS
LOCAL_SESSION_LOCK_IMPLEMENTATION=PASS
OOBE_PERSISTENCE=PASS_SOURCE
OOBE_LOCALE_COVERAGE=PASS_OR_EXPLICITLY_REDUCED
FILES_DAILY_OPERATIONS=PASS_SOURCE
FILES_SAFE_REMOVAL=PASS_SOURCE
DIAGNOSTICS_RECOVERY_PRESENTATION=PASS_SOURCE
SUPPORTED_HARDWARE_MATRIX=PASS
SIGNED_RELEASE_V4_WITH_LOCAL_AI=REQUIRED_PASS_BEFORE_PHYSICAL_PREFLIGHT
PHYSICAL_WRITE=STILL_SEPARATE
```

O bloco acima descreve o **estado exigido para liberar o preflight físico**. A candidata
v4 versionada passou por assinatura, materialização/verificação canônica e agregação/vínculo
da prova. O primeiro proof físico governado usou uma autorização explícita válida naquele
contexto, completou 17/17 readback e alcançou UEFI. Depois do hardening da PR #588, essa
autorização não vale para os bytes/contexto atuais. O contrato voltou corretamente a
`blocked-explicit-physical-authorization-pending`; nenhuma nova escrita está autorizada.

Os três inputs EROFS reais agora podem ser exportados sem publicação por `workflow_dispatch` nos builders canônicos de System, Surface e Local AI. A exportação é manual-only, retida por 1 dia e não contém chave privada. Cada pacote inclui `operator-receipt.json` com source commit, SHA-256 e tamanho dos bytes exportados; o receipt de Local AI também vincula `source-lock.json`. O preflight local recalcula esses bindings e exige os três receipts no mesmo SHA. Essa barreira passou em CI no run `36166653548`, incluindo rejeição de receipt com commit divergente e bytes adulterados após a emissão. Ela reduz a preparação operacional, mas **não** substitui assinatura com a chave canônica, publicação HTTPS revisada, materialização canônica, agregação do recibo ou autorização física.

O gate é de produto/source. Ele **não** substitui:

- trust;
- confirmação destrutiva;
- seleção do USB;
- UAC;
- readback;
- prova física.

---

## 6. Ordem de implementação antes do USB

### P0 — arquitetura esquecida — concluído em source

1. **Intelligence composition + consumidores read-only reais. — PASS_SOURCE**
2. **Sessão local/lock Native. — PASS_SOURCE**
3. **Docs/contratos canônicos reconciliados. — PASS_SOURCE**

### P1 — experiência cotidiana

4. Arquivos: remoção segura/lixeira. — **PASS_SOURCE**
5. Cobertura real de idioma da Surface para os idiomas oferecidos no OOBE. — **PASS_SOURCE**: PT-BR e en-US são os únicos idiomas oferecidos pelo MVP público e ambos cobrem shell, Home, boot screen, Arquivos profundo, Ajustes, Sistema, Conta, Notas, Internet, trays/quick panels e Central de Notificações pelo mesmo `ordax.localization/1`; feedback first-party assíncrono relevante usa identidade semântica rerenderizável; o painel de rede continua sem persistir credenciais; es-ES/de-DE/fr-FR ficam preservados somente para compatibilidade/OOBE e rollout futuro, sem claim de Surface completa
6. Diagnóstico/recovery em Sistema. — **PASS_SOURCE**: controller diagnóstico Native agora é composto de verdade e Sistema exibe recovery read-only a partir dos marcadores reais de `current`, `known-good`, candidato/transação e entrada local de recovery; prova física continua B
7. Inventário mínimo/suporte de hardware. — **PASS_SOURCE** via `hardware-support-matrix/1`; prova física do hardware-alvo Stable continua B

### P2 — fechar release

8. Handoff v4 com AI real. — **PASS_CANONICAL_VERSIONED_PRERELEASE**: os três artefatos assinados foram publicados na candidata versionada.
9. Materialização v4 com bytes reais + regressão QEMU/UEFI v4. — **PASS_CANONICAL_CI_NON_PROMOTIONAL**: a URL HTTPS exata foi materializada e verificada em CI e entrou na prova agregada; isso não substitui a prova física nem promove `latest`.
10. Creator físico alinhado ao payload Stable v4. — **PASS_SOURCE_CANDIDATE**: plano final passa de 15 para 17 artefatos e de 35 para 39 operações, incluindo `local-ai-runtime.erofs` content-addressed + `local-ai-runtime.sha256`; o writer mantém seu próprio Git SHA apenas como provenance e vincula o `source_commit` do plano Portable ao release canônico de `release_binding.source_commit`; `prepare-portable`/`apply-portable` exigem exatamente 17 fontes e falham se o commit do plano divergir do release provado; consentimento físico anterior fica inválido por contexto.
11. Preflight canônico v4 do operador. — **PASS_SOURCE_READ_ONLY**: valida artefatos públicos, source-lock, trust, tooling, commit, URLs HTTPS estáveis e metadados do caminho da chave privada sem ler o PEM, assinar, publicar, materializar ou tocar mídia física.
12. Gate proof-before-consent. — **PASS_CANONICAL_PRERELEASE_BOUND**: `canonical-v4-release-proof.json` real foi validado contra trust/commit/manifest/envelope/3 artefatos e vinculado por SHA-256 antes de `pre_authorization_ready`.
13. Primeiro proof físico governado. — **PASS_PRE_HARDENING**: writer 39-op/17-artifact, 17/17 readback e boot UEFI real; evidência preservada sem promover o candidato pós-#588.
14. Próximo passo condicionado ao hardware: novo consentimento explícito para o contexto pós-hardening atual e execução dos gates físicos antes do reteste Stable/MVP.

---

## 7. Itens deliberadamente não puxados para o MVP

A análise da Nova OrdaX **não** muda as decisões já tomadas:

- conta online continua opcional;
- cloud/sync não bloqueiam o USB MVP;
- Native em disco continua pós-MVP;
- Store **pública** não bloqueia; sua fundação de manifesto/distribuição já pode existir;
- Mobile não bloqueia;
- Spaces/Profile Packs podem existir como fundação; ativação comercial/profissional não bloqueia;
- memória provider-neutral pode existir como contrato/schema; cloud memory não bloqueia;
- Product MCP pode existir como boundary; conectores/automação/mutações não bloqueiam;
- agentes/tools mutáveis não bloqueiam;
- federação não bloqueia;
- Remote Core/Control Plane de produto não entram por antecipação.

Essa separação é importante: a auditoria serve para encontrar **fundamentos esquecidos**,
não para transformar toda a visão futura em escopo de lançamento.

---

## 8. Critério para voltar ao pendrive

Voltar à missão física somente quando:

1. todos os itens A estiverem PASS em source/CI ou tiverem uma decisão canônica explícita
   retirando-os do MVP;
2. existir um **replacement** manifest/release v4 pós-hardening assinado/materializável e um novo aggregate receipt `canonical-v4-release-proof.json` validado/vinculado a outro source commit; o proof histórico de `b924ff8d74d1761232381ae3f9604bba17497cfd` não satisfaz esse gate;
3. os testes descartáveis/UEFI relevantes estiverem verdes;
4. documentação canônica e contratos estiverem coerentes;
5. somente depois do replacement proof vinculado permitir um **novo** preflight de consentimento do dono e, após consentimento explícito, aplicar novamente os gates físicos já existentes.

O primeiro proof controlado é evidência histórica e não autorização permanente. Para o
candidato pós-hardening atual, o estado correto é:

```text
CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_BOUND_VERSIONED_PRERELEASE_PRE_HARDENING
CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PENDING_POST_HARDENING_REPLACEMENT
FIRST_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF_PRE_HARDENING
FIRST_STABLE_MVP_USB_READBACK=PASS_17_OF_17_PRE_HARDENING
FIRST_STABLE_MVP_USB_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING
CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=BLOCKED_REPLACEMENT_RELEASE_PROOF
PHYSICAL_WRITE_AUTHORITY=BLOCKED_CANONICAL_V4_RELEASE_PROOF_PENDING
```