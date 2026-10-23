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

#### Evidência Owner/Development de 2026-10-16

O run pesado `Independent Base Experiment #121` comprovou o build real `owner-development`: kernel canônico reutilizado e revalidado, archive de módulos exato, cobertura de firmware, Buildroot, `wpa_passphrase` em `/usr/sbin`, EROFS e provenance passaram. O mesmo SHA também passou `Independent Portable v2 Integration #97`, portanto o handoff portátil oficial com a candidata independente permanece verde.

A única falha de `#121` ocorreu no smoke direto de laboratório, antes do PID1 de prova: o serial registrou `Initramfs unpacking failed: write error` seguido de `VFS: Unable to mount root fs`. O `rootfs.cpio.gz` Owner observado tinha 79.756.629 bytes comprimidos e 199.650.304 bytes descomprimidos, enquanto o harness ainda fixava QEMU em 384 MiB. Esse harness carrega uma cópia completa do rootfs como initramfs **e** anexa o EROFS para provar imutabilidade/recovery; isso não é o caminho de boot portátil oficial e não define requisito mínimo de RAM do produto.

O orçamento do smoke direto passa a ser explícito por perfil: `minimal=384 MiB` e `owner-development=768 MiB`, registrado no receipt. O próximo run pesado deve provar esse ajuste; ele não substitui a prova portátil oficial, que já passou, nem a prova física.

**Ainda pendente antes de remover `dev-base/build.py`:** obter QEMU direto verde com o orçamento de laboratório corrigido e depois registrar prova física no Dev USB/hardware alvo. Somente depois desses gates a dependência Alpine do Dev Base pode sair da allowlist e o builder antigo pode ser removido.

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

O workflow **Independent Base Experiment** possui um job específico
`private-native-python` para a branch `platform/remove-alpine`. Ele roda
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
