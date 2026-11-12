# HARDWARE-001 — Hardware, Drivers e Hardware Packs

- **Tipo:** PLAN / PRODUCT CAPABILITY
- **Status documental:** READY
- **Elegibilidade de execução:** DEFERRED FOR EXECUTION, exceto quando um subconjunto já for exigido por `NATIVE-001`/owners canônicos do MVP
- **Prioridade:** P1
- **Criado:** 2026-10-14
- **Atualizado:** 2026-10-14
- **Owner canônico:** `docs/contracts/hardware-support-matrix.json`, contratos de hardware-pack/component-slot, owners de update/known-good/rollback e Surface/System
- **Base factual:** `main` em 2026-10-14; hardware matrix e runtime/update contracts correntes
- **Relatórios de apoio:** comparação de experiência cotidiana com Spaced Linux em 2026-10-14
- **Dependências:** NATIVE-001 para claims mínimos do MVP; signed component channel; kernel ABI identity; hardware discovery; recovery/rollback

## Problema

O OrdaX já possui política de suporte de hardware explícita e uma estratégia de expansão por **hardware packs assinados**, com correspondência exata de modalias/kernel ABI, component slot e rollback. Porém essa fundação ainda não é uma experiência de produto completa equivalente a um painel moderno de Hardware & Drivers.

Não devemos copiar um gerenciador de pacotes de outra distribuição. Devemos evoluir a arquitetura que já existe até o usuário conseguir entender seu hardware, instalar apenas o suporte compatível e recuperar automaticamente de uma ativação ruim.

## Objetivo

Criar a experiência canônica:

```text
Sistema > Hardware
 -> visão geral real
 -> capability/support status
 -> driver/hardware pack compatível
 -> assinatura + ABI + modalias verificados
 -> staging
 -> reboot quando necessário
 -> health
 -> promote ou rollback
```

## Não objetivos

- não adicionar APT/DKMS como arquitetura do OrdaX;
- não instalar driver por nome de fabricante sem exact-match;
- não declarar uma família inteira suportada porque um módulo existe;
- não transformar hardware packs em plugins com authority irrestrita;
- não criar um segundo updater;
- não bloquear o primeiro USB por recursos P1 que não sejam gates do hardware oficialmente anunciado.

## Estado atual verificado

### Já implementado/fundado

- hardware support matrix machine-readable;
- política `driver_present_is_supported_hardware_claim=false`;
- requirement de prova física por alvo para claim Stable;
- baseline x86_64 pequena e explícita;
- caminho Intel DRM atual;
- baseline Wi-Fi/firmware definida;
- estratégia futura `small-baseline-plus-signed-hardware-packs`;
- exact modalias match requerido;
- exact kernel ABI match requerido;
- signed component slot requerido;
- known-good/rollback requerido;
- sistema de update/component channel já possui base para staging/promotion.

### Parcialmente implementado

- inventário físico/diagnóstico já existe em partes, mas não como um painel de Hardware & Drivers acabado;
- hardware-pack contract/fundação existe, porém activation pública ainda não está promovida;
- várias capabilities possuem driver/pré-requisito no source sem claim público de suporte.

### Ausente/não promovido

- experiência visual única de Hardware;
- fluxo de descoberta de pack compatível;
- instalação/ativação pública de hardware pack;
- UX de reboot/health/rollback específica de driver;
- suporte homologado amplo para AMD/NVIDIA;
- Bluetooth/webcam/touchscreen como claims gerais;
- catálogo público de packs por hardware/ABI.

## Decisões arquiteturais

### 1. Hardware pack é componente assinado, não pacote arbitrário

Deve seguir o channel/receipts/trust já existentes.

### 2. Match é exato

Compatibilidade precisa incluir pelo menos identidade do dispositivo/modalias, arquitetura e ABI/kernel contract necessário. "Parece compatível" falha fechado.

### 3. Instalação é transacional

```text
inspect
 -> candidate
 -> verify
 -> stage
 -> reboot/hot-activate somente quando permitido
 -> health
 -> promote
 -> rollback em falha
```

### 4. UI separa três verdades

- **detectado**;
- **driver/pacote disponível**;
- **oficialmente suportado/provado**.

Nunca colapsar as três em um selo verde.

### 5. O hardware mínimo de NATIVE-001 continua P0 no owner do MVP

