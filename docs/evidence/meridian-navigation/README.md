# Meridian — navegação por apresentação

Ajuste solicitado após a Round 3: a sidebar deve respeitar Central/Desktop e não repetir o alternador do rodapé.

- Central continua navegando entre páginas.
- Desktop abre os mesmos renderers de seção em janelas existentes da prévia, com minimizar, restaurar, compactar e fechar. Reabrir a seção não duplica a janela.
- `windowTarget` resolve metadados a partir dos catálogos existentes. Não há outro catálogo, aplicativo instalado ou runtime.
- Sidebar não exibe mais o item Central. No Desktop, a marca também não troca apresentação ao ser clicada. Alternância explícita permanece no rodapé.
- Intelligence solicitada dentro do Desktop permanece nesse ambiente.
- As janelas seguem o isolamento já existente por identidade e Space; o contexto da página Central não é substituído pela navegação do Desktop.

Verificação focada: `node tools/meridian-preview/navigation-smoke.mjs`, com host 4203 ativo. **20 checks**, zero exceções JavaScript. Sintaxe dos seis módulos afetados e `git diff --check` aprovados. Sem build, backend, main, push ou publicação. Não substitui auditoria independente.

Capturas: [Ajustes no Desktop](desktop-ajustes.png), [Aplicativos e painel compacto](desktop-apps-com-dispositivos.png), [Dispositivos mobile](desktop-dispositivos-mobile.png). Resultado: [quick-check.json](quick-check.json).

Base desta mudança: `0f4f067`, branch `codex/meridian-design-lab`. Meridian permanece experimental e não pronto para merge. Os registros históricos da Round 3 permanecem sem alteração.

## Maximização sem margens

A janela maximizada passa a preencher os limites da área de trabalho disponível,
sem inset, cantos arredondados ou sombra externa. Sidebar, navegação e a divisão
existente do painel compacto continuam reservadas pelo layout. Não usa a API de
tela cheia: maximizar e tela cheia de conteúdo permanecem conceitos separados.

Conferência geométrica em 1440×900, 820×900 e 390×844: nove verificações aprovadas,
incluindo alternar janela flutuante/maximizada. Zero exceções JavaScript.
Resultado em [maximize-check.json](maximize-check.json).
