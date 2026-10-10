# Consolidação de branches e PRs — 10/10/2026

Repositório canônico: `ordaxsystems/ordax-os`; alvo único: `main`.
Esta auditoria é **não destrutiva**. Um código exclusivo de branch só pode
ser encerrado após evidência de incorporação, substituição equivalente ou
descarte fundamentado.

## Contagem observada na API oficial

- **7 PRs abertas**; **26 issues abertas**; **109 branches remotas**, das
  quais **108 não são main**.
- Na inspeção inicial, o checkout local estava limpo e sincronizado com
  `c030d6a`; outro trabalho avançou `main` durante a auditoria.
- O checkout local é **shallow** (`git rev-parse --is-shallow-repository=true`).
  Portanto, **não** usar `git branch -r --merged`, `git merge-base` ou
  `git cherry` como prova suficiente para excluir branches: a história
  local parcial produziu falsos `unrelated histories` e falsas diferenças
  entre milhares de commits. Para cada exclusão futura exigir comparação
  GitHub de SHA exato, ausência de PR aberta e revisão dos arquivos únicos.

## PRs abertas (auditadas, sem merge indevido)

| PR | Tipo | Divergência observada | Destino |
| --- | --- | --- | --- |
| [#1345](https://github.com/ordaxsystems/ordax-os/pull/1345) | Surface / apps externos | 24 arquivos, conflitos com main; branch antiga | Reaplicar somente delta útil sobre os owners de apps atuais; testar catálogo e Surface |
| [#1326](https://github.com/ordaxsystems/ordax-os/pull/1326) | Segurança Native | 18 arquivos, 6 commits exclusivos; PR ainda draft e CI obsoleto | Portar mudanças específicas, começando pela checagem HTTP antes do dispatch; revisar boot, sessão local e testes Linux isoladamente |
| [#1297](https://github.com/ordaxsystems/ordax-os/pull/1297) | Formatação notificações | Draft; tem base na branch da PR #1295, não em main | Fechar após portar e testar a cadeia no SSOT de localização |
| [#1295](https://github.com/ordaxsystems/ordax-os/pull/1295) | Formatação bateria | Draft; depende da PR #1289 | Preservar enquanto não houver integração comprovada |
| [#1289](https://github.com/ordaxsystems/ordax-os/pull/1289) | Interpolação Surface | Draft; depende da PR #1286 | Preservar enquanto não houver integração comprovada |
| [#1286](https://github.com/ordaxsystems/ordax-os/pull/1286) | Base interpolação | Draft; conflito com main | Comparar owner i18n, contratos e bundle SDK; reconstituir a base a partir da main |
| [#1237](https://github.com/ordaxsystems/ordax-os/pull/1237) | Projects CAS Native | 21 arquivos, conflitos e dezenas de commits antigos | Revisar integração com Files/Internet/Projects sem reviver owners duplicados |

A cadeia de localização não é uma sequência de PRs diretamente mescláveis
na main; aplicar na ordem antiga sem revisar dependências arrisca introduzir
contratos e bundle SDK desatualizados.

## Integração incremental feita na main

Da PR #1326, foi identificada a ausência de validação de Host/Origin no
`HEAD` herdado por `NativeHostHandler`. Foi portado **apenas** o controle
de ingresso central em `NativeHostHandler.parse_request`; as validações
redundantes dos métodos GET/POST/OPTIONS e do subclass app-data foram
retiradas. Há cobertura de GET, HEAD, POST, OPTIONS, PUT e Origin/Host
inválidos no suite de integração Native; os testes Linux devem ser o gate
de incorporação, pois o servidor depende de POSIX/`fcntl`.

O restante da PR #1326 **não é declarado incorporado** por essa alteração.
As PRs e suas branches continuam abertas enquanto tiverem trabalho exclusivo.

## Critério para fechamento/limpeza

1. Consultar a API do GitHub para PR e branch no **SHA imutável** atual;
   validar se branch tem commit exclusivo da main e se há PR em andamento.
2. Testar delta útil em cima da main real, não simplesmente mesclar uma
   branch antiga por ter CI verde em outra base.
3. Incorporar código/contratos/testes no owner único, registrar evidências
   de CI ou integração no host suportado.
4. Encerrar PR somente com link da integração ou descarte comprovado.
5. Excluir branch apenas se plenamente incorporada ou explicitamente
   descartada, sem PR viva ou trabalho concorrente; preservar histórico
   de commits via main/PR/relatório.

**Não apagar centenas de branches por nome, idade ou por um checkout
shallow; isso poderia eliminar trabalho que os outros chats ainda produzem.**
