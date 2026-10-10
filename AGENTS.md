# AGENTS.md

Este arquivo e a entrada obrigatoria para qualquer IA, agente, Codex ou pessoa que trabalhe neste repositorio.

## 1. Identidade do repositorio
## Handoff transversal obrigatório — Intelligence / ChatGPT / Apps

Antes de alterar Intelligence, chat, plugins, MCP, Studio ou a UI global do OrdaX Web, leia [INTELLIGENCE-HANDOFF.md](INTELLIGENCE-HANDOFF.md). É um guia de retomada que aponta aos contratos e donos existentes, **não substitui os contratos canônicos**. Diferencie explicitamente **chat OrdaX → provedor** de **ChatGPT externo → plugin MCP → OrdaX** e não ative bridges experimentais nem crie outra autoridade em Apps/Lovable.



`ordaxsystems/ordax-os` é o **repositório oficial e canônico do OrdaX OS**. A identidade e os responsáveis atuais são definidos por `docs/contracts/repository-ownership.json` e `docs/contracts/repository-migration-status.json`.

O produto continua em desenvolvimento e homologação: a promoção/renomeação do repositório **não equivale à aprovação de uma release Stable/MVP**, assinatura, aceite físico ou autorização para publicação e gravação de dispositivos. Esses gates permanecem independentes; consulte `MVP.md` e `docs/PROMOTION-GATES.md`.

`washingtonmsdj/novo-ordax-os` e os slugs anteriores do repositório canônico são somente referências históricas e de proveniência, nunca uma segunda autoridade de desenvolvimento.

## 2. Fonte de verdade

- `main` e o unico source authority deste prototipo.
- Midia fisica, notebook, imagens, backups e copias locais nao sao source authority.
- Nenhuma alteracao fisica sem equivalente reproduzivel no source.
- Nao criar caminhos paralelos para a mesma responsabilidade.
- Codex nao e source authority, build authority ou release authority.

Para geometria fisica, os contratos machine-readable vencem texto historico: `docs/contracts/physical-media.json` define o seed bootstrap independente de capacidade e `docs/contracts/physical-prepared-media.json` define o USB fisico final preparado pelo Creator.

## 3. Ordem obrigatoria de leitura

Antes de alterar codigo, contratos ou midia:

1. `README.md`
2. `MVP.md`
3. `docs/README.md`
4. `docs/CURRENT-STATE.md`
5. `docs/ARCHITECTURE.md`
6. `docs/BUILD-AUTONOMY.md`
7. `docs/PRODUCT-MODES.md`
8. `docs/MINIMAL-USB-BOOTSTRAP.md`
9. `docs/HOST-INDEPENDENCE.md`
10. `docs/REMOTE-CONTROL.md`
11. `docs/OPERATIONAL-REALTIME.md`
12. `docs/MOBILE-COMPANION.md`
13. `docs/PHYSICAL-MEDIA.md`
14. `docs/DEVELOPMENT-WORKFLOW.md`
15. `docs/SOURCE-MIGRATION.md`
16. `docs/PROMOTION-GATES.md`
17. `docs/DECISIONS.md`

Quando um snapshot de estado conflitar com texto historico, `docs/CURRENT-STATE.md` e os contratos arquiteturais canonicos vencem. Para a separacao Owner/Development vs Stable/MVP, `docs/contracts/distribution-profiles.json` e a autoridade machine-readable. Para numero/geometria de particoes, os dois contratos fisicos acima sao a autoridade final porque descrevem artefatos diferentes.

Um snapshot canonico tambem nao pode vencer silenciosamente o proprio source atual. Antes de usar valores correntes como versoes, `releaseMode`, geometria de midia ou estado de uma capacidade, compare `docs/CURRENT-STATE.md` com os manifests/owners e contratos machine-readable correspondentes. Se divergirem, trate a documentacao canonica como defeito a corrigir na mesma mudanca; nao planeje trabalho novo em cima de uma afirmacao obsoleta.

