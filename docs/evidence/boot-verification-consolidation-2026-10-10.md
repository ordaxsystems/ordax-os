# Consolidação do boot verificável — 10/10/2026

Escopo: correções de boot/recuperação da PR
[#1326](https://github.com/ordaxsystems/ordax-os/pull/1326) incorporadas
seletivamente aos owners existentes da `main`, sem merge da branch antiga,
sem serviço paralelo e sem mudar permissões de gravação física.

## Correções funcionais

1. `bootstrap/initramfs/portable_init.sh`: quando a seleção `current`
   falha na prova *exact* (assinatura, identidade e conteúdo), tenta
   resolver `known-good` **separadamente**, rejeita SHA inválido/igual ao
   current e chama a **mesma** `verify_selected_release`. Se nenhuma prova
   for válida, permanece o caminho de recovery. A tentativa de `candidate`
   inválido ainda exige rollback persistente antes de permitir outra seleção.
   Não retargeta slots durante o fallback.
2. `bootstrap/entrypoint` (bootstrap transicional de manifest/1):
   `boot_current` só transfere execução depois do
   `ordax-release-agent activate-exact --expected-commit` e após reler
   a identidade para detectar substituição durante a verificação. A
   mesma ferramenta e confiança que já pertencem ao bootstrap são
   reutilizadas. Ausência ou falha do agente é bloqueio seguro; não se
   tenta executar uma árvore sem atestação.
3. `docs/contracts/minimal-bootstrap.json`: SHA-256 do arquivo
   `bootstrap/entrypoint` atualizado para os **bytes reais** LF, sem
   modificar artificialmente artefatos binários.
4. `.gitattributes`: `bootstrap/initramfs/portable_init.sh text eol=lf`;
   checkout Windows não pode quebrar o PID 1 com CRLF.
5. `.github/workflows/portable-v2-qemu-boot-proof.yml`: os novos testes,
   verificações `sh -n` e fontes alteradas passaram a integrar o gate
   de pré-validação canônico, antes da prova QEMU.

## Verificações locais

- Ubuntu 24.04/WSL: 4 testes de `test_bootstrap_current_verification.py`
  (**PASS**) e 10 de `test_portable_verified_boot_selection.py` (**PASS**).
- Cobertura: boot current legítimo, verificador ausente, verificação rejeitada,
  troca do SHA durante a prova, fallback known-good validado, known-good
  inexistente/igual/corrompido, candidate rollback permitido e recusado.
- `/bin/sh -n`: dois scripts de inicialização (**PASS**).
- `test_minimal_bootstrap_contract.py` (12),
  `test_portable_bootstrap_v2_contract.py` (8) e
  `test_minimal_bootstrap_source_line_endings.py` (3):
  **23 testes aprovados**.
- `python bootstrap/initramfs/build.py check` concluiu com sucesso;
  `git diff --check` sem falhas.

## Transação interrompida com candidata ausente

A PR #1326 também identificou que `bootstrap/initramfs/portable_state.c`
recusava toda a transação se o EROFS da `candidate` fosse perdido após
`prepare`. Isso impedia o fallback mesmo quando a release `current` e
a `known-good` estavam íntegros. O helper agora exige que a **identidade
da transação**, o SHA da candidata e a materialização de `current` e
`known-good` continuem válidos; só autoriza a primeira tentativa da
candidata se seu EROFS existir. Caso contrário, registra `rejected` e
realiza o rollback previsto, sem executar a candidata.

Quatro testes dinâmicos foram acrescentados ao owner
`tests/test_portable_activation_state_helper.py`: ausência antes do
primeiro boot, corrupção após a tentativa única, transação com identidade
adulterada e known-good danificada. O workflow QEMU canônico agora
executa esse conjunto com o compilador C do runner antes da montagem.

O primeiro Ubuntu WSL não possuía compilador e ignorou a suíte; esse skip
não contou como aprovação. Outra distribuição Ubuntu com `/usr/bin/cc`
compilou o helper com `-O2 -Wall -Wextra -Werror` e executou **11/11 testes
PASS**, incluindo as quatro novas regressões. O boot QEMU/UEFI completo
continua dependendo do workflow canônico.

## Limites da evidência

Estes são testes unitários/contratuais e shell real, não prova física.
A compilação integral, QEMU/UEFI, verificação de artefatos de release no
dispositivo e cold boot pós-hardening requerem seus workflows canônicos.
Não houve download de novo sistema para o USB, escrita em disco físico,
publicação de Stable nem ativação da Conta.

A PR #1326 segue aberta até que seu restante de boot, transação de
ativação, recuperação e snapshot da registry seja integrado ou
fundamentadamente descartado na `main`.
