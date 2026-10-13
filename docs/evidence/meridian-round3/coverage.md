# Meridian — Round 3 · 13 de outubro de 2026

Refinamento visual e de interação, experimental/opt-in. **Não pronto para merge.** A próxima etapa é a auditoria independente. Nenhuma integração com backend ou publicação foi feita.

1. **Branch:** `codex/meridian-design-lab`, no checkout `C:/Users/TONECOS/Documents/github/ordax-apps/tools/assistant-host/.data/os-meridian-lab`, neste computador.
2. **HEAD inicial:** `43cf7ba`. Correções e evidências da auditoria Round 2 foram preservadas; seu relatório permanece em `meridian-round2-audit-2026-10-13`.
3. **Commits:** `bf15f90` — `feat(surface): refine Meridian desktop composition and contextual continuity`. Documentação e capturas ficam em commit separado, `docs(surface): record Meridian Round 3 visual evidence and audit handoff`. Os commits são locais; não houve push.
4. **Desktop:** preservados wallpaper autoral, sidebar, objetos, seletor discreto de Space, janelas e painel compacto. A alteração concentra-se na composição, sem outro Desktop ou runtime de apps.
5. **Barra superior:** o shell deixa de emitir o header somente no Desktop. A grade passa a duas linhas: conteúdo e barra inferior. Não há faixa vazia ou deslocamento negativo compensando uma barra escondida. A Central conserva seu header e três linhas.
6. **Destino das funções:** busca e menu de aplicativos no início do rodapé, junto ao alternador; Ctrl/Command+K continuam no controller existente. Conta permanece na sidebar e nos acessos das telas estreitas. Space mantém o seletor contextual. O marcador “Estudo” permanece no Desktop, inclusive a 320 px.
7. **Barra inferior:** renderer único em `views/taskbar.mjs`, compartilhado pelas apresentações. União das ferramentas em destaque por Space e das janelas abertas, sem repetir apps. Fixado: sem ponto; aberto: ponto; ativo: contorno e traço; minimizado: marcador vazado. Nome/estado também são acessíveis. A política existente de abrir/restaurar janelas foi mantida.
8. **System tray:** à direita, rede, bateria, horário ilustrativo, notificações e ajustes rápidos. Em larguras menores os detalhes passam para o painel Sistema, que também oferece áudio e Intelligence. A contagem de não lidas é compartilhada com a sidebar e exclui eventos dispensados. Bateria, horário e volume não são telemetria real.
9. **Space:** Estúdio, Pessoal e Oficina têm ferramentas editoriais diferentes, com o mesmo shell e comportamento. Arquivos identifica o Space atual em vez de escrever “Estúdio” fixo. Isso não concede capabilities ou acesso a dispositivos.
10. **Central:** faixa operacional mais concisa, sem contador de zero janelas; atualização recebe rótulo curto quando não há pendência. No mobile, informações em duas colunas. Avisos de continuidade usam o mesmo seletor/renderer do painel Sistema.
11. **Continuidade:** rascunho preservado ao minimizar/restaurar, alternar Central/Desktop e voltar explicitamente ao Space. Expiração da conta separa trabalho local e remoto. Space indisponível não seleciona outro silenciosamente. O mecanismo auditado de sessões e identidades não foi substituído.
12. **Intelligence:** painel sob demanda identifica Space, app em primeiro plano e documento válido selecionado. A revisão abre a jornada existente sobre o trabalho, com as mesmas confirmações. Não há chatbot permanente novo, leitura real de arquivos ou chamada de modelo.
13. **Estados combinados:** tabela abaixo. `continuityItems` deriva apresentação dos storyboards existentes por identidade/Space, sem fila, tarefa ou persistência paralela. O controle de rede explicitamente demonstrativo permite mudar a condição sem trocar a identidade.
14. **Tipografia:** bandeja/tooltips em 12 px; horário secundário e marcador discretos; avisos em 13 px, entrelinha 1,6 e extensão limitada. Inter e a escala principal permanecem. Faixa operacional com alinhamento e quebra previsíveis no mobile.
15. **Motion:** animação não reinicia a cada reconstrução da página. Fade curto somente ao alternar apresentação; hover do dock sobe 2 px e pressionamento desce 1 px. Preferências de movimento reduzido preservadas. Foco da área principal usa o token do estudo.
16. **Responsividade:** Desktop/Central a 1440×900, Central/estados a 390×844, Desktop/bandeja a 320×568, jornada densa a 844×390. No dock estreito há rolagem horizontal interna para excedentes; a página não transborda. Painéis densos mantêm rolagem vertical para preservar conteúdo e controles.
17. **Argila/Grafite:** mesma estrutura e tokens Meridian existentes. Temas canônicos Claro/Escuro/USB, seletores e preferências não foram alterados. O wallpaper permanece igual para permitir comparar a composição.
18. **Mocks:** arquivos, projetos, conta, apps, pareamento, progresso, bateria, horário, volume e recibos continuam fictícios, isolados e descartados no reload. Acrescentados somente atalhos editoriais por Space e projeções de avisos/ajuda contextual. Nenhuma funcionalidade operacional de produção foi adicionada.
19. **Owners:** Surface é owner desta representação. Identity/Account, Spaces/Workspace, Intelligence, Files/Runtime, Device Host, Storage e Supervisor/Release mantêm autoridade. Nenhum contrato, grant, sync, Memory, router, instalação ou assinatura foi duplicado. Apps first-party conservam seus owners.
20. **Verificações:** `node --check` em 10 módulos alterados/novos; `git diff --check`; smoke focado com 27 asserções e zero exceções JavaScript. Dezesseis capturas aguardando decode de imagens e término de animações finitas. Execuções iniciais apontaram escapes/rotas incorretas no novo harness e codificação no novo aviso: corrigidos antes do resultado final. Nenhum build, npm, Foundation, matriz independente, CI remota, kernel, imagem USB ou hardware foi executado. Runners e testes anteriores não foram alterados.
21. **Riscos:** o controller ainda reconstrói DOM; não é lifecycle final de apps. O dock estreito merece avaliação com toque. Dispositivo interrompido representa janela/operação visual, não tarefa persistente real. Revisão completa de leitor de tela, teclado, contraste e hardware continua pendente. Reprovações canônicas anteriores continuam abertas. Esta evidência não autoriza adapters ou merge.
22. **URLs:** [Central](http://127.0.0.1:4203/), [Desktop Argila](http://127.0.0.1:4203/?surface=desktop), [Desktop Grafite](http://127.0.0.1:4203/?surface=desktop&material=ink). Host loopback exclusivo do estudo; não é boot USB.
23. **Capturas:** links abaixo; dimensões/checksums em [captures.json](captures.json), resultado em [quick-check.json](quick-check.json).
24. **Main intacta:** referência inicial/final `fafed4a8916587ad35bc07c2f3baa1a60d561b1e`. Mudanças restritas ao experimento, smoke e documentação. Nenhum push/deploy. Auditoria independente necessária antes de decidir integração.

## Estados combinados

| Condição | Comportamento observado | Evidência |
| --- | --- | --- |
| Offline + visitante | Rede muda sem identificar Lia ou expor contexto privado; continua local. | [Visitante](offline-visitante-390.png) |
| Offline + atualização | Atualização adiada e continuidade local explícitas. | [Pendências](offline-atualizacao-rascunho.png) |
| Atualização + texto não salvo | Revisão do trabalho antes de reinício; sem confirmação automática. | [Rascunho](offline-atualizacao-rascunho.png) |
| Space indisponível + trabalho | Conteúdo anterior sai da tela; revisão e seleção explícita restauram seu próprio rascunho. | [Space](space-indisponivel.png) |
| Conta expirada + trabalho local | `expired-local` aceita novo rascunho sem expor o trabalho de Lia. | [Conta](conta-expirada-local.png) |
| Armazenamento cheio + gravação | Falha permanece visível; texto não é anunciado como salvo. | [Volume](volume-cheio.png) |
| Dispositivo offline + janela | Janela preservada, operação não anunciada como concluída. Não é prova de tarefa real. | [Dispositivo](dispositivo-desconectado.png) |

## Capturas de composição

- [Desktop Argila sem topbar](desktop-argila-1440.png)
- [Desktop Grafite sem topbar](desktop-grafite-1440.png)
- [Desktop com janela flutuante e compacta](desktop-janelas-1440.png)
- [Outro Space, mesmo Desktop](desktop-oficina.png)
- [Intelligence contextual](intelligence-contexto-1440.png)
- [Central](central-1440.png)
- [Central mobile](central-mobile-390.png)
- [Desktop 320 px](desktop-320.png)
- [Bandeja 320 px](bandeja-320.png)
- [Jornada densa em paisagem](arquivo-paisagem-844.png)

## Reprodução e auditoria

Iniciar `python tools/meridian-preview/serve.py --port 4203` e executar
`node tools/meridian-preview/round3-smoke.mjs`. Saída em `out/meridian-round3`.
O runner usa Chromium descartável e deixa o host ativo. A automação do browser
integrado não ficou disponível nesta sessão; as capturas vieram do runner local
existente, sem usar a sessão pessoal do navegador.

A auditoria seguinte deve revisar isolamento por identidade/Space, confirmações,
foco, bandeja móvel e ausência de imports em entrypoints reais. Os 27 checks não
substituem a matriz independente nem mudam a classificação C da Round 2.
