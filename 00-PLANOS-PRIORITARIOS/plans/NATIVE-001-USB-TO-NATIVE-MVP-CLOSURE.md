# NATIVE-001 — USB → Native e fechamento do MVP instalável

- **Tipo:** PLAN / MVP CLOSURE
- **Status documental:** READY
- **Elegibilidade de execução:** EXECUTION-ELIGIBLE somente quando/onde exigido pelos owners canônicos do MVP; toda escrita física continua sujeita aos gates de autorização e segurança existentes
- **Prioridade:** P0
- **Criado:** 2026-10-14
- **Atualizado:** 2026-10-14
- **Owner canônico:** `MVP.md`, `docs/NATIVE-INSTALLATION.md`, `docs/contracts/native-installation.json`, `docs/contracts/distribution-profiles.json`, `docs/PROMOTION-GATES.md`, Creator Core e owners de boot/storage/recovery
- **Base factual:** `main` em 2026-10-14; `docs/CURRENT-STATE.md`; contratos Native/Portable/Hardware atuais
- **Relatórios de apoio:** comparação de produto com Spaced Linux discutida em 2026-10-14; este plano registra somente decisões aplicáveis ao OrdaX
- **Dependências:** Stable/MVP físico atual, release assinada/materializada, Creator, Independent Base quando exigida pelo candidato, boot/recovery/known-good, hardware matrix

`READY` não concede autorização para gravar disco interno. Este plano organiza trabalho que **já pertence ao ciclo do MVP**. O APPLY físico continua fail-closed até os contratos e gates canônicos permitirem a operação no alvo exato.

## Problema

O OrdaX já consegue ser tratado como sistema portátil pelo USB e o MVP canônico já inclui a instalação Native SSD/NVMe/HDD em seu ciclo. Entretanto, a release pública candidata ainda está efetivamente em modo USB-only e a capacidade destrutiva Native permanece desabilitada.

Para o produto final, a jornada precisa ser contínua:

```text
baixar/criar USB
 -> iniciar OrdaX sem alterar o computador
 -> experimentar o sistema
 -> escolher "Instalar OrdaX"
 -> selecionar conscientemente SSD/NVMe/HDD
 -> instalar a mesma release Stable verificada
 -> reiniciar sem USB
 -> first-boot health
 -> known-good/recovery
```

O objetivo não é criar outro instalador, outra distro ou uma segunda base. É **promover com segurança a infraestrutura Native que já existe**.

## Objetivo

Fechar o primeiro fluxo público seguro de **USB → instalação Native em disco inteiro**, tornando possível usar o OrdaX pelo USB e depois instalá-lo no computador sem terminal, Git, ISO manual ou particionamento manual.

A primeira disponibilidade Native continua deliberadamente menor que um instalador Linux genérico:

- disco inteiro somente;
- seleção explícita do alvo;
- aviso inequívoco de perda dos dados existentes no alvo;
- USB de origem nunca elegível;
- sem dual boot no primeiro release;
- sem redimensionamento automático de Windows/Linux;
- sem editor manual de partições;
- mesma família de release/Surface, sem fork USB vs Native.

## Não objetivos

- não adicionar Calamares, APT, Flatpak, Timeshift ou outro stack de distribuição apenas porque um sistema de referência os usa;
- não criar dual boot no MVP inicial;
- não preservar automaticamente instalações/dados preexistentes no disco-alvo;
- não reduzir ou contornar gates de confirmação física;
- não usar `/dev/sda`/`/dev/nvme0n1` sozinho como identidade do alvo;
- não transformar plano não destrutivo em autorização de escrita;
- não bloquear a primeira prova Stable USB apenas porque o Native ainda não foi promovido, salvo quando o owner canônico explicitamente alterar esse gate.

## Estado atual verificado

### Já implementado

