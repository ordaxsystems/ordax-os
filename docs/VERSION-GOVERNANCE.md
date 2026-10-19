# Política canônica de versões do ecossistema OrdaX

**Owner de política:** `ordaxsystems/ordax-os/system/contracts/product-version-governance.mjs`.
**Gramática e comparação SemVer:** o contrato existente `system/contracts/component-manifest.mjs`. Nenhum segundo comparador implementado em Apps/Studio/Runtime.
**Owner de cada número:** um por produto; versionamento **não é** instalação, ativação, assinatura ou publicação.

## Versões e autoridade

| Tipo | Identidade canônica | Quem atribui a versão | O que a versão NÃO faz |
| --- | --- | --- | --- |
| OrdaX OS (USB e Native) | `ordax-os` (um produto, dois modos) | `system/contracts/product-version.mjs#PRODUCT_VERSION.semanticVersion` | Não autoriza boot físico, assinatura, canal Stable ou escrita de mídia |
| App first-party já distribuível | app id existente | `ordax-apps/apps/<id>/app.json#version` (contrato `ordax.component-manifest/1`) | Não instala, habilita grants, cria slot ou autoriza Store |
| App de plataforma ainda embutido | component id existente | Manifesto existente no owner OS, validado pelo contrato de componente | Não implica extração/cutover |
| Novo app ainda experimental | id próprio do protótipo | Versão do produto em seu owner real (ex.: `ordax-apps/prototypes/ordax-orchestrator/product-version.json` enquanto experimental) | Não implica App SDK, assinatura nem entrada na Loja |
| OrdaX Web, Mobile e Desktop | IDs de modo existentes | Release/deployment verificado de cada owner em `product-family.mjs` | Não herda o número do OS e não inventa APK/release |
| Platform/MCP/Runtime | Owners remotos e de execução já existentes | Release/contrato já canônico de cada serviço | Não muda URL MCP, grants, banco nem sessões por conta da versão |

A forma é **SemVer**: `major.minor.patch`, opcionalmente `-alpha.N`, `-beta.N` ou `-rc.N`; `N` é inteiro não negativo, sem zero à esquerda. `alpha` significa recurso ainda experimental; `beta` exige compatibilidade funcional suficiente para integração; `rc` exige candidato congelado e gates de release. Sem sufixo significa **versão semanticamente não-prerelease**, jamais "está em produção": o estado de publicação é uma autoridade independente e verificável.

**O OS já declara `0.1.0`, `maturity=prototype` e `stableRelease=false`. Este gate não muda esse número retroativamente nem regrava USB.** Sua próxima mudança de produto poderá receber, por exemplo, `0.1.1-alpha.1` (maior que `0.1.0` em SemVer), somente junto com alterações compatíveis e validação. USB e Native continuam na mesma sequência de versão OS, independentemente do canal de distribuição. Componentes do OS preservam suas **versões independentes** e manifestos próprios: não herdam a versão agregada para decidir updates.

## Obrigações executáveis, não lembretes ao assistente

1. Quando código **de produto** mudar, o gate de PR identifica arquivos de runtime e compara versão anterior x candidata pela implementação canônica. Regressões, número inalterado e versões inválidas falham.
2. Quando app first-party tiver `app.json`, a CI percorre todos os manifestos, valida com o componente da plataforma fixado por commit e exige **aumento da versão** se houver mudança de código/recursos daquele app. Não criar VERSION ou JSON paralelo para cada app.
3. Toda evolução deve manter histórico/nota de impacto com migração e rollback quando necessários. A versão pode mudar sem lançamento; publicação exige seus **outros gates** de pacote, trust, assinatura, health e autorização.
4. Canais `alpha/beta/rc` são padronizados para **todos**, não privilegiam Studio/Orchestrator. Nenhum agent pode ignorar CI ou editar `main` para contornar o gate.
5. Mudanças somente em documentação, testes e na infraestrutura de verificação não inventam nova versão do produto, pois não modificam bytes runtime.
6. Apps externos e clientes ainda sem artefato não recebem versão fictícia.
7. `0.4.12` do Flow/Grátis é a versão de origem congelada do Orchestrator; seu `0.2.0-alpha.N` é outra linha de produto. Source SHA e versão do app ficam juntos em proveniência; não compartilhar perfil/dados no staging.

### Detecção de mudanças do produto OS

O gate `tools/verify/product_version_changes.mjs` classifica alterações pelos
**diretórios proprietários da execução**, não pela extensão do arquivo.
Launchers executáveis sem extensão, assets, configurações e código sob
`system/` (áreas de runtime), `bootstrap/`, `boot/`, `kernel/` e
`initramfs/` exigem incremento de `PRODUCT_VERSION.semanticVersion` quando
seus bytes mudam. A classificação reconhece exclusões explícitas de
documentação/testes e arquivos auxiliares sem efeito de produto, como
`.gitkeep` e `README.md`, além dos próprios arquivos de governança.

A ausência de sufixo no nome de um arquivo **não** o isenta do versionamento.
Os testes `tests/test_product_version_changes.mjs` incluem o launcher
`system/surface/bin/ordax-surface` como regressão obrigatória. Alterações
apenas nos verificadores e documentação não produzem versões fictícias.

A política não substitui `docs/contracts/release-channel.json`, `docs/contracts/distribution-profiles.json`, o estado de `docs/CURRENT-STATE.md`, nem a SSOT de entrega das apps. Se as versões canônicas já existirem, elas **vencem** números inferidos por nome de branch, data ou UI.

## Adoção multi-repositório

Os consumidores devem depender da implementação de SemVer/comparação em `component-manifest.mjs` e do canal em `product-version-governance.mjs`, obtidos por pin imutável do owner OS/SDK, e não manter regex/semântica concorrente. Uma nova política só chega ao Apps após o contrato OS ser aprovado e o pin de consumer atualizado com testes. Permissões de execução e grants nunca são derivados de SemVer.