### Ciclo de vida da documentacao

`docs/README.md` e o indice canonico da documentacao e define a hierarquia entre contratos, estado atual, decisoes, guias, planos, evidencias e historico. Nao criar um segundo documento ativo para uma responsabilidade que ja possui owner documental. Quando um documento for substituido, marcar explicitamente o sucessor e retirar o documento antigo da rota de leitura ativa; evidencias historicas permanecem em `docs/evidence/` e nunca viram source authority por envelhecerem bem. Remover ou arquivar somente depois de confirmar que referencias, testes e links nao dependem do caminho antigo.

### Plano funcional da Surface e dos aplicativos

Antes de planejar, implementar ou revisar a area de trabalho, a barra lateral ou os apps Arquivos, Ajustes, Conta e Sistema, leia e analise tambem [PLANO-FUNCIONAL-SURFACE-E-APPS.md](PLANO-FUNCIONAL-SURFACE-E-APPS.md), na raiz do repositorio, depois da leitura canonica acima.

O plano detalha telas, subsecoes, responsabilidades, lacunas, prioridades e criterios de aceite. Compare o inventario datado com a `main` atual antes de implementar; nao reconstrua recursos ja existentes nem trate sugestoes como capacidades prontas. Ele e uma proposta funcional: os contratos canonicos, os gates e as regras de seguranca continuam sendo a autoridade.

Leia tambem a continuacao [PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md](PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md) antes de ampliar essas interfaces, planejar novas capacidades ou reaproveitar funcionalidades/ideias de `novo-ordax-os`. Ela compara os dois repositorios com SHAs registrados, distingue codigo de visao futura e detalha lacunas, dependencias, destinos de interface e criterios de aceite. Nenhuma recomendacao desse documento constitui migracao concluida: qualquer portabilidade continua exigindo registro em `docs/SOURCE-MIGRATION.md`.

Antes de preparar ou autorizar o primeiro USB Stable/MVP, leia tambem [PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md](PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md). Ele revalida a visao da Nova OrdaX contra a `main` atual e separa requisitos funcionais obrigatorios pre-USB, provas que dependem do hardware fisico e capacidades conscientemente pos-MVP. O gate pre-USB desse documento deve falhar fechado: uma capacidade estrutural nao pode ser omitida apenas porque boot/release ja estao tecnicamente prontos.

### Web, Mobile, realtime e controle de dispositivos

Antes de criar backend de pedidos/produção, realtime, push, controle remoto de equipamentos,
PWA, APK ou integração Mobile, leia `docs/OPERATIONAL-REALTIME.md`, `docs/MOBILE-COMPANION.md`,
`docs/ACCOUNT-SYNC-AND-PLANS.md`, `docs/PRODUCT-MODES.md` e os contratos
`docs/contracts/operational-realtime.json`, `docs/contracts/mobile-companion.json` e `docs/contracts/device-agent.json`.

Sync de conta não é fila operacional; notification não é source of truth; push não é transporte
de comando; pedido remoto não cria autoridade. Web/Mobile/Desktop/Native devem compartilhar o
mesmo domínio e o mesmo Action Gateway, sem backend paralelo por plataforma.

### Site publico

Antes de alterar landing page, download, login/cadastro ou futura area publica da conta, leia `MVP.md`, `docs/PUBLIC-SITE.md` e `docs/contracts/public-site.json`.

O portal em `sites/public/` e um artefato separado do modo **OrdaX Web**. Nao importar a Surface para montar o site, nao duplicar identidade/conta e nao hard-codear uma release como "latest". Login/cadastro e download so ficam disponiveis quando seus owners reais estiverem configurados; o estado padrao deve falhar fechado sem credenciais, contas ou artefatos ficticios.


## 4. Arquitetura fisica alvo

O seed e o USB final preparado nao sao o mesmo artefato:

```text
BOOTSTRAP_SEED_PARTITIONS=2
SEED_ESP=ORDAX-ESP
SEED_MAIN=ORDAX

PREPARED_USB_PARTITIONS=3
PREPARED_ESP=ORDAX-ESP
PREPARED_MAIN=ORDAX
PREPARED_DATA=ORDAX-DATA

SEPARATE_HOME_PARTITION=NO
```

`ORDAX-DATA` e target-capacity-specific e e criado pelo Creator; ele nao pertence ao seed assinado/capacity-independent. Nao reintroduzir uma particao `ORDAX-HOME` ou `ORDAX-PLATFORM` sem decisao arquitetural registrada.

## 5. Um produto, cinco modos

```text
OrdaX Web
 -> OrdaX Mobile (Android / iPhone)
 -> OrdaX Desktop
 -> OrdaX USB
 -> OrdaX Native (SSD/HD)
```

Sao modos de capacidade do mesmo produto, nao forks.

Surface, apps e logica compartilhada possuem uma unica fonte em `system/`. Diferencas de ambiente vivem apenas em adapters de capacidade.

## 6. Pendrive inicial minimo

O bootstrap possui dois perfis deliberadamente distintos: o owner/development Git-first e o canonical signed-release. Ambos compartilham `main` como source authority e nao preinstalam o produto completo.

No owner/development Git-first, a base contem kernel/initramfs, drivers/firmware selecionados, rede, CA e Git; o checkout parcial/sparse de `system/` nasce em `/workspace/ordax` e mudancas normais nao exigem reflash. No perfil canonical, o bootstrap adquire e verifica uma release assinada antes de ativa-la.

O caminho canonical minimo continua:

```text
UEFI
 -> bootloader
 -> kernel/initramfs
 -> bootstrap minimo
 -> rede minima
 -> aquisicao de release assinada
 -> verificacao
 -> recovery
```

Nao sao obrigatorios antes da primeira release:

- SSH;
- OrdaX Remote Core;
- Control Plane;
- servico de identidade persistente;
- Surface/desktop;
- apps normais;
- servicos de alto nivel;
- checkout completo do source;
- toolchain de build;
- WSL/QEMU;
- dump do repositorio antigo.

Depois do primeiro boot canonical, a release completa deve ser adquirida, verificada e materializada em `/ordax/releases/<commit>`. Uma release conhecida deve permanecer local para boot offline e rollback.

## 7. Build autonomo e independente de Codex

Nenhum artefato pode depender de Codex, memoria de comandos manuais ou toolchain instalada na maquina do desenvolvedor.

```text
source em main
 -> receita versionada no repo
 -> ambiente de build fixado
 -> CI
 -> testes
 -> provenance + SHA-256
 -> artefato
```

Isso inclui kernel, initramfs, bootstrap, Surface e OrdaX Creator.

Regras:

- `CODEX_REQUIRED=NO`;
- `LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO`;
- `MANUAL_KERNEL_BUILD_REQUIRED=NO`;
- GitHub Actions e o executor atual, nao source authority;
- o entrypoint de build deve ser portavel para outro executor/container compativel;
- Codex pode ser parceiro opcional para revisao, investigacao fisica ou segunda opiniao;
- um build que depende de estado local nao documentado e defeito arquitetural.

O ambiente do kernel 6.6.52 ja possui imagem OCI por digest, snapshot APT, 17 versoes exatas de pacotes e prova repetida de hashes identicos. Isso fecha apenas o gate de ambiente reproduzivel; `physical_artifact_authorized` continua separado e fail-closed.

Ver `docs/BUILD-AUTONOMY.md` e `docs/contracts/build-autonomy.json`.

## 8. Desenvolvimento diario

Fluxo normal:

```text
editar source
 -> preview Web/HMR quando aplicavel
 -> testar
 -> commit/push main
 -> CI gera/verifica apenas artefatos afetados
 -> Web/Mobile/Desktop recebem o commit aplicavel
 -> OrdaX USB/Native detecta release ou delta
 -> verifica
 -> ativa
```

