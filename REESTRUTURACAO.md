# REESTRUTURACAO — Kernel, Base e Identidade do OrdaX OS

> **Status:** PROPOSTA ARQUITETURAL / PLANO DE AUDITORIA — NÃO IMPLEMENTADO  
> **Criado em:** 2026-10-20  
> **Repositório:** `ordaxsystems/ordax-os`  
> **Escopo:** kernel Linux como dependência técnica controlada; OrdaX como sistema/produto independente; boot, contratos, atualização, identidade GPT e recuperação.  
> **Execução:** NÃO AUTORIZADA automaticamente por este arquivo. Reconciliar com `MVP.md`, `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md`, `00-PLANOS-PRIORITARIOS/ROADMAP.md` e owners vigentes.

## 0. Resumo executivo e decisão recomendada

**Desacoplar logicamente o kernel é benéfico; criar partição exclusiva para o kernel ou abstração universal de todos os syscalls não é justificado.**

O kernel Linux permanece uma implementação de infraestrutura. OrdaX controla seus produtos, ciclo de vida, serviços, contratos, experiência, empacotamento, atualizações e recuperação. O objetivo não é trocar de kernel, reescrever drivers ou ocultar o uso do Linux. O objetivo é **controlar explicitamente o acoplamento**, assegurar atualizações verificáveis e preservar identidade OrdaX.

A exibição de **“Sistema Linux” no Windows** é provavelmente uma classificação do tipo GPT, não uma prova de que existe uma distribuição Linux inteira instalada. Nome de partição GPT, rótulo de filesystem, tipo GPT e identidade de produto são conceitos diferentes. Renomear não garante que ferramentas externas deixem de exibir “Linux filesystem”. O identificador GPT Linux atual deve ser preservado até testes documentados de compatibilidade; não trocar GUID apenas por aparência.

**Resultado desejado:** uma única fonte canônica, kernel + módulos + initramfs + rootfs compatíveis, release e recuperação atômicas para o que for crítico; mudanças comuns de `system/` sem reconstrução desnecessária de kernel; identidade visível OrdaX nas superfícies sob nosso controle.

## 1. Estado conhecido e limites desta proposta

Verificado na documentação do repositório em 2026-10-20:

- `README.md`: `main` é autoridade; `boot/`, `bootstrap/kernel/`, `bootstrap/initramfs/`, `system/` e `tools/creator/` já têm responsabilidades distintas; kernel/initramfs são artefatos do pipeline.
- `docs/ARCHITECTURE.md`: Dev Git-first pode atualizar `system/` sem regravar USB; Base/kernel são candidatos de commit exato ativados no próximo boot; rootfs/módulos requerem acoplamento compatível; fallback conhecido é obrigatório.
- `docs/PHYSICAL-MEDIA.md`: seed de duas partições (`ORDAX-ESP` + `ORDAX`), USB de prova de três (`ORDAX-ESP` + `ORDAX` + `ORDAX-DATA`) e alvo portátil futuro de duas partições (`ORDAX-ESP` + `ORDAX-DATA`, imagens versionadas EROFS e estado ext4 em arquivo). **Não fixar o layout transitório como contrato permanente.**
- `docs/RELEASE-CHANNEL.md`: Stable consome releases assinadas/verificadas, não `git pull` operacional do usuário.
- `MVP.md`: baseline de lançamento, capacidades iniciadas, gates independentes; documentação não autoriza promoção física nem alteração do escopo.
- `00-PLANOS-PRIORITARIOS/README.md`: planos não são autoridade executável; verificar registro e evitar segunda frente paralela.

**Não comprovado por esta elaboração documental:** conteúdo efetivo do pendrive conectado, saúde de ext4, localização física atual de todos os binários, estado de boot em hardware, implementação completa de rollback, integração do Creator ou histórico de testes físico. Nenhum desses itens deve ser declarado PASS com base neste plano.

## 2. Definições e fronteiras