Se áudio ou suspend/resume forem necessários para o modelo anunciado no Native 1.0, isso não espera este P1 amplo. HARDWARE-001 cuida da plataforma geral de expansão depois.

## Fases

### Fase 0 — reconciliação dos owners

- mapear hardware matrix, hardware-pack contracts, component channel, diagnostics e System UI;
- identificar o que é inventory, o que é support claim e o que é install authority;
- não criar store paralelo.

**Gate H0:** owners sem duplicação.

### Fase 1 — Hardware Overview

Expor de forma somente leitura:

- CPU/arquitetura;
- GPU(s);
- rede/Wi-Fi;
- áudio;
- Bluetooth;
- storage relevante;
- bateria/power;
- kernel/base identity;
- status `supported`, `proven-current-target`, `unproven`, `unsupported`, `pack-available`.

**Gate H1:** UI não inventa suporte a partir de presença de hardware.

### Fase 2 — resolução de packs

- catálogo assinado/provider-neutral;
- exact modalias/ABI filtering;
- version/trust/size metadata;
- explanation do motivo de compatibilidade/incompatibilidade;
- download/staging sem ativar.

**Gate H2:** pack incompatível nunca chega a activation request.

### Fase 3 — activation transacional

- stage;
- preparar rollback;
- reboot se necessário;
- health específica do dispositivo/driver;
- promote known-good;
- rollback automático/assistido em falha.

**Gate H3:** falha não deixa o sistema preso sem caminho known-good.

### Fase 4 — UX de produto

- notificações claras;
- changelog/impacto;
- "requer reinicialização";
- histórico de ativação;
- recovery action;
- exportar diagnóstico sanitizado reutilizando serviço existente.

### Fase 5 — expansão física da matriz

Adicionar suporte modelo por modelo/capability por capability com evidência física real.

## Gates de aceite

1. detection != support claim;
2. hardware pack incompatível falha fechado;
3. assinatura/ABI/modalias são verificados antes da ativação;
4. activation possui known-good/rollback;
5. reboot não promove automaticamente sem health;
6. UI não mostra NVIDIA/AMD/Bluetooth/etc. como suportados sem prova correspondente;
7. remover/rollback pack não apaga dados do usuário;
8. sistema continua bootável quando um pack opcional falha.

## Segurança/privacidade

- inventário de hardware não é enviado remotamente por padrão;
- catálogo remoto recebe somente o mínimo necessário para resolver compatibilidade ou usa resolução local quando possível;
- packs não herdam secrets/authority;
- diagnostics continuam redacted;
- signing trust segue owner de componentes, não UI.

## Custos/limites

Custos principais: hardware real para testes, CI por ABI e hospedagem dos artefatos. Não escolher provider de storage/CDN como contrato do domínio.

## Testes/evidências

- exact modalias positives/negatives;
- ABI mismatch;
- bad signature/hash;
- interrupted download/stage;
- boot com pack bom/ruim;
- rollback;
- health por capability;
- prova física por modelo;
- regressão de boot sem packs opcionais.

## Rollback/degradação

Hardware opcional degradado nunca derruba o OS inteiro. Se pack não puder ser confirmado, manter baseline/known-good e apresentar estado real.

## Relação com outros planos

- `NATIVE-001`: consome somente o mínimo necessário ao claim Native P0.
- `DESKTOP-001`: apresenta Hardware/Drivers dentro de uma experiência cotidiana, mas não é owner dos packs.
- `SURFACE-001`: shell/Ajustes continuam compartilhados.
- `MODE-001`: Web pode futuramente apresentar status do hardware remoto via capability autorizada; não executa driver local diretamente.

## Próxima ação documental

Revalidar contracts de hardware pack/component channel quando a janela P1 abrir. Até lá, não criar implementation task só por causa deste plano.

## Próxima ação de execução

**DEFERRED**, salvo recorte explicitamente requerido por owner canônico do MVP.

## Handoff para outro chat/agente

1. ler `hardware-support-matrix.json` antes de afirmar qualquer suporte;
2. não copiar DKMS/APT/driver manager de outra distro;
3. localizar hardware-pack e component-channel existentes;
4. preservar exact-match, assinatura, health e rollback;
5. separar detection, pack availability e support claim;
6. não promover AMD/NVIDIA/Bluetooth/webcam/etc. sem prova física;
7. se o problema for áudio/suspend do hardware MVP, trabalhar pelo owner P0/NATIVE-001, não esperar este plano P1.
