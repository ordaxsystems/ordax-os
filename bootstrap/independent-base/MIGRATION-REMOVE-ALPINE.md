# Migração para base independente — remoção do Alpine

## Objetivo

Remover Alpine/APK do runtime base do OrdaX OS sem bloquear o desenvolvimento normal do produto e sem criar uma segunda arquitetura.

A implementação reutiliza exclusivamente o owner existente `bootstrap/independent-base/`, baseado em Buildroot, e permanece subordinada aos contratos canônicos do repositório.

## Autoridade e branch de trabalho

- `main` continua sendo a única source authority do produto.
- `platform/remove-alpine` é uma branch temporária de integração, nunca uma segunda autoridade.
- A branch deve receber `main` regularmente e ser removida após a integração final.
- Nenhum artefato dessa branch é Stable, release física ou autorização de gravação por existir nessa branch.

## Política de CI

O desenvolvimento da migração usa dois níveis distintos.

### Gate rápido por push

`.github/workflows/remove-alpine-fast.yml` roda somente em `platform/remove-alpine` para mudanças relevantes e valida contratos, testes unitários, sintaxe e a resolução real do Kconfig Buildroot sem compilar rootfs, kernel ou imagem USB inteira.

O gate executa `tests/test_alpine_removal_boundary.py`, que congela o conjunto atual de consumidores Python de `bootstrap/base/alpine_core.py`. Novos consumidores são proibidos; a allowlist só pode encolher à medida que a migração avança.

`tests/test_independent_owner_profile.py` trava a arquitetura do perfil Owner/Development: ele deriva do mesmo `ordax_minimal_defconfig`, adiciona capacidades declaradas em fragmento, reutiliza os helpers canônicos do Dev USB sem copiar sua lógica e exige que os receipts de módulos/firmware sejam embutidos exatamente no rootfs Owner.

`tests/test_kernel_module_payload.py` trava a fronteira neutra de hardware: módulos são derivados do `docs/contracts/hardware-support-matrix.json`, vêm exclusivamente do artefato `kernel-modules-<versão>.tar` do kernel canônico e dependências são resolvidas por kmod/modprobe, sem um segundo parser de `modules.dep`.

`tests/test_firmware_policy_neutral.py` prova que a política compartilhada de firmware é distribuição-neutra, falha fechada quando uma declaração `firmware=` não tem cobertura, rejeita caminhos inseguros e produz receipt com identidade SHA-256 sem baixar firmware por conta própria.

`tests/test_independent_heavy_workflow.py` trava a estrutura da prova cara: kernel canônico verificado antes do rootfs, archive de módulos exato, receipts externos explícitos, mesmo perfil no build/verify e upload das evidências de hardware.

O gate rápido executa `build.py resolve` para `minimal` e `owner-development`. Esse comando baixa/autentica a fonte Buildroot pinada, executa `defconfig` e verifica o `.config` resultante; ele registra explicitamente que não compilou rootfs nem kernel.

Objetivo: permitir ciclos normais de desenvolvimento em minutos, sem transformar cada commit em build completo e sem permitir que a dependência Alpine cresça durante a remoção.

### Gate pesado

`.github/workflows/independent-base-experiment.yml` continua sendo a única prova pesada existente, com Buildroot, kernel verificável e QEMU. Ele não é o loop de desenvolvimento diário e não foi duplicado para a migração.

O workflow aceita `workflow_dispatch` com `minimal|owner-development`. Em PR originado de `platform/remove-alpine`, seleciona `owner-development`; demais PRs continuam usando `minimal`. A ordem é deliberada:

1. resolver fingerprint e restaurar/construir o kernel canônico;
2. verificar o componente e sua ligação ao commit de integração;
3. localizar o `kernel-modules-<versão>.tar` exato;
4. expor archive/receipts ao build Owner;
5. construir e verificar o rootfs Buildroot;
6. executar QEMU com o kernel real;
7. publicar provenance e receipts observados.

Executar o gate pesado somente quando necessário:

1. manualmente durante marcos da migração;
2. no PR final de integração quando os paths afetados o exigirem;
3. depois de mudanças estruturais em Buildroot, kernel, EROFS, boot handoff, rede mínima ou payload físico de hardware.

O gate pesado não deve ser tornado obrigatório para mudanças comuns de Surface, apps, contas, Spaces ou Web que não alterem os owners de plataforma.

## Fases

### Fase A — isolamento operacional

- [x] criar `platform/remove-alpine` a partir da `main` atual;
- [x] adicionar gate rápido sem build completo;
- [x] preservar o workflow pesado existente como prova de integração;
- [x] congelar a fronteira de novos consumidores de `alpine_core.py`;
- [x] remover o wrapper legado `bootstrap/dev-base/_build_core.py`, que apenas reexportava `alpine_core.py` e preservava monkey-patching histórico sem consumidor ativo;
- [ ] manter a branch atualizada com `main` sem reescrever histórico compartilhado.