- `MVP.md` inclui Native SSD/NVMe/HDD no ciclo integrado do MVP;
- `docs/NATIVE-INSTALLATION.md` define `usb` e `native-disk` como modos do mesmo produto;
- geometria Native em Creator Core;
- plano puro/não destrutivo de instalação;
- target enumeration e contrato de targets;
- target fingerprint/confirmation ligado a identidade estável, capacidade, path e flags;
- reenumeração antes de casar alvo confirmado;
- booted USB explicitamente inelegível como alvo;
- layout GPT + ESP FAT32 + LUKS2 + Btrfs/subvolumes;
- prova descartável de materialização de storage;
- userspace Native de BusyBox/cryptsetup/btrfs byte-locked/provado no recorte já documentado;
- kernel com pré-requisitos dm-crypt/AES-XTS/Btrfs já comprovados no recorte documentado;
- broker Native na Surface e wiring de target discovery existente;
- regras de release assinada, known-good e recovery já são requisito do caminho Native.

### Parcialmente implementado

- UX final da instalação existe em fundação/transport, mas não está promovida como jornada pública destrutiva;
- storage materialization foi provado em mídia descartável, não em instalação física pública;
- boot Native possui provas parciais/CI, mas não substitui boot físico do candidato promovido;
- hardware baseline existe, mas suporte público Native ainda precisa ser ligado a modelos/capabilities fisicamente comprovados.

### Ausente ou ainda não promovido

- autorização/APPLY destrutivo público no disco interno;
- materialização física end-to-end da release Stable autorizada no alvo real;
- instalação verificada de boot + recovery assets no disco real;
- readback estrutural pós-escrita no alvo físico;
- reboot físico sem USB do candidato atual;
- first-boot health Native e promoção known-good do candidato instalado;
- UX pública final de conclusão/remover USB/reiniciar;
- evidência de que o hardware anunciado para Native possui capacidades cotidianas mínimas exigidas pelo claim de suporte.

### Desconhecido/não provado genericamente

- suporte amplo a notebooks x86_64;
- Secure Boot público;
- AMD/NVIDIA acelerado;
- áudio, suspend/resume, Bluetooth, webcam e touchscreen fora dos modelos/capabilities que vierem a ser provados explicitamente.

## Decisões arquiteturais

### 1. USB e Native são o mesmo OrdaX

O sistema assinado é compartilhado. `product-mode` define o modo de execução; não existe fork permanente.

### 2. "Experimente antes de instalar" é requisito de produto

O USB deve continuar utilizável sem alterar o disco interno. A instalação só aparece/ativa quando o runtime/capability/policy do release permitem.

### 3. Native inicial é whole-disk

Primeiro release Native seguro vence um instalador geral. Dual boot, shrink e editor de partição exigem projeto/gates próprios.

### 4. Identidade de disco vence path

Toda confirmação destrutiva continua vinculada à identidade observada e é invalidada se o alvo mudar entre inspeção e execução.

### 5. Estado do OrdaX USB pode ser migrável, mas não é requisito para liberar APPLY

Após o caminho base estar comprovado, avaliar migração **somente de estado OrdaX autorizado** (preferências, workspace, dados do usuário compatíveis) do USB para Native. Isso nunca significa preservar dados anteriores existentes no disco-alvo e não deve atrasar o primeiro APPLY seguro se exigir uma arquitetura adicional.

### 6. Hardware cotidiano passa a importar para o claim Native

Um primeiro proof USB pode existir com escopo de hardware estreito. Já um notebook publicamente declarado como suportado para OrdaX Native precisa de experiência cotidiana coerente.

Para cada modelo oficialmente anunciado, classificar explicitamente:

- gráfico/Surface;
- teclado/ponteiro;
- rede/Wi-Fi;
- **áudio**;
- **suspend/resume**, quando o produto for notebook e esse comportamento fizer parte do claim de uso normal;
- bateria/power quando aplicável.

