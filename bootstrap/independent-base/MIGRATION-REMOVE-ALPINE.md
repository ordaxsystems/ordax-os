# Migração para base independente — remoção do Alpine

## Objetivo

Remover Alpine/APK do runtime base do OrdaX OS sem bloquear o desenvolvimento normal do produto e sem criar uma segunda arquitetura.

A implementação reutiliza exclusivamente o owner existente `bootstrap/independent-base/`, baseado em Buildroot, e permanece subordinada aos contratos canônicos do repositório.

## Autoridade e branch de trabalho

- `main` continua sendo a única source authority do produto.
- `integration/dev-usb-buildroot-surface-20261024` é a única branch de integração desta migração, na PR #2243; `main` permanece a autoridade do produto. A antiga `platform/remove-alpine` não recebe novos cortes.
- A branch deve receber `main` regularmente e ser removida após a integração final.
- Nenhum artefato dessa branch é Stable, release física ou autorização de gravação por existir nessa branch.

## Política de CI

O desenvolvimento da migração usa dois níveis distintos.

### Gate rápido por push

`.github/workflows/remove-alpine-fast.yml` roda na branch `integration/dev-usb-buildroot-surface-20261024` para mudanças relevantes e valida contratos, testes unitários, sintaxe e a resolução real do Kconfig Buildroot sem compilar rootfs, kernel ou imagem USB inteira.

O gate executa `tests/test_alpine_removal_boundary.py`, que congela o conjunto atual de consumidores Python de `bootstrap/base/alpine_core.py`. Novos consumidores são proibidos; a allowlist só pode encolher à medida que a migração avança.

`tests/test_independent_owner_profile.py` trava a arquitetura do perfil Owner/Development: ele deriva do mesmo `ordax_minimal_defconfig`, adiciona capacidades declaradas em fragmento, reutiliza os helpers canônicos do Dev USB sem copiar sua lógica e exige que os receipts de módulos/firmware sejam embutidos exatamente no rootfs Owner.

`tests/test_kernel_module_payload.py` trava a fronteira neutra de hardware: módulos são derivados do `docs/contracts/hardware-support-matrix.json`, vêm exclusivamente do artefato `kernel-modules-<versão>.tar` do kernel canônico e dependências são resolvidas por kmod/modprobe, sem um segundo parser de `modules.dep`.

`tests/test_firmware_policy_neutral.py` prova que a política compartilhada de firmware é distribuição-neutra, falha fechada quando uma declaração `firmware=` não tem cobertura, rejeita caminhos inseguros e produz receipt com identidade SHA-256 sem baixar firmware por conta própria.

`tests/test_independent_heavy_workflow.py` trava a estrutura da prova cara: kernel canônico verificado antes do rootfs, archive de módulos exato, receipts externos explícitos, mesmo perfil no build/verify e upload das evidências de hardware.

O gate rápido executa `build.py resolve` para `minimal`, `owner-development` e `stable-mvp`. Esse comando baixa/autentica a fonte Buildroot pinada, executa `defconfig` e verifica o `.config` resultante; ele registra explicitamente que não compilou rootfs nem kernel.

Objetivo: permitir ciclos normais de desenvolvimento em minutos, sem transformar cada commit em build completo e sem permitir que a dependência Alpine cresça durante a remoção.

### Gate pesado

`.github/workflows/independent-base-experiment.yml` continua sendo a única prova pesada existente, com Buildroot, kernel verificável e QEMU. Ele não é o loop de desenvolvimento diário e não foi duplicado para a migração.

O workflow aceita `workflow_dispatch` com `minimal|owner-development|stable-mvp`. A seleção automática em PR continua sendo `owner-development`; a candidata Stable só é provada por despacho explícito, nunca por um push comum. A ordem é deliberada:

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

- [x] reutilizar a branch de integração da PR #2243, sem PRs/branches paralelas;
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

A paridade do Dev USB não cria outra distribuição nem outro builder. `source.json` registra três perfis do mesmo owner:

- `minimal`: prova portátil mínima já existente;
- `owner-development`: o mesmo defconfig base mais `configs/wifi-hardware.fragment` e o delta Dev `configs/owner-development.fragment`.
- `stable-mvp`: o mesmo defconfig mais **somente** `configs/wifi-hardware.fragment`, sem Git, helpers Dev ou permissão de promoção; não substitui ainda o produtor Alpine ativo.

O fragmento Owner/Development declara as capacidades de userspace necessárias ao Dev USB — CA certificates, Git, `iw`, `wpa_supplicant` e `wpa_passphrase` — e o provider `linux-firmware` com as famílias necessárias ao baseline atual. `kmod` não foi adicionado porque `/sbin/modprobe` já pertence à base BusyBox canônica; `zstd` também não foi carregado, porque era uma necessidade do antigo fluxo Alpine de materialização de firmware e não existe consumidor comprovado no runtime Owner atual.

As famílias de firmware vivem somente no fragmento Buildroot. `build.py` não mantém uma segunda lista: aceita apenas símbolos no namespace `BR2_PACKAGE_LINUX_FIRMWARE...` além do conjunto fixo de userspace e exige que cada símbolo declarado sobreviva à resolução Kconfig.

`build.py` aceita `--profile minimal|owner-development|stable-mvp`. Defconfig e fragmento usados entram na provenance com SHA-256, e `BR2_ROOTFS_POST_SCRIPT_ARGS` transmite a identidade do perfil de forma explícita ao único `post-build.sh`; não existe detecção por presença acidental de binários.