### Fase B — paridade da base

Provar que a Independent Base cobre os requisitos hoje atendidos pela base Alpine antes de retirar qualquer owner legado:

- boot/handoff compatível;
- rede mínima e Wi-Fi necessários ao bootstrap;
- CA trust e aquisição de conteúdo assinado;
- Git no perfil Owner/Development quando exigido pelo contrato vigente;
- EROFS somente leitura;
- persistência e recovery fora do rootfs imutável;
- firmware/drivers conforme owners canônicos;
- suporte ao runtime da Surface sem introduzir gerenciador de pacotes no runtime base.

#### Perfil Owner/Development no mesmo owner Buildroot

A paridade do Dev USB não cria outra distribuição nem outro builder. `source.json` registra dois perfis do mesmo owner:

- `minimal`: prova portátil mínima já existente;
- `owner-development`: o mesmo defconfig base mais `configs/owner-development.fragment`.

O fragmento Owner/Development declara as capacidades de userspace necessárias ao Dev USB — CA certificates, Git, `iw`, `wpa_supplicant` e `wpa_passphrase` — e o provider `linux-firmware` com as famílias necessárias ao baseline atual. `kmod` não foi adicionado porque `/sbin/modprobe` já pertence à base BusyBox canônica; `zstd` também não foi carregado, porque era uma necessidade do antigo fluxo Alpine de materialização de firmware e não existe consumidor comprovado no runtime Owner atual.

As famílias de firmware vivem somente no fragmento Buildroot. `build.py` não mantém uma segunda lista: aceita apenas símbolos no namespace `BR2_PACKAGE_LINUX_FIRMWARE...` além do conjunto fixo de userspace e exige que cada símbolo declarado sobreviva à resolução Kconfig.

`build.py` aceita `--profile minimal|owner-development`. Defconfig e fragmento usados entram na provenance com SHA-256, e `BR2_ROOTFS_POST_SCRIPT_ARGS` transmite a identidade do perfil de forma explícita ao único `post-build.sh`; não existe detecção por presença acidental de binários.

O Kconfig real do Buildroot 2026.08 já foi resolvido para os dois perfis no Fast Gate, inclusive o provider/famílias de firmware Owner. Isso prova resolução de configuração, não funcionamento físico nem paridade final.

`post-build.sh` instala os helpers canônicos `ordax-network`, `ordax-pull`, `ordax-rollback`, `ordax-run`, `ordax-diagnose`, `ordax-dev-init` e recovery diretamente de seus owners existentes somente no perfil `owner-development` e apenas quando o target contém o conjunto completo de capacidades exigidas. Presença parcial falha fechada; o perfil `minimal` falha se capacidades Owner vazarem para ele.

#### Hardware Owner/Development sem segundo SSOT

O baseline Wi-Fi não é redefinido pela Independent Base. A autoridade existente é `docs/contracts/hardware-support-matrix.json`, entrada `wifi-after-base-start`, que define módulos, coldplug e limites de claim.

O kernel continua sendo construído exclusivamente por `bootstrap/kernel/`; seu `kernel-modules-<versão>.tar` é um componente verificável separado. A Independent Base não compila outro kernel e não mantém outra lista de módulos.

`bootstrap/base/kernel_module_payload.py` é a fronteira neutra criada para consumir esse artefato:

1. lê os módulos exigidos diretamente da hardware matrix;
2. rejeita TAR inseguro e exige uma única identidade de release;
3. usa kmod/modprobe e o `modules.dep` do próprio artefato para resolver dependências;
4. materializa somente módulos selecionados + metadata necessária no target;
5. emite receipt com SHA-256 do arquivo de módulos, hardware matrix e arquivos instalados;
6. não baixa nada e não constrói kernel.

O perfil `owner-development` exige `ORDAX_HOST_PYTHON`, `ORDAX_KERNEL_MODULES_ARCHIVE`, `ORDAX_KERNEL_MODULES_RECEIPT` e `ORDAX_FIRMWARE_COVERAGE_RECEIPT`. Não existe fallback que construa ou baixe um segundo kernel.

Após materializar os módulos, o mesmo post-build executa `bootstrap/base/firmware_policy.py check`. A política compartilhada lê as declarações `firmware=` dos módulos selecionados e exige cobertura real no target; se qualquer módulo que requer firmware ficar sem alternativa utilizável, o build Owner falha antes de produzir uma candidata.

Os dois receipts externos são incorporados **com os mesmos bytes** ao rootfs antes da geração da imagem:

- `/etc/ordax/kernel-module-payload.json`;
- `/etc/ordax/firmware-coverage.json`.

`cmp -s` exige identidade entre cada receipt externo e sua cópia embutida. Como `provenance.json` autentica `independent-base.erofs` por SHA-256, a candidata imutável passa a vincular transitivamente os receipts, o archive de módulos, a hardware matrix e os firmwares observados sem criar um segundo sistema de provenance.