No owner/development Git-first, a etapa nativa equivalente pode ser `ordax-pull -> ordax-run`; `ordax-rollback` fixa o commit anterior entre reboots ate um `ordax-pull` explicito.

Nao exigir SSH, shell remoto, Remote Core, Control Plane ou Codex para esse fluxo.

Uma mudanca de Surface nao deve reconstruir kernel. Uma mudanca de kernel nao deve reconstruir Surface sem motivo real de dependencia.

## 9. Independencia do host

A arquitetura nao pode exigir como dependencia obrigatoria:

- WSL;
- QEMU;
- PowerShell;
- Bash;
- distribuicao Linux especifica no host do desenvolvedor;
- sistema desktop especifico;
- executavel SSH externo.

Quando Windows/Linux/macOS exigirem APIs diferentes para disco/elevacao, usar adapters finos sob um core compartilhado. Politica, formato, hashes, layout e comportamento nao podem divergir por host.

Um runner Linux/container pode compilar o kernel Linux no CI. Isso nao torna Linux/WSL uma dependencia da maquina do desenvolvedor.

## 10. Remote/Control opcional

Remote Core e Control Plane sao capacidades futuras opcionais.

Nao implementar ou colocar no bootstrap por antecipacao. So adicionar quando existir requisito concreto de diagnostico remoto, gerenciamento, suporte ou recovery.

Se forem implementados, devem usar transporte/criptografia padrao e auditado. Criptografia customizada e proibida.

## 11. Reuso do repositorio antigo

`novo-ordax-os` e referencia, nao dependencia automatica.

Para portar qualquer componente antigo, registrar em `docs/SOURCE-MIGRATION.md`:

- origem exata;
- commit/SHA;
- responsabilidade;
- por que ainda e necessario;
- dependencias;
- testes;
- decisao: ADOPTED / REIMPLEMENTED / REJECTED / REFERENCE_ONLY.

Nao copiar pastas inteiras, history, tmp, backups, scripts antigos, stack SSH/QEMU/F7 ou contratos obsoletos.

## 12. Seguranca

- Nunca versionar private keys, tokens, secrets ou credenciais.
- Integridade, autorizacao e selecao de alvo falham fechado.
- Operacao destrutiva de disco exige identificacao inequivoca do alvo, dry-run e evidencia.
- Criptografia customizada e proibida.

## 13. Trabalho fisico

Antes de formatar ou escrever em pendrive/notebook:

1. confirmar dispositivo por identidade/capacidade/serial quando disponivel;
2. confirmar que o source da operacao esta na `main`;
3. executar dry-run ou teste descartavel quando aplicavel;
4. registrar o payload minimo exato;
5. registrar o que sera apagado/criado;
6. exigir autorizacao destrutiva explicita no momento da escrita;
7. somente depois aplicar;
8. verificar leitura/hashes/layout depois da escrita.

O token de confirmacao do Creator deve estar ligado a identidade atual do USB, incluindo capacidade fisica medida. Uma autorizacao de escrita RAW deve ainda estar ligada ao SHA-256 e tamanho exato da imagem, e uma imagem de disco completa deve ter exatamente o mesmo tamanho do `PhysicalDrive` confirmado quando esse for o plano ativo.

OrdaX Creator deve consumir artefatos preconstruidos e verificados; o usuario final nao compila kernel para instalar o sistema.

## 14. Qualidade

- SSOT unico por responsabilidade.
- Sem bridges permanentes ou compatibilidade legada sem owner.
- Testes cobrem contratos criticos.
- Documentacao canonica muda junto com arquitetura e com valores correntes que ela registra.
- Snapshot canonico de versao, `releaseMode`, geometria fisica ou capability deve ser validado mecanicamente contra seu source/contrato quando houver fonte estruturada.
- Divergencia entre source atual e documentacao canonica e falha de CI/qualidade, nao detalhe editorial para corrigir depois.
- Platform adapters nao podem duplicar regras de produto.
- Build reproduzivel e provenance sao parte da qualidade, nao tarefas opcionais de release.