| Termo | Definição arquitetural | Não significa |
|---|---|---|
| Kernel provider | Linux, configuração, módulos e interfaces que OrdaX efetivamente utiliza | Sistema operacional inteiro de terceiros |
| Bootstrap/boot | UEFI/bootloader, kernel, initramfs, montagem inicial, verificação e recuperação | Interface do usuário |
| OrdaX Base | Dependências mínimas necessárias ao runtime, empacotadas e versionadas com compatibilidade explícita | Distribuição Linux genérica |
| OrdaX Core | Native, agentes/serviços, capacidades, lifecycle, autorização e políticas, de acordo com owners atuais | Nova camada monolítica que duplica serviços |
| OrdaX Surface/Apps | Interface e apps, dependentes de contratos de capacidade | Acesso direto indiscriminado ao `/proc`, `/sys` ou comandos host |
| Kernel contract | Manifesto compatibilidade + pequenos ports/adapters nas fronteiras realmente necessárias | HAL universal ou promessa de troca livre de kernel |
| GPT type | GUID de finalidade da partição reconhecido pelas ferramentas | Nome comercial do OS |
| GPT name / FS label | Nome humanizado / label dentro do sistema de arquivos | Substituto do tipo GPT |

### Invariantes não negociáveis

1. Linux deve ser reconhecido honestamente como kernel; não mascarar tecnicamente dependências.
2. `main` e owners/contratos canônicos continuam SSOT; USB é materialização, não autoridade.
3. Não criar novas partições antes de comprovar benefício concreto e compatibilidade com os perfis de armazenamento.
4. Nunca substituir o kernel em execução; preparar artefatos verificados e ativar somente em boot posterior.
5. Kernel, módulos, initramfs, firmware necessário, rootfs e boot selector têm compatibilidade explícita. Atualizações independentes são **por ciclo de desenvolvimento**, não independência irrestrita de execução.
6. Dev pode operar Git-first; Stable somente release verificada/assinada.
7. A/B ou rollback transacional nas partes críticas; falhar fechado e manter último conjunto inicializável.
8. Não substituir bibliotecas e interfaces POSIX/Linux por wrappers artificiais sem evidência de ganho.
9. Sem duplicar identity, permissions, network, storage, power ou update owners.
10. Sem escrita em USB/SSD/HD/NVMe, reparticionamento ou alteração de GPT sem gate físico e autorização própria.

## 3. Desenho alvo por responsabilidades

```text
OrdaX OS — produto e identidade
  Surface + Apps + Spaces + Intelligence
           |
OrdaX Core / Native / serviços canônicos
           |
OrdaX capability ports (APENAS onde precisam de isolamento)
   power, battery, network, storage, device metadata,
   boot health, update/recovery, session permissions
           |
Linux adapters / implementations do host
           |
Kernel provider + drivers + módulos + interfaces Linux
           |
Boot chain UEFI -> loader -> kernel/initramfs -> rootfs
           |
Hardware
```

**Regra pragmática:** usar abstração para comportamento de alto nível ou dependência de plataforma; Linux ABI/POSIX estável pode ser usado diretamente no componente que legitimamente pertence à plataforma. Não criar uma camada de proxy para `read()`, `write()`, `mmap()`, sockets ou cada syscall.

### Contratos a auditar/estender (não criar owners paralelos)

- **Kernel/Base compatibility**: versions, artifact digests, ABI mínima, `uname -r`, módulos e firmware empacotados, initramfs e rootfs da mesma candidata compatível.
- **Boot/recovery contract**: estado pending/armed/booted/healthy/committed/rolled-back; critérios de timeout; rollback sem acesso à rede.
- **System capability contract**: contratos de API já usados por Native/Surface para rede, energia, armazenamento; adicionar apenas lacunas reais.
- **Update contract**: algoritmo de seleção e promoção por source commit exato, provenance, assinatura adequada ao canal e ativação atômica.
- **Product identity contract**: `OrdaX OS` como apresentação; nomes `ORDAX-ESP`, `ORDAX`/`ORDAX-SYSTEM` quando seguro e `ORDAX-DATA`; detecção técnica de GPT não é tratada como branding.
- **Media profile contract**: geometria transitória versus alvo USB portátil e Native instalável; jamais promover uma pela outra sem migração/gates.

Preferir adicionar campos aos manifests existentes quando seus schemas permitirem. Só propor `kernel-base-compatibility.json` se a auditoria comprovar inexistência de owner equivalente.