**Ainda pendente antes de remover `dev-base/build.py`:** executar o build real `owner-development` com o componente de kernel já verificado, passar a prova QEMU e depois registrar prova física no Dev USB/hardware alvo. Somente depois desses gates a dependência Alpine do Dev Base pode sair da allowlist e o builder antigo pode ser removido.

### Fase C — convergência dos consumidores

Migrar consumidores que ainda importam `bootstrap/base/alpine_core.py` ou assumem APK/Alpine para APIs e artefatos neutros de distribuição.

A fronteira Python atual, congelada pelo teste de regressão, é:

- `bootstrap/dev-base/build.py`;
- `bootstrap/stable-base/build.py`;
- `bootstrap/surface-runtime/build.py`;
- `bootstrap/surface-runtime/discover_lock.py`;
- `bootstrap/windows-compat-runtime/configure_probe.py`.

A fronteira caiu de seis para cinco consumidores com a remoção do wrapper legado. Referências de compliance, cache, contratos, testes e evidência podem continuar descrevendo Alpine enquanto ele ainda existe, mas não podem criar novo consumidor de runtime/base.

A ordem deve reduzir duplicação, não criar wrappers permanentes:

1. identificar dependências reais de Alpine;
2. separar responsabilidade genérica de responsabilidade específica da distro;
3. mover lógica genérica para owner neutro somente quando houver mais de um consumidor legítimo;
4. migrar primeiro consumidores cuja semântica já exista na Independent Base;
5. migrar `dev-base`, `stable-base`, `surface-runtime` e compatibilidade Windows conforme seus gates específicos;
6. remover wrappers de compatibilidade assim que o último consumidor desaparecer;
7. reduzir a allowlist de `test_alpine_removal_boundary.py` no mesmo commit que elimina cada referência.

Não é permitido reduzir a contagem apenas trocando o nome do arquivo importado, copiando helpers Alpine para outro diretório ou duplicando lógica. A redução só conta quando a dependência real de Alpine/APK diminui ou quando código legado comprovadamente sem consumidor é removido.

### Fase D — prova sem Alpine

A candidata deve falhar fechada se contiver qualquer dependência Alpine residual relevante.

Provas mínimas:

- ausência de `/etc/alpine-release`;
- ausência de `/sbin/apk` e `/lib/apk`;
- ausência de minirootfs Alpine como entrada da base promovível;
- boot QEMU real com kernel canônico;
- rede/bootstrap funcional;
- Surface/runtime compatível pelos contratos existentes;
- recovery/rollback preservados;
- provenance e inventário de terceiros atualizados.

### Fase E — corte final

Somente após todos os gates:

1. alterar os contratos canônicos para declarar a base independente como owner ativo;
2. remover referências Alpine dos builders ativos;
3. remover arquivos Alpine sem consumidores;
4. atualizar compliance, inventário de terceiros e documentação canônica;
5. executar prova pesada final;
6. integrar por PR em `main`;
7. apagar a branch temporária.

## Regra de não bloqueio

Mudanças normais do produto não devem depender da conclusão da migração. Uma mudança em `system/`, Surface, apps ou Web não deve reconstruir Buildroot/kernel se seus contratos não mudaram.

Da mesma forma, a migração não pode mascarar falhas usando mocks, bypasses, downloads sem hash, estado local do desenvolvedor ou passos manuais não reproduzíveis.

## Cache e builds longos

A otimização correta é reutilizar componentes autenticados e content-addressed, não pular verificação. Os workflows de boot já reutilizam o kernel verificado por fingerprint. Próximas otimizações devem priorizar cache seguro de downloads e componentes Buildroot cuja identidade seja derivada de inputs versionados.

Não compartilhar diretórios mutáveis de build entre commits como se fossem artefatos verificados.

## Documentação canônica relacionada

A política geral permanece nos owners existentes:

- `docs/DEVELOPMENT-WORKFLOW.md` — branch temporária e loop de desenvolvimento;
- `docs/BUILD-AUTONOMY.md` — separação entre gates baratos e provas caras;
- `docs/contracts/hardware-support-matrix.json` — SSOT do baseline e limites de suporte físico;
- `bootstrap/independent-base/README.md` — estado e limites da implementação Buildroot;
- `docs/CURRENT-STATE.md` — só deve declarar a troca como estado corrente depois que o corte estiver integrado em `main` e comprovado; a existência desta branch não muda o estado Stable/canônico.

## Critério de conclusão

A migração termina quando Alpine deixa de ser dependência ativa do runtime/base canônico, os consumidores foram convergidos para owners neutros ou para a Independent Base, a prova completa passa e `main` volta a conter uma única implementação ativa sem compatibilidade Alpine residual desnecessária.
