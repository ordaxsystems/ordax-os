# Consolidação da localização — 10/10/2026

Escopo: `ordaxsystems/ordax-os`, branch única `main`. Integração seletiva
das PRs encadeadas de localização, sem merge das bases antigas e sem criar
um segundo motor de tradução, formatação ou preferências.

## Owners canônicos e mudanças aplicadas

| PR substituída | Commit da main | Prova de incorporação |
| --- | --- | --- |
| [#1286](https://github.com/ordaxsystems/ordax-os/pull/1286) | [33233e23](https://github.com/ordaxsystems/ordax-os/commit/33233e23) | `system/services/i18n/interpolation.mjs` e contrato semântico compartilhado em `system/contracts/localization.mjs`; notificação rejeita booleanos/coerções; SDK 1.16.0 regenerado pelo exportador oficial |
| [#1289](https://github.com/ordaxsystems/ordax-os/pull/1289) | [675f8714](https://github.com/ordaxsystems/ordax-os/commit/675f8714) | `system/services/i18n/surface.mjs` importa interpolação central e remove interpolador legado; evita conversão livre `String(value)` e ignora propriedades herdadas |
| [#1295](https://github.com/ordaxsystems/ordax-os/pull/1295) | [b0e94ce5](https://github.com/ordaxsystems/ordax-os/commit/b0e94ce5) | bandeja e painel de bateria usam `createLocaleFormatting` e `resolveRegionalTimeZone`; percentuais por `Intl`, tempo no fuso selecionado, atualização com preferência |
| [#1297](https://github.com/ordaxsystems/ordax-os/pull/1297) | [c029bd68](https://github.com/ordaxsystems/ordax-os/commit/c029bd68) | Centro de Notificações utiliza formatador/fuso canônicos; timestamps inválidos usam cópia localizada sem `toISOString` prematuro |

## Evidências executadas

- Fundação (#1286): **49 testes JS** para localização/Surface/notificações,
  **135 contratos JSON** validados; `tools/app-sdk/export.py --check` PASS,
  `bundle.json` + `bundle.sha256` regenerados de contratos atuais.
- Adoção da Surface (#1289): **44 testes JS PASS**, cobrindo interpolação,
  mensagens traduzidas, coações rejeitadas, RTL e notificações.
- Bateria (#1295): **41 testes JS PASS**, preferência de fuso, hora,
  percentuais, renderização e auditoria de strings.
- Notificações (#1297): **60 testes JS PASS** mais **135 contratos JSON**.
  Os testes de timestamp inválido são de contrato/estrutura de código;
  não há afirmação de E2E visual físico.
- Em todos os commits, alterações concorrentes de OrdaX Intelligence e
  Conta foram incorporadas via `git pull --ff-only` antes do push;
  nenhum force-push executado.

## Situação operacional

As quatro PRs foram **encerradas como substituídas** pelas mudanças
efetivas na `main`, não como merges. As branches históricas foram
preservadas por proveniência até a auditoria de dependências.
O código de localização agora tem owners únicos, sem preservar
implementações paralelas por compatibilidade artificial.

Permanecem separadas, entre outras novas PRs concorrentes:
- [#1345](https://github.com/ordaxsystems/ordax-os/pull/1345):
  catálogo e host de aplicativos externos, pacote e composição Native
  (24 arquivos; exige reconciliação com owner atual)
- [#1237](https://github.com/ordaxsystems/ordax-os/pull/1237):
  Projects CAS Native (21 arquivos; requer análise de dependências reais)
- PRs recentes de Conta/Creator são trabalhos ativos de outros responsáveis:
  não devem ser apagados ou mesclados cegamente

## Gate do MVP separado

A [prova QEMU manual](https://github.com/ordaxsystems/ordax-os/actions/runs/38035813342)
foi iniciada a partir do SHA `7bb6ba296f5fb0424efd9b382d1cc798ba6d217c`.
No momento da auditoria constava em execução na etapa de fallback
da candidata. **Sem veredito QEMU ainda**; e mesmo PASS em QEMU
não substitui release v4 atual assinada, materialização integral dos três
EROFS, autorização de alvo e boot real do pendrive.

O fechamento desta cadeia de localização não encerra o MVP global.