Capacidades não provadas permanecem declaradas como não suportadas/não homologadas, nunca inferidas pela mera presença de driver.

## Caminhos/owners afetados

Revalidar antes de qualquer execução:

- `MVP.md`;
- `docs/NATIVE-INSTALLATION.md`;
- `docs/CURRENT-STATE.md`;
- `docs/PROMOTION-GATES.md`;
- `docs/contracts/native-installation.json`;
- `docs/contracts/distribution-profiles.json`;
- `docs/contracts/hardware-support-matrix.json`;
- `docs/contracts/storage-architecture.json`;
- Creator Core/adapters Native existentes;
- Surface Native install broker existente;
- bootstrap/initramfs/boot/recovery owners somente quando um gate Native real exigir mudança.

Não criar outro `native-installer` paralelo nem novo storage owner.

## Fases

### Fase 0 — revalidar o candidato e os gates correntes

- ler `CURRENT-STATE`, `PROMOTION-GATES`, contracts e evidências do head atual;
- separar o que já está PASS do que ainda é físico/pendente;
- confirmar que nenhuma mudança concorrente tornou documentos deste plano stale;
- obter autorização física somente pelo mecanismo canônico.

**Gate N0:** mapa factual exato; nenhuma escrita foi liberada por documentação.

### Fase 1 — fechar APPLY em alvo descartável/controlado

- implementar/conectar somente o writer que faltar usando o plano/target identity existentes;
- criar GPT/ESP/LUKS2/Btrfs conforme SSOT;
- materializar release Stable verificada;
- instalar boot/recovery assets verificados;
- readback completo e receipts/evidence;
- fail closed em qualquer mismatch.

**Gate N1:** APPLY destrutivo provado em alvo explicitamente autorizado sem path ambiguity nem source-device risk.

### Fase 2 — boot Native físico

- boot UEFI sem USB;
- unlock/mount/handoff;
- Surface/OOBE/estado esperado;
- first-boot health;
- known-good;
- recovery/rollback.

**Gate N2:** instalação física completa é bootável e recuperável no alvo exato.

### Fase 3 — UX de produto USB → Native

- ação `Instalar OrdaX` somente quando capability real estiver disponível;
- listar alvos elegíveis com fabricante/modelo/capacidade/identidade útil ao usuário;
- exibir consequência de apagar disco inteiro;
- confirmação forte ligada ao target token/fingerprint;
- progresso com etapas reais, sem porcentagem fictícia;
- conclusão + instrução de reboot/remover USB;
- falha deve preservar o USB operacional e explicar recovery/retry seguro.

**Gate N3:** usuário consegue completar toda a jornada sem terminal e sem ambiguidades sobre o disco apagado.

### Fase 4 — suporte cotidiano mínimo do hardware anunciado

- executar matriz física por modelo suportado;
- áudio real quando necessário ao claim de desktop/notebook;
- suspend/resume real quando necessário ao claim do notebook;
- bateria/power e networking coerentes;
- nenhum claim por família apenas porque módulo existe.

**Gate N4:** documentação pública pode dizer exatamente quais modelos/capabilities são suportados sem generalização indevida.

### Fase 5 — migração opcional do estado do próprio OrdaX USB

Somente depois de N1–N4:

- inventariar quais dados são portáveis;
- nunca copiar secrets/authority implicitamente;
- permitir opt-in;
- validar espaço e integridade;
- rollback/falha não pode corromper fonte USB.

**Gate N5:** migração é conveniência segura, não parte do writer crítico.

## Gates de aceite

1. USB de origem nunca é target;
2. target confirmation continua identity-bound e revalidada imediatamente antes do APPLY;
3. whole-disk erase é explícito;
4. release e boot assets são verificados antes/depois da escrita;
5. boot sem USB passa no hardware autorizado;
6. first-boot health e known-good passam;
7. recovery é provado;
8. falha não transforma um disco parcialmente escrito em sucesso;
9. UI nunca anuncia Native disponível quando contracts/policy dizem `false`;
10. suporte de hardware é anunciado somente dentro da matriz fisicamente comprovada.

