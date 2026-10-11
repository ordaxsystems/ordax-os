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
2. Avanço pelas etapas Início, Regional, Rede offline, Segurança, Conta, Privacidade e Pronto.
3. Gravação do recibo de primeiro uso local antes de fechar a interface.
4. Recuperação do estado original do root e não reapresentação após conclusão persistida no port descartável.
5. Escolha de identidade autenticada; logout durante o assistente devolve à etapa Conta.
6. Escolha de identidade autenticada e ainda válida; conclusão em modo identidade sem persistir `subjectId`.
7. Troca silenciosa de titular detectada na consulta de sessão obrigatória na conclusão.
8. Continuação local disponível após sessão expirada/trocada.
9. Falha simulada da gravação mantém o assistente aberto e permite nova tentativa.

As 14 verificações são executadas sem rede de identidade real e sem escrita no disco físico. Os ports descartáveis **simulam** persistência e sessão, mas a interface, seus serviços, suas regras e a navegação DOM são o código do produto.

## O que NÃO está comprovado

Este teste não comprova boot do pendrive, persistência fsync/ext4/exFAT, acesso real ao Wi-Fi, login Supabase, implantação no host Linux nem renderização completa da Surface após fechar o assistente. Essas provas têm gates e responsáveis independentes. A falha neste smoke bloqueia a regressão de interface no CI; a aprovação não autoriza distribuição Stable/MVP nem gravação física.