## 4. Análise do Windows e decisão sobre partição

O relatório anterior do pendrive informado pelo usuário era: GPT 8,05 GB; EFI 268 MB FAT32; “Sistema Linux” 6,71 GB; `ORDAX-DATA` 1,07 GB exFAT. É **observação reportada**, não releitura recente do USB.

Antes de qualquer modificação, registrar em leitura apenas: device identity, serial quando permitido, tabela GPT completa com GUID de tipo e partition name, filesystem UUID/label, estrutura de ESP, bootloader/entradas, manifest de imagem, rootfs, `uname` dentro do boot e versão do kernel pelo próprio arquivo.

Classificação:
- Se o Windows exibe tipo Linux genérico, **não é uma dependência do Windows**, nem demonstra que OrdaX seja uma distribuição Linux.
- A etiqueta ideal no Creator e nas ferramentas OrdaX é `OrdaX OS / ORDAX-SYSTEM`.
- Não adotar GUID específico OrdaX sem análise de automount, ferramentas de imagem/recuperação, Linux GPT discoverability, Creator, Windows, recovery, boot e usuários existentes.
- **Não criar partição adicional para kernel.** A ESP pode armazenar loader e assets de boot conforme orçamento de espaço e estratégia adotada; confirmar espaço livre e tamanho de candidatos A/B antes de assumi-lo. Se a estratégia final precisar de volume separado, produzir ADR com provas e migração reversível.

## 5. Plano de execução por etapas (todas com evidência e gates)

### Fase 0 — inventário factual / baseline imutável
- Mapear caminhos de kernel, config, patches, initramfs, módulos, firmware, rootfs, ESP, Creator, Supervisor/Pull, release e recovery.
- Construir grafo de dependências real e diferenciar design declarado versus código/testes efetivos.
- Inspecionar contratos existentes antes de propor novos schemas.
- Fotografar estado de CI e builds por commit; enumerar diferenças Dev vs Stable.
- Capturar mídia física em **somente leitura**, quando estiver detectável, sem selecionar disco por índice fixo.
- **Entrega:** matriz `Componente | Owner | Local | Entradas | Saídas | Dependências | Prova | Lacuna`.
- **Gate G0:** nenhuma suposição de local ou dependência sem evidência de repositório/artefato.

### Fase 1 — decisão arquitetural, ADR e contratos
- Definir fronteiras Kernel/Base, Bootstrap, Native e Surface a partir dos owners atuais.
- Classificar dependências: Linux API estável, kernel-internal, appliance/driver, serviço OrdaX, UI.
- Definir interface pequena para capacidades com razão demonstrável para isolamento.
- Definir manifesto de compatibilidade imutável amarrado a commit + digests.
- Projetar health e rollback com pares boot/kernel/rootfs compatíveis.
- **Entrega:** ADR explícita no owner existente e alterações propostas em manifests canônicos; não promover este plano em lugar da ADR.
- **Gate G1:** sem duplicação de owner; compatibilidade tratada como conjunto, não `kernel_version` isolado.

### Fase 2 — pipeline reprodutível e versionamento
- Reproduzir build do kernel e initramfs de fonte/config/toolchain fixados; registrar provenance e SHA-256.
- Criar/verificar bundles de kernel + módulos + rootfs/firmware compatíveis; validar espaço da ESP.
- Incremental build: edições de Surface/Apps não disparam rebuild do kernel sem motivo.
- Dev Git-first: candidata Base por commit exato; Stable: envelope assinado, sem Git do usuário.
- **Gate G2:** rebuild determinístico verificável, hashes/proveniência, matrizes de compatibilidade e rejeição de mismatch.

### Fase 3 — fronteiras e redução de acoplamento
- Levantar usos diretos de `/proc`, `/sys`, `/dev`, `systemctl`, comandos específicos e chamadas ao host por `system/`.
- Migrar **somente** os acessos que vazam detalhes do provider para serviços, mantendo os caminhos já canônicos.
- Não introduzir dependência remota para o bootstrap offline; falhas de módulo não podem bloquear o boot.
- **Gate G3:** testes de contrato, ausência de comportamento duplicado, sem latência/regressão perceptível desnecessária.