O Kconfig real do Buildroot 2026.08 já foi resolvido para os três perfis no Fast Gate, inclusive o provider/famílias de firmware compartilhados entre Owner e Stable. Isso prova resolução de configuração, não funcionamento físico nem paridade final.

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

#### Evidência Owner/Development de 2026-10-16

O run pesado `Independent Base Experiment #121` comprovou o build real `owner-development`: kernel canônico reutilizado e revalidado, archive de módulos exato, cobertura de firmware, Buildroot, `wpa_passphrase` em `/usr/sbin`, EROFS e provenance passaram. O mesmo SHA também passou `Independent Portable v2 Integration #97`, portanto o handoff portátil oficial com a candidata independente permanece verde.

A única falha de `#121` ocorreu no smoke direto de laboratório, antes do PID1 de prova: o serial registrou `Initramfs unpacking failed: write error` seguido de `VFS: Unable to mount root fs`. O `rootfs.cpio.gz` Owner observado tinha 79.756.629 bytes comprimidos e 199.650.304 bytes descomprimidos, enquanto o harness ainda fixava QEMU em 384 MiB. Esse harness carrega uma cópia completa do rootfs como initramfs **e** anexa o EROFS para provar imutabilidade/recovery; isso não é o caminho de boot portátil oficial e não define requisito mínimo de RAM do produto.

O orçamento do smoke direto passa a ser explícito por perfil: `minimal=384 MiB` e `owner-development=768 MiB`, registrado no receipt. O próximo run pesado deve provar esse ajuste; ele não substitui a prova portátil oficial, que já passou, nem a prova física.

**Corte Dev em PR #2243:** o QEMU da Base Buildroot com perfil Owner foi aprovado e o builder Alpine `bootstrap/dev-base/build.py`, já sem consumidores de produção nos workflows, foi aposentado com seus testes de implementação obsoletos. A prova do USB Dev completo (dois boots offline, Surface WebKit e hardware físico) continua obrigatória antes de autorizar implantação, sem restaurar Alpine como fallback.

### Fase C — convergência dos consumidores

Migrar consumidores que ainda importam `bootstrap/base/alpine_core.py` ou assumem APK/Alpine para APIs e artefatos neutros de distribuição.

A fronteira Python atual, congelada pelo teste de regressão, é:

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
5. concluir os gates de `stable-base`, `surface-runtime` e compatibilidade Windows; o builder Alpine de `dev-base` já foi aposentado na PR #2243;
6. remover wrappers de compatibilidade assim que o último consumidor desaparecer;
7. reduzir a allowlist de `test_alpine_removal_boundary.py` no mesmo commit que elimina cada referência.

Não é permitido reduzir a contagem apenas trocando o nome do arquivo importado, copiando helpers Alpine para outro diretório ou duplicando lógica. A redução só conta quando a dependência real de Alpine/APK diminui ou quando código legado comprovadamente sem consumidor é removido.

### Primeira dependência Python do Runtime — prova HTTPX, não promoção

O `ordax-runtime` integrou a auditoria canônica de versões na PR #183
(commit `3d8f06211c1b991b9ac79604eff2e11bb14f47db`). Ela confirma a
incompatibilidade do lock Python 3.12 com CPython 3.14 e diferenças de
versões de dependências, inclusive o SDK MCP ausente no Buildroot.

Como avanço verificável **sem ignorar essas incompatibilidades**, o
`native-product-runtime.fragment` privado inclui
`BR2_PACKAGE_PYTHON_HTTPX=y`, cuja receita oficial Buildroot 2026.08
contém a versão `httpx 0.28.1` também presente no lock do Runtime. A
compilação e o smoke test exercitam os imports de `httpx`, `httpcore`,
`anyio`, `certifi`, `idna` e `h11` dentro do target do Buildroot, e
constroem uma requisição HTTPS **sem efetuar conexão de rede**.

Esta é uma **prova de dependência isolada**, não um upgrade arbitrário do
Runtime: versões transitivas podem divergir (por exemplo, `anyio` e
`certifi`). O recibo sempre registra
`httpx_offline_request_construction_proven` separadamente e
`runtime_dependency_versions_reconciled=false`. Não são gerados pacotes
instaláveis, carregadores globais, tokens nem uma segunda implementação
de agente/transportes MCP. Faltam compatibilizar os locks, a closure
completa C/Rust e o SDK MCP ausente antes do corte do Alpine.

### Prova de compilação privada do Python — sem distribuição

O subcomando `build-component` reutiliza a **mesma**
`configure_buildroot` usada pelos dois perfis oficiais de imagem,
inclusive a origem Buildroot autenticada, o kernel/header pinado e a
validação do Kconfig. Diferentemente de `build --profile owner-development`,
o subcomando compila **somente no diretório temporário de prova** e não
produz EROFS, pacote publicável nem imagem de boot. O único arquivo gerado
fora desse ambiente é `native-python-provenance.json`.

```sh
python3 bootstrap/independent-base/build.py build-component \
  --out /tmp/ordax-native-python-proof --cache /tmp/ordax-buildroot-cache --jobs 4
python3 bootstrap/independent-base/build.py verify-component \
  --out /tmp/ordax-native-python-proof
```

