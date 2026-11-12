# Primeiro uso — prova de navegação em Chromium

**Data:** 2026-10-11
**Escopo:** regressão funcional da interface Native OOBE, em ambiente descartável.

## Fonte de verdade

- Interface real: `system/surface/ui/first-run.mjs`.
- Estado/contratos reais: imports ESM recursivos, sem implementar um assistente alternativo.
- Proof runner: `tools/surface-native/first-run-browser-smoke.mjs`, usando o utilitário compartilhado `tools/browser-proof/chromium.mjs`.
- CI oficial: `.github/workflows/surface-web-candidate.yml` → etapa Chromium.
- Execução local: `node tools/surface-native/first-run-browser-smoke.mjs`.

## Cenários verificados em DOM real

1. Abertura acessível do assistente.
2. Avanço pelas etapas Início, Rede offline, Conta, Segurança, Dispositivo e Revisão.
3. Aceite OS próprio, separado do cadastro da Conta OrdaX, obrigatório para entrar em modo local ou autenticado e registrado como texto provisório.
4. Gravação do recibo de primeiro uso local antes de fechar a interface.
5. Recuperação do estado original do root e não reapresentação após conclusão persistida no port descartável.
6. Escolha de identidade autenticada; logout durante o assistente devolve à etapa Conta.
7. Escolha de identidade autenticada e ainda válida; conclusão em modo identidade sem persistir `subjectId`.
8. Troca silenciosa de titular detectada na consulta de sessão obrigatória na conclusão.
9. Continuação local disponível após sessão expirada/trocada e enquanto a verificação de identidade permanece pendente.
10. Falha simulada da gravação mantém o assistente aberto e permite nova tentativa.

As 27 asserções são executadas sem rede de identidade real e sem escrita no disco físico. Os ports descartáveis **simulam** persistência e sessão, mas a interface, seus serviços, suas regras e a navegação DOM são o código do produto.

## O que NÃO está comprovado

Este teste não comprova boot do pendrive, persistência fsync/ext4/exFAT, acesso real ao Wi-Fi, login Supabase, implantação no host Linux nem renderização completa da Surface após fechar o assistente. Essas provas têm gates e responsáveis independentes. A falha neste smoke bloqueia a regressão de interface no CI; a aprovação não autoriza distribuição Stable/MVP nem gravação física.

## Fronteira Native HTTP em Linux

O teste tests/test_first_run_native_http.py exercita o **servidor Native verdadeiro**, em HTTP loopback, com FIRST_RUN_FILE redirecionado para um diret?rio tempor?rio. Verifica GET inicial, POST 204 ap?s escrita at?mica, GET de retorno, retry idempotente, bloqueio de mudan?a de modo/retrocesso, JSON inv?lido, Host/Origin estrangeiros e recibo corrompido que n?o pode ser sobrescrito. Executado pelo workflow Surface Web Candidate em Linux.

A prova Chromium e a prova HTTP Linux s?o complementares: usam o adaptador real no navegador e o host real em Linux, mas **n?o** afirmam boot f?sico nem fsync na m?dia USB alvo. O ensaio de integra??o entre ambos na mesma sess?o de hardware continua gate separado.

## Verified browser module origin (2026-10-18)

The canonical First Run renderer now resolves its Meridian brand image from
`import.meta.url`. The Chromium proof therefore serves the exact repository
ESM files and the existing symbol PNG over an ephemeral, loopback-only HTTP
origin instead of importing from `blob:null`. It preserves the real import-map
module graph, the existing production source and the same functional assertions.
Only the already-collected source files and the one canonical brand PNG can be
served; the server closes after the proof, including on failure. This validates
actual relative asset resolution without an alternate logo, runtime, installer
or skipped check. This fixes an independent baseline CI regression introduced
with the Meridian First Run visual migration, not an installation-state change.