### Fase 4 — ativação transacional, rollback e power loss
- Testar staging isolado, verificação, boot selector, known-good, confirmação de saúde e rollback.
- Simular queda de rede, disco cheio, download parcial, módulo ausente, rootfs incompatível, falha de energia, hardware sem driver, boot fail e múltiplas reinicializações.
- Garantir que rollback recupera kernel + módulos + rootfs e flags de estado de forma consistente.
- **Gate G4:** nenhuma candidata ruim é promovida; conhecido-bom recupera offline; nenhuma perda de dados persistentes.

### Fase 5 — identidade e mídia, sem cosmética arriscada
- Uniformizar branding OrdaX em UI, Creator, diagnósticos, metadata de release e rótulos seguros.
- Avaliar mudança de partition name/label só se não exigir migração destrutiva nem quebrar discovery por UUID/GUID.
- Manter tipo GPT Linux se sua alteração não trouxer ganho funcional comprovado.
- Conciliar perfis: USB transitório 3 partições; USB final por contrato de imagens EROFS em exFAT; Native por contrato específico. **Não alterar layout durante investigação de kernel.**
- **Gate G5:** boot e recovery passam com nomes antigos e novos; rollback de migração documentado.

### Fase 6 — homologação e promoção independente
- CI: testes de manifest, compatibilidade, kernel modules, bootloader, materialização de build e regressão Native.
- VM/QEMU com cold boot, reboot, desconexão de rede e rollback; não equiparar VM a hardware real.
- USB real: validação de identidade física do target, leitura pós-gravação, primeiro boot, rede, conta, Pull, poweroff ACPI e atualização real em hardware.
- Dev e Stable têm critérios de promoção separados; Stable exige assinatura e trust anchor reais.
- Publicar resultado por teste: `PASS`, `FAIL`, `BLOCKED`, commit, dispositivo, log, artefato e data.
- **Gate G6:** nenhum PASS por inferência; sem escrita física sem autorização expressa do gate correspondente.

## 6. Testes obrigatórios e critérios de aceite

1. **Identidade:** firmware inicia OrdaX sem Windows; OrdaX exibe marca própria; ferramentas Windows podem continuar mostrando tipo GPT Linux sem que isso seja classificado como regressão.
2. **Incrementalidade:** mudar `system/surface` não exige rebuild de kernel; mudar kernel exige ciclo Base.
3. **Compatibilidade:** módulo kernel de versão incompatível é rejeitado antes de ativar; rollback restaura todos os elementos do conjunto.
4. **Offline:** boot conhecido-bom, login local permitido quando suportado e recovery não dependem de cloud/Windows.
5. **Atualização:** falhas de energia/rede/arquivo não corrompem o estado; nenhum merge in-place na árvore ativa do Dev.
6. **Segurança:** signatures e hashes do canal certo; sem chaves privadas na mídia; sem atalhos de autenticidade.
7. **Armazenamento:** não recria `ORDAX-HOME`; dados persistentes sobrevivem a atualização e rollback; exFAT não vira upperdir Linux nativo.
8. **Hardware:** Wi-Fi, relógio, bateria, arquivos, navegação e botão de energia são validados quando presentes no target e no escopo da release.
9. **Densidade:** medir bytes extras em ESP, boot time, RAM, espaço livre, número de serviços/processos e overhead das novas interfaces; abortar complexidade que não gere benefício.
10. **Reprodutibilidade:** outro desenvolvedor/IA consegue reproduzir a partir de `main` + instruções verificadas, sem host Windows ou sessão de ChatGPT como pré-requisito do produto.

## 7. Riscos, antipatrones e mitigação

| Risco | Mitigação / rejeição |
|---|---|
| HAL universal “agnóstico” vira reimplementação de Linux | Só introduzir portas onde houver dependência real de plataforma e teste de valor |
| Kernel e módulos atualizados separadamente sem compatibilidade | Bundle acoplado, hash, test matrix e rollback conjunto |
| ESP pequena para múltiplos kernels | Medição prévia; não ampliar partição sem ADR e migração física segura |
| GUID GPT cosmético interrompe boot/montagem | Preservar tipo enquanto não houver prova funcional |
| Segunda fonte de verdade para Pull ou Native | Auditar owner e estender serviço existente |
| Confundir armazenamento transitório com target final | Contratos de perfil separados, migração apenas após gate |
| Documentação declarada como feature concluída | Estado `PROPOSTO` até testes/logs de produto e hardware |
| Desviarmos do baseline de lançamento | Execução vinculada a gate/owner existente; roadmap decide janela |