O verificador executa `readelf` no Python e nos ELF reais produzidos pelo
Buildroot e exige interpretador musl **dentro da configuração privada**,
`DT_NEEDED` correspondentes a bibliotecas do target, standard library,
módulos `_ssl`, `_hashlib`, `zlib` e CA. O recibo lista esses requisitos,
hash do CPython, quantidade de ELF e fingerprint do conjunto examinado.
Uma execução bem-sucedida é **prova de compilação/ABI**, não prova de
linkagem dos wheels ou de empacotamento do `ordax-runtime`.

O workflow **Independent Base Experiment** ainda possui um job histórico
`private-native-python` limitado à antiga branch `platform/remove-alpine`; ele não é acionado na branch canônica atual. Quando executado, roda
o compilador real e publica **somente esse recibo não instalável**; não
assina nem distribui `rootfs.tar`, loader, módulos ou artefato de serviço.
O kernel e os perfis estáticos do sistema não são reconstruídos por esse job.

Faltam, antes de remover o builder Alpine do agente: compilar as dependências
Python nativas do **mesmo** `ordax-runtime` pela toolchain Buildroot,
empacotar uma closure sem caminhos globais de loader, realizar autoteste
offline do MCP, auditar assinatura/procedência, instalar pelo supervisor
canônico e comprovar desafio atestado no dispositivo. Não misturar a
verificação do CPython isolado com autorização de distribuição.

### Insumo privado de build gerado pelo mesmo Buildroot

O `build-component` pode produzir opcionalmente uma **cópia exata** do
`br-output/images/rootfs.tar` privado, como `native-python-build-input.rootfs.tar`.
Essa saída **não** é o rootfs do OrdaX OS nem uma distribuição instalável.
Ela existe para que `ordax-runtime` audite os bytes e a ABI efetivamente
compilados, sem criar um segundo produtor Buildroot. A opção é:

```sh
python3 bootstrap/independent-base/build.py build-component \
  --out /tmp/ordax-native-python-proof --cache /tmp/ordax-buildroot-cache \
  --jobs 4 --export-private-build-input
python3 bootstrap/independent-base/build.py verify-component \
  --out /tmp/ordax-native-python-proof
```

O recibo `private_target_build_input` registra SHA-256, tamanho e o hash do
executável Python **dentro do próprio TAR Buildroot**; o verificador recusa
binários incompatíveis, ausência do loader/certificados, arquivos alterados ou
caminhos de origem simbólicos. O workflow da branch de migração publica apenas
esses **insumos privados não instaláveis**, com retenção limitada.

Esse artefato **não contém uma toolchain de compilação cruzada exportada** e
não prova o Runtime completo. Ele permite auditar e desenvolver a closure
privada, mas a compilação das extensões deve ocorrer contra a toolchain
canônica do *mesmo Buildroot*; nenhum consumidor deve descompactá-lo sobre
`/`, `/lib`, o slot do OS ou USB. Gates de assinatura, supervisor, QEMU do
agente e sessão MCP permanecem bloqueados.

### SQLite privado obrigatório para o Runtime Native

O `ordax_core` canônico importa `sqlite3` em `MemoryStore` e
`OrchestratorStore`. A execução isolada do Python privado Buildroot 3.14.7
publicado anteriormente falhou com `ModuleNotFoundError: No module named
'sqlite3'`. A configuração **exclusivamente do componente privado** passa
a exigir `BR2_PACKAGE_PYTHON3_SQLITE=y` e `BR2_PACKAGE_SQLITE=y`, sem
modificar o OS estático ou instalar outro banco.

O auditor exige os bytecodes `sqlite3`, a extensão ELF `_sqlite3` e
o smoke executa criação/inserção/consulta num banco `':memory:'` usando
o loader musl privado. `sqlite_memory_operational=true` é obrigatório
no recibo, sem conceder autorização para instalar ou ativar o MCP.

### SDK privado para compilar o agente, sem duplicar Buildroot

A mesma execução canônica de `build-component` pode exportar o SDK oficial
do Buildroot com `--export-private-build-input --export-private-sdk`.
Depois de compilar o componente, o owner executa `make sdk` **no mesmo
`O=br-output`**, usando `BR2_SDK_PREFIX=ordax-native-product-runtime-sdk`.
Esse alvo upstream exporta compilador cruzado, headers e sysroot em
`ordax-native-product-runtime-sdk.tar.gz`; não há outra toolchain.

O recibo `private_sdk_build_input` vincula SHA-256, tamanho, identificador
de SDK e SHA do Python privado já comprovado. O verificador lê TAR e SHA pelo
mesmo descritor, exige `relocate-sdk.sh`, metadata de relocation, compilador
x86_64/musl e header no sysroot, e falha em caso de alteração ou falta de
arquivos obrigatórios. O SDK fica restrito ao artefato privado do CI, é um
**insumo de compilação**, e jamais deve ser instalado no OS, empacotado no
USB ou autorizado como Runtime.

O consumer `ordax-runtime` deverá fazer extração segura em diretório
de build isolado, executar `relocate-sdk.sh` dentro dele, conferir o
contrato de SDK e compilar o mesmo agente contra esses headers e bibliotecas.
A existência do SDK não comprova o grafo de imports, a compatibilidade
Python 3.14, a assinatura do agente, a execução em QEMU ou a sessão MCP.

### Python do MCP como componente, sem contaminar a base estática