## Segurança/privacidade

- destructive authorization nunca entra em logs/export de diagnóstico;
- nenhum identificador instável isolado autoriza disco;
- segredo de LUKS nunca é materializado em Git/evidence;
- state migration, se houver, é opt-in e separada do install authority;
- recovery keys/custody seguem owner específico;
- instalação offline continua possível quando a release autorizada já está presente.

## Custos/limites

Nenhum serviço pago é requisito arquitetural desta frente. O custo principal é prova física/hardware de teste. Expandir matriz de hardware exige orçamento e inventário próprios, não dependência de cloud/VPS.

## Testes/evidências

- unit/contracts de target identity e confirmation invalidation;
- disposable raw-disk APPLY;
- fault injection entre todas as etapas destrutivas;
- readback GPT/ESP/LUKS2/Btrfs;
- assinatura/hash/release mismatch negatives;
- source USB exclusion;
- QEMU apenas como complemento;
- physical boot sem USB;
- cold boot/reboot/recovery;
- áudio/suspend/resume por modelo quando integrantes do claim;
- Surface smoke Native;
- power-loss/failure recovery quando o gate correspondente exigir.

## Rollback/degradação

- se Native não estiver promovido, USB continua sendo o modo público disponível;
- falha do instalador não reduz funcionalidade do USB;
- release não saudável não vira known-good;
- falha de hardware/capability reduz o claim de suporte do modelo em vez de gerar workaround silencioso;
- nunca habilitar dual boot como fallback improvisado.

## Relação com outros planos

- `HARDWARE-001`: evolução ampla de hardware packs/Drivers; NATIVE-001 só exige o subconjunto necessário para os modelos Native oficialmente suportados.
- `DESKTOP-001`: UX cotidiana pós-fechamento; não bloqueia APPLY salvo feature explicitamente exigida pelo owner canônico.
- `MODE-001`: Web/Cloud/Device não bloqueia a instalação Native e permanece uma frente separada.
- `SURFACE-001`: Surface compartilhada e apps continuam em seus owners; este plano só adiciona a jornada de instalação e seus states reais.

## Próxima ação documental

Manter este plano alinhado a `MVP.md`, `NATIVE-INSTALLATION.md`, `CURRENT-STATE` e contratos. Se algum gate Native for fechado, a mudança factual deve ser registrada primeiro no owner canônico e depois refletida aqui/Registry/Roadmap.

## Próxima ação de execução

**EXECUTION-ELIGIBLE apenas no recorte já exigido pelos owners canônicos do MVP.**

O próximo chat deve começar pela Fase 0. Não deve escrever em disco interno até o gate/consentimento corrente autorizar explicitamente o alvo e o candidato.

## Handoff para outro chat/agente

Ao retomar:

1. ler `AGENTS.md`, este plano, `MVP.md`, `docs/NATIVE-INSTALLATION.md`, `docs/CURRENT-STATE.md` e `docs/PROMOTION-GATES.md`;
2. ler os contracts Native/distribution/storage/hardware atuais;
3. verificar a `main` e trabalho concorrente antes de assumir qualquer status deste documento;
4. **não criar Calamares nem instalador paralelo**;
5. continuar do Creator Core/targets/broker já existentes;
6. preservar whole-disk-only na primeira promoção;
7. nunca relaxar `native_install_capability_enabled=false` ou `internal_disk_destructive_write_allowed=false` por UI/teste; alterar somente via promoção técnica canônica;
8. distinguir prova QEMU/disposable de prova física;
9. considerar áudio/suspend/resume como parte do claim por hardware, não como suporte genérico implícito;
10. ao fechar um gate, atualizar owner factual + evidência + Registry/Roadmap, e não usar este plano como changelog substituto.
