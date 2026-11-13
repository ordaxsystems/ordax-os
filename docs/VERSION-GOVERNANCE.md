# Política canônica de versões do ecossistema OrdaX

**Owner de política:** `ordaxsystems/ordax-os/system/contracts/product-version-governance.mjs`.

A versão SemVer identifica uma **composição/candidato de produto deliberadamente versionado**. Ela não é contador de commits, branches ou PRs. Cada revisão de source continua identificada de forma inequívoca por Git SHA + proveniência.

## Regra principal

- Alterações normais de source podem ser implementadas e integradas em paralelo sem disputar um número global.
- `system/contracts/product-version.mjs` muda somente quando existe intenção de avançar a identidade da composição/candidato OrdaX.
- Quando esse arquivo muda, a nova versão deve ser SemVer válida e estritamente maior; regressão e alteração sem avanço são bloqueadas.
- `alpha.N`, `beta.N` e `rc.N` classificam maturidade da versão. Nenhum sufixo autoriza publicação, Stable, assinatura, instalação ou gravação de USB.
- Source SHA, hashes e receipts continuam sendo a identidade técnica exata dos bytes que compõem cada candidato.

Isso evita um conflito artificial: duas PRs independentes podem avançar simultaneamente sem ambas tentarem reservar `0.1.1-alpha.1`.

## Ownership das versões

| Produto/componente | Owner da versão | Regra |
| --- | --- | --- |
| OrdaX OS / composição Native | `system/contracts/product-version.mjs` | Avança no ponto explícito de composição/candidato, não em toda PR |
| Apps first-party | manifesto do app em `ordax-apps` | A versão acompanha artefato/pacote do app, não coordena o OS |
| Desktop | candidato/release do owner Desktop | Consome uma composição OrdaX/OS exata; não replica versão da Surface |
| Creator | versão do aplicativo Creator | Consome mídia OrdaX verificada; não herda versão de cada upstream |
| Surface | revisão source por SHA/proveniência | A adoção Native é selecionada pelo lock do OS |
| Intelligence e demais componentes | manifesto/revisão do próprio owner | O OS adota por contrato quando necessário |

## Canais

A forma aceita é `major.minor.patch`, opcionalmente `-alpha.N`, `-beta.N` ou `-rc.N`. `N` é inteiro não negativo sem zero à esquerda.

O OS atual declara `0.1.0`, `maturity=prototype` e `stableRelease=false`. Essa identidade só deve mudar quando a composição do produto for deliberadamente avançada. Um merge de código, isoladamente, não prova nem exige uma nova versão de produto.

## Gate executável

`.github/workflows/product-version-governance.yml` é um gate leve e focado:

1. valida a gramática e a identidade atuais;
2. detecta se `system/contracts/product-version.mjs` foi realmente alterado;
3. se foi alterado, exige avanço SemVer e proíbe regressão;
4. se não foi alterado, não inventa nova versão por causa de mudanças de runtime;
5. não publica, assina, promove, instala ou escreve em dispositivo.

A política não substitui contratos de canal/release, provenance, `docs/CURRENT-STATE.md`, package manifests ou gates físicos.

## Integração multi-repositório

A versão segue a mesma regra de dependência direta do ecossistema: cada owner versiona o artefato/produto que realmente produz. Consumidores não precisam sincronizar números ou abrir PR apenas porque um upstream avançou source. A adoção ocorre quando um novo artefato/revisão é realmente consumido.

A regra de composição completa está em `docs/DEVELOPMENT-WORKFLOW.md` e ADR-031 de `docs/DECISIONS.md`. Permissões, grants e autoridade nunca são derivados de SemVer.