## 8. Sequência operacional para um próximo chat/agente

1. Ler `AGENTS.md`, `README.md`, `MVP.md`, `docs/README.md`, `docs/CURRENT-STATE.md`, `docs/ARCHITECTURE.md`, `docs/PHYSICAL-MEDIA.md`, `docs/STORAGE-ARCHITECTURE.md`, `docs/RELEASE-CHANNEL.md`, `docs/PROMOTION-GATES.md`, `00-PLANOS-PRIORITARIOS/{README,ROADMAP,REGISTRY}.md`.
2. Comparar este plano com o código e os contratos machine-readable correntes; registrar conflitos sem substituir owners.
3. Executar Fase 0 read-only e produzir matriz de evidências e ADR proposta.
4. Integrar esta frente ao registro/roadmap **existente** se não houver item equivalente; não criar roteador, registry ou owner paralelo.
5. Abrir implementação somente após gate de elegibilidade; trabalhar com PR coesa, CI e logs; atualização física é gate separado.
6. Ao concluir etapas, atualizar o `docs/CURRENT-STATE.md`, manifests e evidências reais; não marcar plano DONE por documentação apenas.

## 9. Decisões que ficam pendentes de evidência

- Se o acoplamento atual ultrapassa interfaces Linux estáveis e onde os adapters já existem.
- Se é necessário contrato novo ou apenas revisar manifesto existente.
- Qual bootloader/ESP budget/candidata A/B realmente são usados na imagem física atual.
- Se nomes GPT/labels precisam de alteração ou se apenas a UI de diagnóstico do Creator deve mostrar OrdaX.
- Cronograma para migração ao layout USB portátil final; **não acoplar essa migração à separação lógica do kernel**.

## 10. Definição de concluído

O desacoplamento será considerado **comprovado** quando: (a) contratos e owners reais explicarem a dependência Linux; (b) atualizações independentes de Surface e Base funcionarem como projetado; (c) kernel/módulos/rootfs não puderem divergir silenciosamente; (d) boot, recuperação offline e rollback forem demonstrados em hardware; (e) identidade OrdaX for consistente nas ferramentas que controlamos; (f) nenhuma nova dependência de Windows, serviço remoto ou regravação desnecessária tiver sido introduzida.

**Não confundir:** kernel em partição distinta ≠ desacoplamento; rótulo “Sistema Linux” ≠ dependência do Windows; plano escrito ≠ refatoração concluída.


---

## 11. Fase 0 — primeira auditoria de código (2026-10-20)

**Estado: AUDITORIA PARCIAL (código/contratos, sem execução de testes ou prova física).** Este registro complementa o plano, não substitui `docs/CURRENT-STATE.md`.

### Evidências inspecionadas