A configuração real do **Buildroot 2026.08** proíbe
`BR2_PACKAGE_PYTHON3=y` quando `BR2_STATIC_LIBS=y`. O sistema de base do
OrdaX continua com musl estático. A solução não é adicionar o Python à base
nem trocar Alpine por outra distribuição: o Python pertence ao **componente
privado do único `ordax-runtime`**, com musl dinâmico e bibliotecas produzidos
pela **mesma fonte Buildroot**, sem APK nem gerenciador de pacotes no sistema.

No mesmo owner `bootstrap/independent-base/` foi registrado
`component_profiles.native-product-runtime`; ele herda arquitetura,
musl e headers do contrato da base e usa somente
`configs/native-product-runtime.fragment`, que declara bibliotecas
compartilhadas, Python3, módulos SSL/zlib e CA. Este perfil **não** faz
parte de `profiles.minimal` ou `profiles.owner-development` e não pode
importar overlay, hooks de boot, firmware ou serviços da base.

O fluxo rápido existente executa:

```sh
python3 bootstrap/independent-base/build.py check-component
python3 bootstrap/independent-base/build.py resolve-component --cache /tmp/ordax-independent-resolution-cache
```

O segundo comando usa o Buildroot upstream já pinado com SHA-256 e verifica
o **Kconfig resolvido de verdade**; não compila Python, não instala nada,
não modifica USB nem concede permissão de assinatura. Os testes
`tests/test_independent_native_component.py` impedem que o perfil
contamine a base ou aceite configuração silenciosamente descartada.

**Ainda necessário para o Runtime de produção:** compilar o Python e sua
closure a partir da toolchain canônica; incluir os módulos nativos das
dependências do `ordax-runtime` (não só CPython); provar a resolução
isolada do ELF loader e `DT_NEEDED` dentro do componente; empacotar em
artefato imutável com hash, assinar pelo canal oficial; ativar o mesmo
`ordax-product-agent` supervisionado e comprovar desafio MCP e execução
no USB. Não produzir symlinks globais para o loader, adicionar minirootfs,
instalar pip no boot, copiar wheels do host indiscriminadamente ou substituir
a implementação canônica por outro agente.

### ABI de todo o userspace e Product Runtime

O builder da Independent Base verifica **todos os ELF de processo no target**
(compilados e copiados), não apenas `/sbin/ip`. A verificação recusa
`PT_INTERP` e entradas `DT_NEEDED` e registra
`independent_userspace_elf_closure` no único `provenance.json` da base,
com número de executáveis examinados e SHA-256 do manifesto nome/hash dos
ELF. Arquivos `ET_REL` de módulos do kernel não são programas userspace e
não requerem um carregador de processos. O gate rápido mantém testes de
regressão que rejeitam loader dinâmico, bibliotecas externas e arquitetura
errada. A **comprovação do target real** precisa ocorrer no workflow
Buildroot/QEMU pesado, não é inferida dos testes sintéticos.

O Product MCP continua sendo um **único** `ordax-runtime`: o candidato
PyInstaller atual ainda usa Alpine como construtor e depende de musl/zlib
dinâmicos. Seu auditor upstream (integrado em `ordax-runtime#181`) registra
`independent_base_abi_ready=false` e as dependências exatas no mesmo
`candidate.json`; portanto esse binário não pode entrar na base estática,
nem ser promovido como componente nativo da Independent Base.

O trabalho subsequente é produzir o **mesmo** Runtime a partir da toolchain
independente, provar sua biblioteca Python e os módulos nativos e validá-lo
pelo gate ELF **antes** da distribuição assinada, instalação e prova física.
Não copiar loader Alpine, não adicionar segunda distribuição, não falsificar
receipt de ABI e não criar um segundo agente/dispatcher para contornar a
ausência de um binário compatível.

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

## Checkpoint validado — 1º de novembro de 2026 (PR #2243)

- O corte Dev/Base e o Surface runtime Buildroot já estavam implementados; `tests/test_alpine_removal_boundary.py` permite **somente dois** consumidores Python diretos de `bootstrap/base/alpine_core.py`: `bootstrap/stable-base/build.py` e `bootstrap/windows-compat-runtime/configure_probe.py`.
- `749bea44`: declarações Wi-Fi/firmware concentradas em `configs/wifi-hardware.fragment`, mantendo os 36 símbolos Kconfig anteriormente declarados no Owner sem duplicação.
- `c30446c8`, `1bfb515c`, `3244456b`: candidato `stable-mvp` no **mesmo** produtor Buildroot, com módulos/firmware provenientes do kernel canônico e sem Git ou helpers Dev.
- `4e544631`, `d817e602`: cache específico `independent-base-stable` com fingerprint do kernel e dos inputs de hardware, validação de perfil/provenance e proteção contra promoção.
- `01cd203b`, `6aa8970d`, `00a11062`: workflow pesado existente preparado para despacho explícito `stable-mvp`, cache separado e evidências específicas. Na execução Stable, **kernel cache miss falha fechado**; não existe rebuild automático do kernel ou USB.
- Gate rápido `Remove Alpine Fast Gate #41362761337`: **PASS** em contratos, testes unitários, sintaxe e Kconfig real dos três perfis; sem compilação de kernel, rootfs completo ou USB.
- `8d560b58`, `dcab880f`: corrigido o desvio de fluxo de controle `else` no `post-build.sh` Stable. O teste executa a seleção `stable-mvp` e exige falha fechada sem os receipts canônicos; `sh -n` sozinho não detectava a falha.
- `471c6afe`, `9a43d2a6`: os diretórios de runtime/montagem definidos uma única vez em `bootstrap/stable-base/source.json:rootfs.runtime_directories` passam por `bootstrap/base/stable_runtime_layout.py`. Builder Alpine atual e candidato Buildroot usam o mesmo owner; links simbólicos inseguros e modo `/tmp` incorreto são rejeitados.
- `e4970f26`: o limite `rootfs.maximum_unique_regular_bytes` também é verificado no Buildroot e reutilizado no builder Stable antigo; a implementação antes presente em `alpine_core.py` deixou de ser consumida pelo Stable.
- `c3031be8`: teste real de subprocesso do CLI neutro (`install`/`check`/rejeição de `/tmp` sem `1777`). Gate rápido `#41363882646`: **PASS, 200 testes**, Kconfig de três perfis, sem builds de kernel/rootfs completo/USB.
- **Ainda pendente:** build real de EROFS Stable e receipts, QEMU real do perfil Stable, boot Portable v2 assinado, rollback/segurança e eventual prova física. A execução pesada Stable **não foi disparada nesta etapa**; nenhuma evidência foi presumida.
- O builder Alpine `bootstrap/stable-base/build.py` permanece como consumidor ativo até que a paridade seja provada e o corte ocorra. `bootstrap/windows-compat-runtime/configure_probe.py` será migrado separadamente. **Não apagar** `alpine_core.py`, APK locks, workflows ou contratos enquanto houver dependências operacionais.
- Sem fallbacks, sem segunda PR/branch e sem alterar flags de autorização de publicação.

