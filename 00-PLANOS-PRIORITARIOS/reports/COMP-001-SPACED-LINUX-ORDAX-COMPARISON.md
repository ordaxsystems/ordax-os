# COMP-001 — Comparação OrdaX OS × Spaced Linux

- **Tipo:** ANALYSIS / AUDIT
- **Status documental:** REFERENCE
- **Execução:** NOT APPLICABLE
- **Data:** 2026-10-14
- **Escopo:** comparar capacidades de produto do Spaced Linux com a `main` do OrdaX, distinguindo lacuna real de funcionalidade já existente/fundada
- **Fonte/origem:** `https://spacedlinux.com/help`, site/repositório público do Spaced Linux e inspeção da `main` de `ordaxsystems/ordax-os`
- **Base do repo verificada:** `main` em 2026-10-14, após criação de `MODE-001`
- **Limitações:** comparação de arquitetura/produto; não é benchmark de performance, segurança formal nem homologação de hardware

## Pergunta investigada

Quais funcionalidades vistas no Spaced Linux realmente faltam no OrdaX, quais já existem, quais estão parcialmente implementadas e quais ideias podem ser adaptadas sem importar a arquitetura Debian/Devuan do sistema de referência?

## Resumo executivo

A primeira comparação superestimava as lacunas do OrdaX. A auditoria da `main` mostrou que várias áreas já possuem implementação/fundação significativa:

- Native installer não precisa ser criado do zero;
- OOBE/Welcome já é persistente;
- Diagnostics já possui journal, redaction, review, copy/export;
- Store já possui catálogo/lifecycle/estados reais e first-run selection foundation;
- Updates/known-good/rollback são mais estruturados que a apresentação ao usuário sugere;
- Accessibility já possui contraste, redução de movimento e text scale;
- Local AI/Intelligence já possui contracts/runtime/model/hardware benchmark foundation;
- temas e prefs já possuem SSOT compartilhado.

O maior valor da referência externa está em **fechar experiências cotidianas**, não em substituir a arquitetura do OrdaX.

Recomendações resultantes:

1. P0: fechar USB → Native whole-disk seguro e boot/recovery real;
2. P0 por hardware anunciado: áudio e suspend/resume quando necessários ao claim de notebook Native;
3. P1: Hardware & Drivers sobre hardware packs assinados já previstos;
4. P1: Tela e monitores;
5. P1: Help Center offline integrado ao diagnóstico/Intelligence;
6. P1: Files providers para SMB e telefone/MTP/PTP;
7. P1/P2: UX de Updates e descoberta de apps por intenção;
8. P2: Theme Packs mais ricos.

## Evidências/fatos

### Native installation

O OrdaX já possui:

- `docs/NATIVE-INSTALLATION.md`;
- `docs/contracts/native-installation.json`;
- `system/contracts/native-install-targets.mjs`;
- adapter Native de targets;
- Surface `native_install_broker.sh`;
- Creator Core com geometry/plan;
- target fingerprint/reenumeration;
- source USB exclusion;
- GPT + ESP + LUKS2 + Btrfs;
- prova descartável de materialização.

Lacuna real: APPLY físico promovido, release materialization no alvo real, boot sem USB, first-boot health e recovery/known-good do candidato autorizado.

### OOBE / Welcome

`docs/contracts/first-run.json` e `docs/CURRENT-STATE.md` registram fluxo persistente real:

`welcome -> regional -> network -> security -> account -> privacy -> ready`.

Portanto não criar outro Welcome.

### Store

Já existem:

- `ordax.app-store-catalog/2`;
- catálogo Native verificado;
- estados de install/update/remove/staged;
- lifecycle request boundary;
- seção Essenciais;
- first-run selection baseada no catálogo real;
- semântica `ABSENT`/`REMOVED` e política para não reinstalar silenciosamente.

Lacuna real: fechar inventário bundled + component-slot, pacotes assinados/publicação/provisionamento E2E e transporte Web real (este último pertence a MODE-001).