| Componente | Owner/arquivo concreto | Evidência | Interpretação | Pendência |
|---|---|---|---|---|
| Origem do kernel | `bootstrap/kernel/source.json` | Linux 6.6.158, SHA-256 e assinatura upstream, config OrdaX, builder canônico; `physical_artifact_authorized=false` | Kernel é componente versionado e autenticado, não projeto de kernel novo | Auditar pipeline de integração e artefatos reais |
| Build/proveniência | `bootstrap/kernel/PROVENANCE.md`, `docs/contracts/kernel-build-environment.json` | Compilação fixada, prova histórica de repetição e digests; prova não equivale a aprovação física | Já há separação de identidade do código e de build | Validar gates frente ao commit final e módulos atuais |
| Dependências Base Dev | `bootstrap/base/alpine_core.py` | Alpine minirootfs 3.22.5 + Git, kmod, rede e firmware, kernel version lido de `source.json` | OrdaX **não contém apenas Linux kernel**; incorpora userland Alpine no bootstrap Dev | Inventariar licenças, ABI, SBOM, superfície de atualização e dependências reais |
| Pull Dev | `bootstrap/dev-base/ordax-pull` | Worktree Git `/workspace/ordax`, state e lock, staging/transaction, commit pins | Ciclo de aplicações separado do kernel | Provar failover/atomicidade em boot e dispositivos |
| Ativação Base | `bootstrap/base-update/activate.py` | valida candidata `vmlinuz`/`initrd.gz` em slot; escreve somente `LoaderEntryOneShot`; protege entradas normal/recovery | Há isolamento de boot transacional planejado no código | Comprovar boot/health/rollback no hardware |
| Mídia preparada | `docs/contracts/physical-prepared-media.json` | Partição 2 `ORDAX`, tipo GPT Linux filesystem, ext4; sistema de três partições transitório | Explica o rótulo “Sistema Linux” em ferramentas que descrevem o GPT type | Não trocar GUID só para renomear |
| Armazenamento futuro | `docs/contracts/storage-architecture.json`, `docs/PHYSICAL-MEDIA.md` | USB final planejado em duas partições com EROFS e imagem ext4 para estado | Uma quarta partição contrariaria direção de armazenamento existente | Executar gates de migração/storage sem vinculá-los ao kernel |

### Constatações e prioridades

**F0-01 — Ponto já resolvido por design:** kernel e runtime são distintos nos owners, e o Pull comum não precisa necessariamente recompilar kernel. **Ação:** preservar fronteira; testar regressões em vez de substituí-la.

**F0-02 — Dependência legada em retirada, não arquitetura alvo:** `bootstrap/base/alpine_core.py` ainda fornece userland baseado em Alpine nos perfis atuais, mas **a decisão de produto é remover Alpine**. A migração já tem owner em `bootstrap/independent-base/` (Buildroot + BusyBox + musl), sem Alpine/APK no novo perfil. **Ação:** medir paridade funcional, fechamento de dependências e compatibilidade do substituto; não propor manutenção do Alpine como componente futuro nem começar outro pipeline concorrente. Preservar legado somente durante transição com gates de boot/recovery e segurança.

**F0-03 — Branding versus metadata:** GPT type Linux filesystem é a causa estrutural provável da classificação no Windows; o contrato já define o partition name e filesystem label `ORDAX`. **Ação:** manter GUID compatível; apresentar “OrdaX OS” no Creator, nos relatórios e interfaces proprietárias. Testar sem alegar que o Windows mudará sua classificação.

**F0-04 — Potencial risco Base/Kernel:** candidatos de `vmlinuz`, `initrd`, módulos, firmware e rootfs precisam passar por conjunto compatível. **Ação:** provar explicitamente a matriz de identidades e a rejeição de incompatibilidade, sem abrir contrato paralelo até auditar manifests existentes.

**F0-05 — Espaço físico:** ESP transitória de 256 MiB (268435456 bytes) versus ESP alvo portátil de pelo menos 512 MiB já prevista. **Ação:** medir ocupação e tolerância de candidatos sem modificar partições.

**F0-06 — Recovery incompleto como prova física:** o mecanismo de ativação preserva entradas, mas isso não prova rollback em falha real de energia ou boot. **Ação:** baterias de testes QEMU, depois prova física autorizada.

### Decisão atual

`KERNEL_LOGICAL_DECOUPLING=PARTIALLY_PRESENT`  
`NEW_KERNEL_PARTITION=NOT_RECOMMENDED`  
`GPT_TYPE_COSMETIC_CHANGE=NOT_RECOMMENDED`  
`ALPINE_DEV_USERLAND_DEPENDENCY=LEGACY_PENDING_REMOVAL`  
`KERNEL_RUNTIME_PHYSICAL_COMPATIBILITY=UNVERIFIED`  
`USB_MUTATION_PERFORMED=NO`

### Próximo corte da Fase 0