### Continuação: ponte Stable → boot Portable assinado (1º de novembro de 2026, Bahia)

- `14ed0ccc`: `portable_boot_proof.py` aceita **explicitamente** `--base-profile stable-mvp`, verifica provenance desse perfil no próprio produtor e rejeita a seleção `owner-development`. O padrão `minimal` permanece inalterado.
- `e9327480`: o workflow reutilizável existente `.github/workflows/portable-v2-qemu-boot-proof.yml` passou a receber `independent_base_profile`. A execução da candidata `stable-mvp` é exclusiva de `workflow_dispatch`, com `base_source=independent`; não se ativa por PR nem altera o produtor Stable antigo. Usa os mesmos owners de assinatura Ed25519, Portable PID1, EROFS, ext4, recuperação, QEMU/OVMF e rollback já existentes. **Não** há outro fluxo de boot.
- `.github/workflows/independent-portable-v2-integration.yml` expõe `workflow_dispatch` com `base_profile=stable-mvp`; mantém `minimal` como padrão. O kernel do Stable exige cache previamente verificado e, na ausência, a execução falha antes de compilar. A Base Buildroot é produzida com `--profile stable-mvp`, receipts de módulos e firmware e verificação do mesmo perfil; o adaptador de boot exige essa mesma identidade.
- `cdc4fc24`: o hook Buildroot rejeita Git, workspace e auxiliares Dev **antes** do trabalho caro de módulos/firmware. O teste executa o hook com um payload Dev proposital e comprova a rejeição, sem gerar imagem fictícia.
- Gate rápido `#41364914372`: **PASS — 203 testes**, Kconfig autêntico dos três perfis, contratos e sintaxe; sem build de kernel/rootfs completo/USB.
- **Bloqueio preservado:** o novo caminho Stable para Portable/QEMU **ainda não foi executado** e nenhum artefato Stable real foi atestado por esse gate. A aprovação acima valida implementação e contratos, **não** equivalência de boot, assinatura, UEFI nem rollback. Antes de retirar `bootstrap/stable-base/build.py`, usar a prova pesada do workflow oficial com `base_profile=stable-mvp` e verificar os recibos reais de imagem, assinatura, boot e falha/rollback. Secure Boot físico e promoção permanecem gates separados. Não substituir `alpine_core.py`, APK locks nem workflows enquanto o Stable e Windows Compat forem consumidores.

### Checkpoint — cache e provenance no boot assinado Stable (1º de novembro de 2026, Bahia)

