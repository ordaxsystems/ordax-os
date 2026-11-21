# Protocolo de validação manual de acessibilidade — OrdaX Site

**Status:** gate **PENDENTE**. Este protocolo não é evidência de execução, nem autoriza merge/cutover/deploy. O owner da apresentação é `ordaxsystems/ordax-os/main`, módulo `site/`. Identity compartilhada utiliza exclusivamente a API canônica em `api/` e `lib/` do próprio OS; Platform, Surface e o publicador de releases conservam suas autoridades respectivas. O repositório `ordax-site` é origem histórica, não SSOT do código.

## Escopo e fontes de verdade

- Rotas: iterar o `site/contracts/site-routes.json` do **mesmo commit `ordax-os/main`** usado para gerar o candidato; não manter lista duplicada de rotas neste documento.
- Build: executar `site/scripts/build.py` com `--source-commit` igual ao SHA completo de `ordax-os/main` e `--dev-lock site/contracts/dev-artifact-lock.json`, consumindo apenas os artefatos Surface assinados autorizados. Verificar o manifesto do candidato; o preview protegido `ordax-site` não equivale ao deployment de produção nem concede autorização de cadastro/Identity.
- Prova automática histórica: `site/scripts/browser_smoke.py` já cobriu teclado/AX, contraste de superfícies planas, reflow, sem JS, `forced-colors`, ampliação **simulada** de texto a 200% e espaçamento WCAG 1.4.12. Essas provas antigas permanecem no histórico Git de `ordax-site`; não as atribuir automaticamente à `main` atual. Os testes `text200` e `spacing` são **regressões parciais de DOM**, não zoom nativo nem aprovação visual/manual.
- Evidência válida exige relatório e capturas **da mesma revisão** do `ordax-os` em avaliação, incluindo commit, digest, browser e exclusões; [`AUDIT.md`](AUDIT.md) descreve o ownership atual, **não** substitui recibos de execução. Não copiar contagens ou screenshots de branches/commits antigos. Zoom nativo, zoom somente de texto, leitores de tela e contraste de fundos compostos exigem inspeção manual.
- Fonte visual de demonstração `.playground`: avalie-a como conteúdo exibido ao usuário, mas encaminhe ajustes de seus artefatos canônicos ao owner Surface. Não introduza CSS espelho no Site.

## Evidência obrigatória por rota

Registre: revisão completa do commit, digest do build candidato, rota do contrato, sistema operacional, navegador/versão, viewport físico, fator de zoom ou configuração de fonte **real**; status PASS/FAIL/BLOCKED, passos de reprodução, captura de tela e referência da issue para toda falha. Nenhuma captura deve conter credenciais, dados pessoais ou sessão real. Resultados parciais não podem fechar o gate.

## 1. Zoom de página nativo — WCAG 1.4.4 e 1.4.10

1. Abrir o build **em ambiente isolado**, com Chrome/Firefox desktop normais, viewport físico `1280 × 900` ou superior. Redefinir o zoom para 100%.
2. Pelo menu do navegador ou pelo controle nativo de zoom, aplicar **200%** e depois **400%**. Não usar `document.body.style.zoom`, `deviceScaleFactor` ou reduzir artificialmente a viewport em lugar do zoom real.
3. Em **todas as rotas**, verificar que navegação, mensagens, idiomas PT-BR/en-US, headings, link de pular conteúdo e foco continuam encontráveis e acionáveis com teclado; que textos relevantes não são cortados, sobrepostos ou escondidos; que não há rolagem horizontal da página em layout equivalente a **320 CSS px** nos conteúdos que devem refluir. Documentar exceções justificadas para conteúdo intrinsecamente bidimensional, em vez de mascará-las.
4. Em páginas Identity/Conta/Web não conectadas a staging, registrar explicitamente o estado **indisponível/fail-closed**. Não tentar substituir por contas/serviços simulados.

## 2. Ampliação nativa somente de texto — WCAG 1.4.4

1. Usar navegador com funcionalidade **somente texto** (por exemplo, Firefox com a opção “Zoom somente no texto”), em sessão isolada. Registrar versão e procedimento exato do navegador.
2. Fixar layout normal e ampliar **somente o texto para 200%**. Não considerar o teste `text200` automatizado como substituto.
3. Conferir que botões, campos, seletores, links, avisos, menus e conteúdo legal mantêm seus rótulos legíveis, distinguíveis e sem sobreposição/truncamento. Usar apenas conteúdo/rotas efetivamente presentes no bundle.
4. Se o navegador escolhido não oferecer zoom somente texto, marcar como **BLOCKED**; não substituir silenciosamente por outro tipo de escala.

## 3. Espaçamento de texto — WCAG 1.4.12

A suíte Chrome aplica esses parâmetros ao texto visível do Site na viewport 390 CSS px e exige métricas computadas, ausência de clipping direto em contêineres de texto e ausência de overflow horizontal ([CI histórico da origem](https://github.com/ordaxsystems/ordax-site/actions/runs/40057544890)). **Esse resultado histórico é parcial e não valida automaticamente a revisão atual do monorepo**. Na inspeção humana, aplicar os mesmos parâmetros e verificar visualmente todas as rotas, estados e idiomas. Parâmetros: altura de linha de pelo menos 1,5 × tamanho da fonte; espaço após parágrafos de pelo menos 2 × tamanho da fonte; espaçamento entre letras de pelo menos 0,12 × tamanho da fonte; espaçamento entre palavras de pelo menos 0,16 × tamanho da fonte. Verificar perda de conteúdo/funcionalidade, tanto em PT-BR quanto em EN-US. Registrar qualquer incompatibilidade antes de emitir PASS.

## 4. Leitor de tela e teclado

- **Windows:** executar com NVDA e navegador suportado; **macOS:** complementar com VoiceOver e Safari se disponível. Registrar versão de leitor/browser.
- Percorrer landmarks, heading principal, listas, links, idioma, menus, imagens, avisos de erro indisponível e alternância de idiomas por comandos do leitor de tela; confirmar nomes e estado acessíveis, ordem lógica de foco e retorno ao conteúdo após skip link.
- Verificar que nenhum conteúdo do playground se apresenta como heading/documento exterior duplicado, sem suprimir o conteúdo significativo da demonstração.
- Fluxos de Identity autenticados **somente** com gateway real autorizado em staging, depois de autorização do owner; sem staging, marcar BLOCKED, nunca PASS por usar mock.

## Critério de liberação

Este gate é aprovado **somente** com evidências por rota e perfil, bugs bloqueantes resolvidos no owner correto e aprovação humana registrada na PR. A checagem automatizada e este documento não bastam. Permanecem **separados** os gates de artefatos oficiais Surface/Platform, Identity staging, vínculo Git definitivo do projeto Vercel existente, domínio e deploy de produção. A prova de preview `dpl_Ad1HRByz2VZ1VJGpqLM4YRLPZ9Kr` foi aprovada para rotas estáticas, mas não substitui o gate humano de acessibilidade nem o E2E de Conta (503 preexistente).

Referência de comportamento de zoom do navegador: https://support.google.com/chrome/answer/96810?hl=pt-BR
