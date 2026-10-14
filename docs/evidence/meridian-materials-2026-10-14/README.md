# Coleção de materiais Meridian — 14/10/2026

Owner: Surface experimental. Base local/remota conferida: `14b8984`, branch
`codex/meridian-design-lab`. Exceção explícita ao Freeze: o usuário solicitou
aplicar o concept mineral e iniciar uma coleção que conserve Argila/Grafite.
O [owner visual](../../design/MERIDIAN-VISUAL-SYSTEM.md#8-coleção-meridian--material-não-comportamento)
registra a extensão; este diretório contém evidência, não outra especificação.

## Entrega e limites

- Catálogo único de quatro IDs; tokens experimentais continuam em um único owner.
- Seletor compartilhado em Ajustes/painel rápido, com miniaturas dos tokens reais,
  nomes de controles e indicação textual/semântica da seleção.
- Pérola/Petróleo, arte vetorial mineral e wallpaper declarados pelo mesmo CSS.
- Corretivo mensurável no acento de Argila: texto/acento sobre fundo suave passa
  de 4,34:1 para pelo menos 4,5:1, sem alterar sua família visual.
- Troca mantém apresentação, Space, rascunhos e janelas nesta sessão.
- Os controles de Ajustes e do modal têm IDs distintos, mesmo montados juntos;
  ambas as instâncias refletem a mesma escolha e o foco fica no modal.
- Sem novo armazenamento de preferências, mudança de marca, backend, adapter,
  tema canônico, main, integração do produto ou operação física.

As ilustrações são SVGs locais originais e decorativos. O desenho é uma adaptação
vetorial do concept, não uma reprodução fotográfica ou mudança do conteúdo dos
projetos. O Freeze e suas capturas/hashes continuam como evidência histórica.

## Verificação executada

`node tools/meridian-preview/materials-smoke.mjs`, com o host de preview em 4203
e o Chromium descartável existente:

- **59 checks passaram**; quatro materiais, seleção por Enter nativo, foco,
  amostras, mesma estrutura da Central, continuidade, IDs inválidos e erros.
- **60 pares nominais de contraste de texto**, mínimo **4,526:1**.
- Central/painel em 1440×900, 390×844 e 320×568; sem overflow horizontal nos
  recortes verificados, cartões alcançáveis no painel com rolagem vertical.
- 13 capturas produzidas; quatro referências selecionadas neste diretório.
- Sem exceção de execução ou recurso com falha no navegador.

[Resultado detalhado](checks.json). Inspeção visual das referências claras,
escuras, mobile e Desktop também executada.

Regressão anterior: `round3-smoke.mjs` passou seus **27 checks**, com saída
separada em `out/meridian-materials/regression-round3`. Seu caminho de troca de
material agora abre a coleção antes de selecionar; as verificações anteriores
não foram removidas. Sintaxe dos módulos alterados e whitespace também conferidos.

Diagnósticos anteriores nesta tarefa: a primeira execução usou uma função que o
cliente do runner não expõe; o teste passou a usar `Runtime.evaluate`, como os
smokes existentes. O primeiro teste nominal encontrou o contraste 4,34:1 do
acento original de Argila; após o corretivo, o teste passou sem baixar o limiar.

Não substitui matriz completa dos audits, CI canônico, leitor de tela real,
forced colors, zoom ampliado, touch físico, boot USB ou homologação de release.

## Referências selecionadas

- [Central Pérola / 1440×900](central-pearl-1440.png)
- [Central Petróleo / 1440×900](central-petrol-1440.png)
- [Coleção Pérola / 390×844](collection-pearl-390.png)
- [Desktop Petróleo / 1440×900](desktop-petrol-1440.png)
