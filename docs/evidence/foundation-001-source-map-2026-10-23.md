# FOUNDATION-001 — Mapa parcial de arquitetura e concorrência (2026-10-23)

> EVIDENCE datada, não source authority, SSOT de arquitetura nem novo plano. **FASE 1 PARCIAL**. Nenhuma modificação funcional/USB/Native, boot físico NOT-PROVEN.

## Heads consultados

| Repositório `main` | SHA |
| --- | --- |
| `ordaxsystems/ordax-os` | `ec6cb268cbcfe33ec17e60b81113ed8e0493ad7a` |
| `ordaxsystems/ordax-apps` | `cd3b4c6554054f8a6aa49843763e5f7913c13e77` |
| `ordaxsystems/ordax-runtime` | `9154cb977bbad9f007e7734ebfbeeb4997e7db57` |
| `ordaxsystems/ordax-platform` | `3ae5d914df03f8f6a677ddd18cf3337cd0bcb89a` |

Na primeira consulta, a busca retornou 51 PRs abertas no OS; desde então #2176 foi integrada à main, portanto o número deve ser recontado em toda retomada.

## Fluxos/owners verificados no source (não equivalem a prova física)

| Fluxo | Entry points e contratos | Gate/limite |
| --- | --- | --- |
| Firmware/boot | `boot/esp/`, `bootstrap/initramfs/`, `bootstrap/entrypoint`, `bootstrap/recovery/` | EFI, seleção de Base e recovery exigem prova real |
| Owner/Dev | `bootstrap/dev-base/ordax-dev-init` → `ordax-run` → `system/entrypoint` → `system/supervisor` → `system/surface/entrypoint` → `bin/ordax-surface` | Verificar health autenticado e maintenance |
| Git atualização | `bootstrap/dev-base/ordax-pull`, `ordax-rollback`, `system/services/base-update/dev-helpers.sh` | Checkout/rollback sob Supervisor; PR #2161 é owner concorrente |
| Base/kernel | `bootstrap/kernel/`, `bootstrap/base-update/`, `system/services/base-update/agent.sh`, `docs/contracts/base-update.json` | ESP staging, ABI e ativação ainda gated |
| Stable/Portable | `bootstrap/release-acquisition/`, `bootstrap/portable-v2/`, `bootstrap/initramfs/`, `system/supervisor` | Signed verification e known-good não autorizam mídia física |
| Sistema/UI | `system/services/`, `system/surface/`, `system/adapters/`, `system/composition/{web,native}/`, `docs/contracts/module-boundaries.json` | PR #2177 já integrada; não duplicar UI estrutural em apps |
| Creator | `tools/creator/core/`, `tools/creator/assemble.py`, `tools/creator/platform/` | Único produtor. Não inventar outra geometria |
| MCP/ações | OS lifecycle/permissão local; `ordax-runtime` ações Native; `ordax-platform` OAuth/grants/sessão | Nenhum comando físico executado nesta investigação |

Contratos de mídias **não são inconsistência a eliminar**: `physical-media.json` governa seed transitório de 2 partições; `physical-prepared-media.json`, USB Owner Dev transitório de 3; `portable-usb-v2.json`, Portable alvo de 2 partições com `physical_write_authorized=false`. Dev Git-first e Stable assinado usam autoridades de aquisição distintas sob `distribution-profiles.json`, sem justificar dois Supervisors.

## Colisões verificadas por lista de arquivos das PRs

| PR | Risco e ação |
| --- | --- |
| #2177 | Merge já na main (`96f70c9a`); não repetir a separação da Surface |
| #2176 | Merge já na main (`ec6cb268`); políticas de Aura/preseed NÃO são instalação física provada |
| #2161 (draft) e #2155 | Ambos alteram `system/supervisor`; reconciliar polling e update transacional no mesmo owner |
| #2161 (draft) e #1860 (draft) | Coincidem em `system/services/base-update/dev_channel.py` e `tests/test_hot_update_supervisor.py`; não cortar Alpine/ABI antecipadamente |
| #2168 | Altera `system/surface/bin/ordax-surface`; chroot/efivarfs depende de mountpoint real |
| #2169 | Altera `system/entrypoint` e `bootstrap/dev-base/ordax_usb_mountattr.c`; preservar errno/remount e rollback |
| #2167 (draft) e #2000 | QEMU geom. Dev e inventário Creator afetam o mesmo fluxo, embora arquivos distintos; cruzar provas |
| #2179 | Studio removal colide com código/assets modificados pela #2176 já na main (`docs/APP-PORTFOLIO-AND-PREINSTALL.md`, playground/snapshot, `sites/public/index.html`, testes); exigir reconciliação |

A PR #2178 contém apenas plano/índice/AGENTS, sem código. Para preservar a main ativa de #2177/#2176, a continuação integra esses commits por merge na **branch da PR**, não por rewrite da main. Nenhuma PR com mudança de boot/update pode ser mesclada em razão desta auditoria.

## Fase 1 pendente — execução seguinte

1. Levantar grafo exaustivo de imports, comandos, arquivos gerados, CI, docs, recovery e branches concorrentes; antes de excluir algo, registrar path, consumidor, evidência, owner e teste negativo.
2. Reproduzir handoff firmware → Base → Supervisor → Surface/health e efeitos da ordem de probation, shutdown/remount, Base candidates.
3. Comparar estado journal/commit-point/known-good nas geometrias Dev/Portable; testes de falhas, CI/QEMU e prova física são gates separados.
4. Selecionar uma correção de causa raiz dentro da PR/owner já existente, sem mover dezenas de módulos nem criar adaptador paralelo.
5. Validar o novo HEAD da PR #2178 e conferir `main` novamente antes do merge. Sem prova física, manter USB e Native como NOT-PROVEN.

**Conclusão:** inventário inicial rastreável, não auditoria exaustiva; nenhuma remoção de legado ou conclusão da Fase 1 declarada.