- `bd215fd8`: workflow Portable/QEMU oficial reutiliza o cache **`independent-base-stable`** já existente, com a mesma chave derivada do fingerprint de inputs e do kernel canônico. Em cache hit, evita recompilar o Buildroot; em cache miss, constrói uma vez, registra manifesto e verifica os bytes antes de persistir o cache. Em ambos os casos, o EROFS é verificado antes da montagem. Nenhum novo produtor, workflow ou fallback.
- A ponte canônica `portable_boot_proof.py` agora recebe `--reuse-receipt` somente para `stable-mvp`. Ela **reexecuta** `tools/ci/portable_component_cache.py:verify_component` no checkout atual, exigindo mesmos inputs, ambiente e conjunto exato de arquivos, enquanto preserva a provenance original do commit em que o rootfs foi compilado. O recibo da integração referencia esse commit original e o commit atual separadamente. Não reescrever `provenance.json` para fingir nova compilação.
- `af49930d`: teste unitário executa o verificador real usando arquivos mínimos, valida reuse entre dois commits compatíveis e recusa recibo com commit alterado e artefato com bytes adulterados. O teste não afirma boot, assinatura ou compilação de EROFS de produção.
- `d3aff06a`: nome do receipt de módulos harmonizado com o workflow Buildroot independente existente: `kernel-module-payload.json` e `firmware-coverage.json`. O mesmo layout de arquivos do cache passa a ser usado nos dois workflows oficiais, sem duas fontes de verdade.
- `bedbed98`, `f782a3f3`: no mesmo workflow assinado, os caminhos de restore/save do rootfs Stable agora coincidem **exatamente** com os do produtor canônico (`$RUNNER_TEMP/ordax-independent`). Os dois cenários QEMU recebem a mesma raiz autenticada via variável da etapa de build. O caminho histórico do perfil `minimal` não mudou.
- `1601dd5f`, `f400cf4e`: também foi alinhado o cache de **fontes e pacotes baixados** (`$RUNNER_TEMP/ordax-independent-cache`), inclusive a chave derivada de inputs Buildroot. Só se restaura/grava quando um build Stable é realmente necessário; não equivale a cache de artefatos mutáveis ou a pular verificações.
- Gates rápidos `#41370304587` e `#41370432608`: **PASS — 204 testes** em ambos, contratos, sintaxe e resolução Kconfig real dos três perfis, sem compilação de kernel, rootfs completo nem USB. A regressão passa a exigir caminho e chave idênticos nos dois workflows.
- **Bloqueio em aberto:** falta executar e aprovar a prova pesada Stable no fluxo oficial (artefato EROFS real, assinatura/manifesto, QEMU direct-kernel e UEFI, falhas Ed25519 e rollback, hardware físico quando aplicável). A preservação de provenance e aprovação do cache **não** provam boot nem autorizam a remoção do produtor Stable Alpine. O consumidor separado Windows Compat também permanece intocado. As flags de promoção ficam falsas até prova real.

### Checkpoint — vínculo do kernel no boot Stable (1º de novembro de 2026, Bahia)

- `2e445205`: a ponte **já existente** `bootstrap/independent-base/portable_boot_proof.py` agora exige `--kernel-modules` somente para `stable-mvp`, junto com o `--reuse-receipt` verificado. A seleção `minimal` e os owners Portable PID1/assinatura/QEMU permanecem intactos.
- `bootstrap/base/kernel_module_payload.py:verify_kernel_archive_binding` é o único verificador neutro responsável por comparar os bytes do arquivo de módulos do kernel atestado ao SHA-256 registrado pelo produtor Buildroot; exige que `rootfs.tar` tenha um membro **regular e byte a byte idêntico** ao recibo externo `kernel-module-payload.json`, além de conferir baseline Wi-Fi canônico, schema, inventário, ausência de downloads/builder paralelo e restrição de caminhos. Não há novo kernel nem segunda lista de hardware.
- `518dfb2f`, `878a55d4`: testes executam de fato a função de vínculo em entradas descartáveis com recibos válidos, alteração do kernel, discrepância de recibos, escape de caminho e symlink. A contagem da chamada do QEMU foi corrigida para não confundir o build do próprio kernel. Gate rápido `#41371402847`: **PASS — 207 testes** (nenhuma compilação pesada).
- `e01f0c78`, `c24c5ba1`: o mesmo owner neutro agora percorre o `rootfs.tar` canônico e autentica **cada arquivo regular** do recibo `kernel-module-payload.json` por caminho exato, tamanho e SHA-256. Duplicatas, symlinks, módulos ausentes, conteúdo alterado e caminhos não canônicos falham fechados. Testes de fixture verificam o algoritmo sem fingir uma imagem de boot. Gate rápido `#41372088662`: **PASS — 210 testes**, três resoluções Kconfig reais e sintaxe; zero builds de kernel/USB/EROFS completo.
- A checagem de kernel e recibo só autoriza **continuar a prova assinada**, nunca promover o Stable. Permanecem faltando EROFS real, QEMU direto e UEFI, rollback/assinatura e gates físicos; não retirar Alpine Stable nem o segundo consumidor Windows Compat antes das evidências.

### Checkpoint — vínculo integral de módulos com o kernel fonte (1º de novembro de 2026, Bahia)

- `896e7151`: a mesma função neutra `bootstrap/base/kernel_module_payload.py:verify_kernel_archive_binding` não se limita a conferir o recibo independente e os arquivos `rootfs.tar`. Agora ela abre o **tar original do kernel canônico verificado pelo workflow**, confere os bytes de cada módulo e metadado selecionado contra os hashes e tamanhos esperados, e rejeita duplicação, módulo ausente, objeto não regular ou substituição. A comparação com o rootfs permanece obrigatória; os dois lados devem corresponder à mesma fonte, sem nova lista de hardware ou produção de kernel.
- Testes executam de fato o verificador usando dois arquivos TAR pequenos. Um caso negativo altera **simultaneamente** o recibo e o rootfs para que concordem entre si, mas a origem kernel canônica intacta bloqueia a aprovação. Outros recusam ausência ou duplicação de arquivos no TAR fonte, preservando os demais cenários de corrupção, symlinks e caminhos inseguros.
- `1d8d3785`: o teste antigo de divergência do recibo foi ajustado para reconhecer o erro mais estrito emitido pela nova verificação do kernel fonte.
- Gate rápido `#41373224677`: **PASS — 212 testes**, com Kconfig real dos três perfis e sintaxe; não compilou kernel, rootfs EROFS completo nem USB.
- **Atenção:** trata-se apenas de segurança e integridade pré-boot no mesmo pipeline. A execução pesada `stable-mvp` com EROFS real, assinatura Ed25519, QEMU/UEFI, falhas e rollback continua pendente; por isso o Stable Alpine e o consumidor Windows Compat permanecem ativos, e as flags de promoção continuam falsas.