1. Ler e cruzar `bootstrap/initramfs/build.py`, `bootstrap/base-update/`, `bootstrap/recovery/`, `system/composition/`, `tools/creator/`, `docs/contracts/{portable-usb-v2,portable-release-image,portable-boot-handoff}.json`.
2. Mapear scripts que dependem diretamente de Alpine/Linux versus código OrdaX, com tabela de dependência por arquivo e contrato.
3. Auditar verificação automática de correspondência exata de kernel ABI e módulos/rootfs em candidate staging.
4. Entregar um relatório `PASS/FAIL/BLOCKED` de source e CI; não chamar isso de homologação física.
5. Solicitar alteração de owner ou ADR **apenas** para falhas comprovadas; evitar refatoração cosmética.


## 12. Correção de escopo — retirada do Alpine (2026-10-20)

**Decisão de produto confirmada:** Alpine não pertence à arquitetura alvo do OrdaX. Toda referência anterior a Alpine neste plano documenta **estado legado transitório**, não uma recomendação para mantê-lo. A Fase 0 deve avaliar **a remoção segura do Alpine**, não sua preservação como dependência futura.

### Owner existente — não duplicar

- `bootstrap/independent-base/README.md`: experimento Buildroot 2026.08 produz BusyBox + musl sem Alpine, APK e minirootfs Alpine.
- `bootstrap/independent-base/PHASE2.md`: caminho portátil reutiliza PID1, handoff, EROFS/ext4/OverlayFS, assinaturas e seletor canônicos; provas QEMU documentadas, mas não equivalência plena de hardware/serviços.
- `bootstrap/independent-base/source.json`: `experimental-not-promotable`, `candidate_only=true`, `physical_artifact_authorized=false`, `stable_channel_authorized=false`.
- Referência de acompanhamento: issue #1730 (mencionada pelo README da base independente). Verificar status corrente antes de agir.

### Arquitetura alvo revisada

```text
OrdaX Surface / Apps / Spaces / Intelligence
                    |
         OrdaX Core / Native
                    |
        Serviços e ports canônicos
                    |
         OrdaX Independent Base
          (Buildroot como builder)
       BusyBox / musl + dependências
       explícitas, mínimas, verificadas
                    |
      Kernel Linux + módulos/firmware
                    |
                  UEFI
```

Buildroot é ferramenta de construção, não nome ou identidade do sistema final. A utilização de BusyBox, musl e outras bibliotecas de terceiros continua sendo uma dependência normal e deve ser listada por SBOM/licenças. **Independência não exige reescrever libc e todos os utilitários.**

### Regras corrigidas para fases seguintes

1. **Não investir em novo acoplamento Alpine/APK**; alterações na base legada somente para segurança, operação e paridade necessária até migração.
2. **Não substituir Stable ou Dev imediatamente**: concluir primeiro paridade de rede/Wi-Fi/firmware, boot real, serviços Native/Surface, aplicativos, assinaturas, persistência e rollback.
3. **Não criar pipeline alternativo:** reutilizar `bootstrap/independent-base` e owners existentes de kernel, initramfs, base-update e release.
4. Construir matriz de equivalência feature-by-feature entre imagem legada e candidata independente e evidenciar `PASS/FAIL/BLOCKED`.
5. Criar gate de ausência de Alpine na **imagem final promovida**: sem `apk`, índices/repositórios APK, bibliotecas/metadados Alpine, serviços ou hardcoded paths Alpine. Cuidado com falso positivo em documentação/proveniência histórica ou ferramentas não embarcadas.
6. Separar elegibilidade Dev e Stable. Só eliminar componentes legados após a nova base demonstrar os fluxos do canal correspondente.
7. Preservar a independência de boot em relação ao Windows e serviços remotos.
8. A substituição de Alpine **não requer partição exclusiva para kernel**, novo tipo GPT ou alteração de layout.

**Estado correto:** `ALPINE_TARGET_ARCHITECTURE=NO`, `INDEPENDENT_BASE_EXISTS=YES_EXPERIMENTAL`, `ALPINE_REMOVAL_COMPLETE=NO`, `PHYSICAL_VALIDATION=BLOCKED`.

### Próximo gate prioritário

Confrontar `bootstrap/independent-base` com `bootstrap/stable-base`, `bootstrap/dev-base`, `bootstrap/surface-runtime` e suas dependências APK. Provar ausência de regressões no runtime real antes de alterar o canal por padrão. Não ampliar o plano para reimplementar Linux nem criar abstração universal sem justificativa.