### Diagnostics

`system/services/diagnostics/` já cobre:

- journal estruturado e bounded;
- redaction;
- report/review;
- freshness;
- sanitized summary;
- explicit copy;
- export via capability;
- telemetry opcional/provider-neutral.

Portanto não criar outro diagnostic app/backend; melhorar apenas presentation/Help integration quando necessário.

### Accessibility/appearance

Já existem contrast, motion e text-scale preferences, além de Light/Dark e paleta OrdaX USB com tokens/SSOT compartilhados. Theme Packs futuros são refinamento, não fundação faltante.

### Hardware

`docs/contracts/hardware-support-matrix.json` é deliberadamente conservador:

- presence de driver não equivale a support claim;
- Stable support exige prova física do target;
- Intel DRM atual é o caminho gráfico comprovado do alvo corrente;
- áudio, suspend/resume, Bluetooth, webcam, touchscreen, Secure Boot e AMD/NVIDIA acelerado não são claims gerais atuais;
- estratégia futura já prevê `small-baseline-plus-signed-hardware-packs`, exact modalias, exact kernel ABI, signed component slot e known-good/rollback.

Conclusão: evoluir essa estratégia até Hardware & Drivers, sem importar DKMS/APT como arquitetura.

### Mobile/files

Mobile Companion possui contracts para file/share handoff e outras capabilities, mas `CURRENT-STATE` ainda registra adapter como arquitetura/foundation sem APK implementado. Isso não substitui um provider local MTP/PTP para telefone conectado por USB.

Não foi encontrada implementação SMB equivalente a uma source completa no Files durante esta auditoria.

### Displays

Não foi encontrada capability acabada equivalente a um display manager real. Ocorrências de `Monitor` na Surface são predominantemente presentation/navigation; configuração de resolução/escala/orientação/arranjo precisa de adapter/runtime real.

## Alternativas

### Copiar stack do Spaced

Rejeitado como direção arquitetural. Calamares, Timeshift, APT/Flatpak, MATE/Compiz e Devuan resolvem problemas do sistema de referência, mas conflitam com/duplicam owners que o OrdaX já possui.

### Usar referência apenas como UX

Recomendado. Absorver princípios:

- experimente pelo USB antes de instalar;
- UI de driver transacional clara;
- Help acessível;
- Files com fontes comuns;
- Display settings úteis;
- updates explicáveis.

Implementar usando contracts/owners do OrdaX.

## Custos e limites

Nenhuma VPS/cloud é requisito para as principais lacunas encontradas. Custos relevantes são hardware físico de teste, tempo de CI e eventualmente storage/CDN para hardware packs. Multi-hardware support cresce com a matriz de prova, não apenas com linhas de código.

## Riscos

- criar subsistemas paralelos porque uma referência externa tem nome diferente;
- confundir source/contract com feature pronta;
- confundir driver presente com suporte homologado;
- tornar o Native permissivo demais para alcançar paridade superficial;
- atrasar P0 com melhorias cosméticas;
- reescrever updater/diagnostics/store sem necessidade.

## Recomendação

Usar esta comparação como filtro:

```text
já existe no OrdaX?
 -> SIM: fechar wiring/UX/gates no owner atual
 -> PARCIAL: completar a implementação existente
 -> NÃO: criar capability/adapter somente se o benefício for real
 -> solução externa usa outra arquitetura: copiar princípio, não stack
```

## O que este relatório não decide

Este relatório não habilita Native, não autoriza escrita em disco, não muda hardware claims e não promove P1 para execução.

## Planos relacionados

- `../plans/NATIVE-001-USB-TO-NATIVE-MVP-CLOSURE.md`
- `../plans/HARDWARE-001-HARDWARE-DRIVERS-AND-PACKS.md`
- `../plans/DESKTOP-001-DAILY-USE-EXPERIENCE.md`
- `../plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`