### Bloqueio da prova real e bootstrap explícito do cache (2 de novembro de 2026, Bahia)

- `1bd78de8`: adicionada entrada opt-in de **push exclusivamente na branch existente** `integration/dev-usb-buildroot-surface-20261024`, com marcador de commit `[stable-mvp-proof]`. O job de testes contratuais e o job Buildroot/QEMU existentes recebem `stable-mvp` apenas nesse evento marcado. O comportamento de PR draft, PR pronta, `workflow_dispatch` e `platform/remove-alpine` foi preservado; nenhuma publicação ou instalação é autorizada.
- Execução real `Independent Base Experiment #41383672044`: contrato inicial aprovado; o job Buildroot/QEMU parou **corretamente**, antes de compilar kernel e rootfs, por **cache miss** da chave do kernel canônico `ordax-portable-component-v1-Linux-X64-kernel-20ec1638758643a31ed20f193118abddfcc3d87e859fa4225ee6741be9de1998`. Portanto EROFS/QEMU continuam não comprovados. A verificação barata `Remove Alpine Fast Gate #41383671919` executou em paralelo.
- Para romper somente este bloqueio factual, um novo commit opt-in pode incluir **ambos** `[stable-mvp-proof]` e `[stable-mvp-bootstrap-kernel]`. A segunda marca autoriza, nesta branch apenas e **somente no cache miss**, **uma** compilação canônica via `bootstrap/kernel/build.py build` já existente, seguida dos verificadores de provenance e manifesto e salvamento no mesmo cache com SHA de inputs. Não é um segundo produtor, nem fallback que pule validação; os demais eventos Stable continuam impedidos de compilar kernel implicitamente. Após semear o cache, as próximas provas devem apenas reutilizar esse componente verificado.
- A prova real de Stable requer ainda construir/validar a Base EROFS, executar QEMU de persistência/recuperação, o Portable assinado/UEFI e os testes de falha/rollback. Não declarar migração concluída, não retirar Alpine/APK nem alterar autorização física antes dessas evidências.

### Prova Stable real em execução; boot assinado preparado sem concorrência (2 de novembro de 2026, Bahia)

- `5582fe07` acionou **uma única vez** o `Independent Base Experiment #41383902314` com `[stable-mvp-proof]` e `[stable-mvp-bootstrap-kernel]`. O contrato Buildroot passou; o cache ausente do kernel foi preenchido por uma compilação no produtor canônico, `bootstrap/kernel/build.py`, seguida de **PASS** no verificador de provenance, recibo de integração e salvamento do cache. A seleção e o vínculo dos módulos Wi-Fi também passaram. **Último estado observado nesta sessão:** `buildroot-qemu` ainda **in_progress** em `Build rootfs from official Buildroot source`. NÃO afirmar EROFS ou QEMU aprovados até o job encerrar. O gate barato `Remove Alpine Fast Gate #41383902253` passou com 212 testes.
- `a61b9a6b`: o workflow `.github/workflows/independent-portable-v2-integration.yml` passa a permitir **exclusivamente nesta branch** um acionamento de push com marcador de commit `[stable-mvp-signed-boot]`. O job de contrato e o job de prova assinada são ambos bloqueados quando o marcador não existe; na chamada do workflow oficial já existente, `independent_base_profile=stable-mvp` é forçado para esse evento. O workflow oficial `portable-v2-qemu-boot-proof.yml` aceita esta exceção **somente** quando `base_source=independent`, branch exata e marcador de push coincidem; os casos tradicionais `workflow_dispatch`, PR e base Stable mantêm seus gates. Isso **não** publica, não instala e não altera o kernel/sistema físico.
- Evidência de ausência de disparo indevido: `Independent Portable v2 Integration #41386401367` ficou **skipped** após o commit `a61b9a6b` sem marcador, enquanto `Remove Alpine Fast Gate #41386401403` ficou **PASS**. A compilação em andamento `#41383902314` não foi interrompida nem reiniciada.
- **Ordem obrigatória antes do próximo acionamento pesado:** verificar o desfecho completo de `#41383902314` e o recibo EROFS/QEMU de seu produtor, corrigir falhas reais sem descartá-lo ou recompilar por rotina, e apenas **depois de aprovado** fazer um commit documental/contratual na mesma branch com marcador `[stable-mvp-signed-boot]` para executar a prova oficial assinada, UEFI, seleção/segurança e rollback. Se a prova do produtor falhar, não acionar a assinada. Sem proof completo, nenhum corte Alpine/Windows Compat é autorizado.

### Prova QEMU do produtor concluída e início controlado do boot assinado (2 de novembro de 2026, Bahia)