## 15. Estado atual

O clean-room ja possui receitas e provas para kernel, initramfs, rede minima, release acquisition, release bundle, Creator Core, descoberta segura de alvo Windows e composicao descartavel de midia. O `system/` real tambem possui um entrypoint compartilhado e bundling deterministico.

O ambiente do kernel esta fechado por prova repetida: imagem OCI por digest, snapshot APT, pacotes fixados e os tres artefatos do kernel reproduziram hashes identicos em execucoes independentes. Esse fato nao autoriza por si so uso fisico.

O owner/development Git-first tambem possui base com Git nativo, rede e firmware selecionado; o runtime usa partial+sparse checkout de `system/`, `git pull --ff-only` e rollback fixado entre reboots ate pull explicito. Isso e um perfil de desenvolvimento e nao substitui a trust canonical signed-release.

O Creator Windows ja mede a capacidade real do `PhysicalDrive`, inclui essa capacidade no token de confirmacao, verifica imagem RAW por tamanho/hash e possui uma autorizacao destrutiva calculada sobre alvo + imagem/plano. O backend nativo Win32 de escrita RAW ja existe e e testado internamente, mas sua autorizacao/publicacao permanece separada dos gates canonicos.

A prova byte-completa com confianca efemera tambem passou para o bootstrap seed. A chave privada efemera e a imagem RAW foram destruidas antes do upload; somente metadados de prova foram preservados. O anchor Ed25519 canonico ja foi gerado, recuperado criptograficamente, promovido e pinado; o full-bootstrap canonical-trust proof tambem passou. Esses fatos nao autorizam por si so promocao fisica.

A release v4 exata foi assinada, materializada/verificada pelo caminho canonical e agregada em prova vinculada; ela segue como prerelease versionada, sem promocao do canal `latest`. Esse fechamento habilita apenas o preflight separado de consentimento, nao uma escrita fisica.

Ainda permanecem abertos antes do primeiro Stable/MVP fisico:

```text
real Stable/MVP USB boot/network/runtime/recovery/cold-health evidence
graphical Surface smoke and known-good/rollback evidence on supported hardware
Secure Boot evidence or an explicit MVP support policy that does not overclaim it
```

A permissao de escrita fisica deve continuar obedecendo os contratos/gates atuais; nao inferir autorizacao apenas porque o Creator owner/development gera uma imagem ou executavel.

O menor caminho canonical continua:

```text
boot -> rede -> adquirir release assinada -> verificar -> ativar -> boot offline posterior
```

Todo componente extra deve justificar sua existencia antes de entrar no bootstrap.


### Entregas, atualizações e PRs

Antes de alterar versionamento, histórico ou a UI de atualizações, leia `docs/UPDATE-NOMENCLATURE.md` e `docs/contracts/update-nomenclature.json`.

- número de PR é identificador interno de desenvolvimento e nunca é a identidade da atualização no notebook;
- SHA Git permanece a identidade técnica exata;
- `Entrega N` é a sequência humana de mudanças aplicáveis ao dispositivo;
- `Atualização` é o evento/estado de aplicação no dispositivo;
- versão do produto OrdaX não é inferida de PR ou de Entrega;
- **Versão própria de componente e atualização independente são eixos diferentes**: todo componente pode possuir SemVer próprio, enquanto `releaseMode` define como ele e entregue/ativado;
- first-party apps em `0.x` sao Beta; `git-app` e um modo Owner/Development e nao significa Store/updater publico independente;
- `component-slot` e o caminho reservado para atualizacao independente de producao depois de verificacao assinada, pending health, promocao e rollback provados.

Não reintroduzir derivação de versão/entrega a partir de `Merge pull request #N`. Não alterar versão ou `releaseMode` sem atualizar no mesmo change set os snapshots/contratos canônicos que registram esses valores.
