# Nomenclatura pública e origem canônica do OrdaX Web — 2026-10-16

Este registro documenta a decisão aplicada em `main`. A autoridade machine-readable continua sendo `system/contracts/product-family.mjs`; este arquivo é somente evidência/rastreabilidade e não cria um segundo owner.

## Nomes públicos oficiais

| Modo | Nome público |
| --- | --- |
| Browser | **OrdaX Web** |
| Android / iOS | **OrdaX Mobile** |
| Aplicativo instalado no Windows e futuros hosts desktop | **OrdaX Desktop** |
| Sistema operacional executado por USB | **OrdaX OS — USB** |
| Sistema operacional instalado em disco interno | **OrdaX OS — Nativo** |

`OrdaX Studio` permanece um aplicativo do ecossistema, não um sexto modo de execução. O aplicativo Windows não deve ser chamado de “OrdaX Windows”, porque Windows é o host do **OrdaX Desktop**, não o sistema operacional OrdaX.

## Endpoints públicos

A distinção pública fica:

```text
https://ordax.com.br
  -> site institucional/público OrdaX
  -> Conta, download, legal e apresentação dos produtos

https://ordax.com.br/web/
  -> página pública de apresentação/entrada do OrdaX Web

https://web.ordax.com.br
  -> origem canônica do produto OrdaX Web
```

O path transitório de hosting do artefato Web sob o deployment do portal não deve virar nome público permanente do produto.

## Segurança e ativação

Definir `https://web.ordax.com.br` como origem canônica **não declara o runtime disponível** e não autoriza contornar os gates atuais de Conta/Identity. O owner de deployment do Web continua responsável por provar roteamento, sessão/autorização, cookies, CSP, origem e E2E antes de ativar o lançamento público.

O portal pode continuar usando sua entrada `/web/` enquanto o destino final estiver fail-closed. Quando o host canônico for promovido, a navegação deve apontar para `web.ordax.com.br` sem criar um segundo backend, uma segunda Conta ou uma segunda Surface.

## Commits

- `7fc55f616197cc92957eb076eb8e3e95d92e5518` — define endpoints públicos no contrato da família de produto.
- `57291138f7247aa14902e33dc86a8da6b11272ef` — fixa a decisão em testes de contrato.