- `Independent Base Experiment #41383902314`, HEAD `5582fe07f65314cb5ef8ed0d8957006b5e26156b`: **SUCCESS**. Compilação canônica do kernel com provenance/cache verificados, build real do rootfs `stable-mvp`, `fsck.erofs`, hardware Wi-Fi/firmware, verificação dos recibos do componente, cache Stable salvo. O job `QEMU real kernel, EROFS and ext4 persistence/recovery` foi **SUCCESS** e registrou no log `ORDAX_INDEPENDENT_QEMU_PROOF=PASS` com `boot_count=3`. O EROFS produzido tem SHA-256 `889057c7e257677a070e8f1ecd315c222dd370e1bcbd3171b76cd05116121ada`; isso é prova de **protótipo por direct kernel boot**, não equivalência oficial Portable/UEFI nem aprovação física. Artefato GitHub `ordax-independent-base-stable-mvp-41383902314`, ID `13115633283`, hash ZIP `sha256:0ccbee71c2e6160ae1268e3e393393593bfd91cdbb65e7e0046590847cf41cd1`, com expiração prevista em 9 de novembro.
- Com o produtor QEMU aprovado e o cache canônico semeado, este checkpoint solicita de forma **explícita** a prova de signed Portable v2 pelo marcador de commit `[stable-mvp-signed-boot]`. A autorização é **somente para CI/QEMU descartável**, usando o workflow oficial existente; continua vedada qualquer promoção Stable, USB físico ou remoção do Alpine/Windows Compat. O resultado da prova assinada deve ser observado diretamente na execução disparada antes de mudar o estado do produto.
- Gates de falha continuam obrigatórios: kernel cache validado (nenhum rebuild implícito), cache/provenance da Base, Ed25519, seleção e recuperação da release, QEMU/UEFI, one-shot rollback e cenário de imagem/assinatura adulterada. Se algum falhar, corrigir a causa na mesma branch e registrar o erro sem forçar sucesso.

### Validação do contrato Portable e nova prova assinada isolada (2 de novembro de 2026, Bahia)

- O primeiro disparo assinado `Independent Portable v2 Integration #41389023042` executou o contrato de fronteira com sucesso, mas o QEMU oficial **parou antes do build/boot** em `Validate portable-v2 QEMU contract`: o teste `test_independent_base_path_binds_verified_kernel_module_inputs` cortava o bloco de `independent)` no `*)` de um `case` interno, escondendo os comandos corretos; usava ainda o nome obsoleto `kernel-module-selection.json` em vez do recibo canônico `kernel-module-payload.json`.
- `8f474983` corrigiu o escopo desse teste para o **case externo**, conferindo os comandos reais e os dois caminhos de saída (`minimal` e `stable-mvp`), sem alterar a segurança da aplicação. O arquivo `tests/test_portable_v2_qemu_boot_proof_contract.py` foi adicionado ao **gate rápido por impacto**, junto com o workflow oficial de QEMU, para evitar novo desperdício de execução pesada para encontrar erros de asserção antigos.
- `Remove Alpine Fast Gate #41389207345`: **SUCCESS — 227 testes**, com os 15 contratos Portable/QEMU incluídos, Kconfig dos três perfis e sintaxe. Nenhum kernel/USB/EROFS foi recompilado por este gate.
- O marcador explícito `[stable-mvp-signed-boot]` deste checkpoint solicita nova execução **somente** do workflow oficial Portable, usando os caches/provenance já gerados pelo produtor `#41383902314`. As assinaturas, os cenários de falha, recuperação/rollback e o boot por OVMF permanecem obrigatórios. Continuam falsas as flags de promoção e instalação física.

### Contratos Portable e cache reconciliados antes da prova assinada (2 de novembro de 2026, Bahia)

- A tentativa assinada `Independent Portable v2 Integration #41389318398` passou pela verificação anterior de módulos e pelo contrato Portable inicial, mas encerrou ainda em testes pré-QEMU: `tests/test_portable_qemu_kernel_source_ssot.py` mantinha uma contagem fixa de três referências ao arquivo `kernel-modules-$ORDAX_KERNEL_VERSION.tar`. A arquitetura atual possui cinco referências legítimas, incluindo as duas passagens de parâmetros para o bridge Stable; a fonte canônica de versão permanece única. Nenhum boot assinado foi executado nessa tentativa.
- `0b535f1a`: o teste de versão passou a exigir o mínimo de referências canônicas, **duas** integrações explícitas com os cenários QEMU assinados e a proibição de versões de kernel embutidas; o gate rápido passou a executar os contratos de impacto e de Portable/QEMU sem iniciar QEMU. A primeira execução de teste ampliada revelou dois ajustes ainda necessários: contagem rígida de ações de cache no workflow e descoberta de imports da Surface externa ausente no checkout barato.
- `9396d1e2`: o teste de cache agora exige que **todas** as ações `actions/cache/restore`/`save` sejam fixadas no SHA canônico, sem fallback por prefixo, independentemente da quantidade legítima de componentes. O gate barato usa a **mesma** action `.github/actions/prepare-verified-surface` do QEMU oficial para materializar a Surface autenticada em checkout descartável; não cria uma cópia no repositório nem altera `ordax-surface`.
- `Remove Alpine Fast Gate #41389655838`: **SUCCESS — 338 testes**, incluindo todos os contratos Python prévios do Portable/QEMU, a árvore Native da Surface, e as resoluções reais Kconfig dos perfis Buildroot sem compilar kernel, rootfs ou USB.
- O marcador `[stable-mvp-signed-boot]` deste checkpoint solicita nova prova assinada no workflow oficial agora que os contratos baratos estão verdes. A verificação dos caches de kernel/Stable continua fail-closed; EROFS/QEMU de produtor continuam comprovados pelo `#41383902314`, mas **ainda não há prova de boot oficial assinado, OVMF/UEFI ou rollback**. Não habilitar promoção física, remover Alpine/APK ou alterar Windows Compat até esses gates.

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
