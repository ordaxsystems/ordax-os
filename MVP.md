# MVP — OrdaX

Status: CANÔNICO PARA PLANEJAMENTO DO MVP

Este arquivo define o escopo público do MVP. Leia-o antes de trabalhar em lançamento, pendrive, Creator, site, conta, releases, instalação Native ou monetização.

## 1. Decisão definitiva de escopo

**MVP = execução pelo pendrive.**

No MVP público, o OrdaX funciona exclusivamente como **OrdaX USB**:

```text
site oficial
 -> OrdaX Creator
 -> USB Stable/MVP verificado
 -> boot pelo pendrive
 -> OrdaX em execução diretamente pelo USB
```

O MVP **não oferece instalação permanente** em SSD, NVMe ou HD. Também não oferece dual boot, resize, editor de partições nem qualquer escrita destrutiva em disco interno.

A instalação **OrdaX Native** continua sendo uma direção arquitetural válida. Todo o trabalho técnico já realizado deve ser preservado, testado e evoluído como fundação **pós-MVP**. Preservar a fundação não significa expor a capability ao usuário do MVP.

**Conta e nuvem mínima fazem parte do fechamento do MVP público, mas não do boot.** O sistema local deve continuar utilizável sem conta ou internet. Cadastro/login, recuperação, revogação, exportação, fechamento, sync bounded das classes MVP, Cloud Memory de account/Space e armazenamento privado explicitamente selecionado pelo usuário só podem ser ativados depois que seus gates de segurança e E2E estiverem verdes. Preço e billing são decisões comerciais separadas e não substituem esses gates.

## 2. Um produto, dois perfis de distribuição

O OrdaX não deve virar dois sistemas nem dois códigos divergentes.

### Owner / Development

- checkout Git local permitido;
- atualização rápida a partir da `main`;
- SHA/commit disponíveis em diagnóstico;
- Git-first USB permitido;
- ferramentas de engenharia e provas Native podem existir;
- não representa a experiência pública.

### Stable / MVP

- não depende de Git operacional;
- recebe somente releases oficiais verificadas;
- Creator é o caminho normal para criar o USB;
- **modo de execução público: USB**;
- **instalação Native: desativada e inacessível**;
- **escrita destrutiva em disco interno: proibida**;
- conhecido-bom, health e rollback permanecem obrigatórios.

Diferenças pertencem a profile, build, configuração, canal, capability e política — nunca a forks permanentes.

## 3. Atualização

### Owner / Development

```text
main
 -> pull/sync de desenvolvimento
 -> componente afetado
 -> hot apply quando possível
 -> Base candidata quando necessário
 -> health
 -> promoção ou fallback
```

### Stable / MVP

```text
canal oficial OrdaX
 -> release autorizada
 -> verificação criptográfica/integridade
 -> staging
 -> ativação controlada
 -> health
 -> promoção
 -> rollback automático se falhar
```

Stable/MVP não usa Git como canal de atualização do usuário.

## 3.1 Custodia de assinatura e evolucao

O primeiro proof fisico Stable/MVP pode usar a chave Ed25519 local criada pela ceremonia canonica, desde que a recuperacao criptografada seja verificada e a chave privada continue fora de Git, USB, Actions artifacts e clientes. Isso e uma solucao de bootstrap/prototipo, nao a custodia definitiva do produto.

A arquitetura de assinatura deve permanecer provider-neutral. O backend local (`local-pem`) e permitido para o prototipo e desenvolvimento; um backend gerenciado com chave nao exportavel em KMS/HSM pode ser adotado depois sem alterar o protocolo de verificacao do dispositivo. GitHub e executor/orquestrador e nao custodiante da chave privada.

```text
MANAGED_KMS_HSM_REQUIRED_FOR_FIRST_PHYSICAL_PROOF=NO
LOCAL_PEM_ALLOWED_FOR_CONTROLLED_PROTOTYPE=YES
PRIVATE_KEY_IN_GIT=NO
GITHUB_IS_KEY_CUSTODIAN=NO
SIGNING_BACKEND_PROVIDER_NEUTRAL=YES
SIGNED_TRUST_ROTATION_REQUIRED_BEFORE_BROAD_PUBLIC_DISTRIBUTION=YES
SINGLE_LOST_FILE_OR_HOST_MUST_NOT_PERMANENTLY_BLOCK_UPDATES=YES
```

Antes de distribuicao publica ampla, o OrdaX deve possuir transicao/rotacao de trust assinada e recuperacao redundante suficiente para que a perda de um computador, arquivo ou uma unica chave operacional nao obrigue reprovisionamento em massa. KMS/HSM e uma evolucao de custodia, nao uma dependencia paga obrigatoria para fechar o primeiro proof fisico.

## 4. Versões de componentes

Não fingir que todos os componentes receberam a mesma versão quando somente um mudou.

```text
OrdaX Base       0.9.x
Surface          0.8.x
Internet         0.5.x
Notas            0.4.x
Arquivos         0.3.x
Ajustes          0.3.x
Creator          0.2.x
```

A tabela acima é **somente um exemplo de independência de versionamento**, não um snapshot das versões atuais. Valores correntes devem ser lidos dos manifests/owners e de `docs/CURRENT-STATE.md`; exemplos de planejamento nunca devem ser tratados como estado implementado.

A versão geral do produto pode existir, mas deve ser distinguida da versão dos componentes. Ter uma versão própria também não significa, por si só, possuir atualização independente de produção: esse comportamento depende do `releaseMode` e dos gates correspondentes.

## 5. Definição prática do MVP

Um usuário deve conseguir:

1. chegar à landing pública em `/`;
2. obter o Creator/release pública autorizada;
3. preparar o USB sem terminal, ISO manual, Git ou particionamento;
4. inicializar hardware oficialmente suportado pelo pendrive;
5. concluir o primeiro uso Native no próprio USB, escolhendo idioma/fuso, com rede opcional e **conta opcional**;
6. chegar à Surface e **usar o sistema diretamente pelo USB**, inclusive sem conta online;
7. conectar à rede durante o primeiro uso ou posteriormente;
8. usar Arquivos, Notas, Internet, Ajustes e Sistema;
9. ter **Ordax Intelligence** como capacidade do sistema, com inferência local incluída na distribuição Stable/MVP e degradação segura se o backend falhar;
10. atualizar por canal oficial;
11. recuperar automaticamente de atualização defeituosa;
12. escolher **Entrar**, **Criar conta** ou **Continuar sem conta**; conta continua opcional, mas Entrar/Criar conta devem funcionar de ponta a ponta no MVP;
13. usar `/conta/` como área autenticada separada da landing quando uma sessão real existir, incluindo logout, recuperação, exportação e fechamento de conta;
14. quando autenticado, recuperar em outro cliente autorizado o estado MVP sincronizável — appearance, preferências, workspace metadata e demais classes explicitamente aprovadas — sem transportar secrets/device-private state;
15. usar Cloud Memory limitada aos scopes `account` e `Space` depois de entitlement/policy server-authoritative, com tombstones, conflitos e restore provados; Memory `device`, `session` e `restricted` continuam locais;
16. armazenar na nuvem arquivos explicitamente selecionados pelo usuário por um serviço OrdaX privado, com ownership/quota server-side, upload reservado, objeto opaco e verificação de tamanho/SHA-256; arquivos locais continuam independentes da nuvem;
17. quando autenticado e usando um Space profissional opt-in, usar a **OrdaX Network** para descobrir outros Spaces do segmento, participar voluntariamente de comunidades/grupos e trocar mensagens 1:1 ou em grupo, sem expor automaticamente a conta pessoal.

## 5.1 Fechamento funcional que precedeu o primeiro USB Stable

A auditoria de `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` foi executada antes do
primeiro proof físico governado do Stable/MVP. Esse primeiro pass já ocorreu com writer
17-artifact/39-operation, 17/17 readback e boot UEFI real. O checklist continua válido
como baseline de produto, mas não deve voltar a ser descrito como se nenhuma mídia
Stable/MVP tivesse sido gravada.

O boot/release histórico estar pronto não é suficiente para uma nova missão física. O
proof agregado de `b924ff8d74d1761232381ae3f9604bba17497cfd` é evidência
pré-hardening e foi supersedido pelo hardening posterior. Antes de qualquer nova
autorização física, o candidato pós-hardening precisa de um **replacement canonical v4
release proof** assinado/materializado a partir de outro source commit e vinculado ao
contrato atual. Só depois desse binding o consentimento do dono volta a ser alcançável;
alvo/UAC/confirmação continuam gates separados. O gate pré-USB exige, no mínimo:

- Ordax Intelligence realmente composta no runtime Native e consumida por fluxos
  first-party consultivos, em vez de existir apenas como backend/modelo e teste;
- política e implementação de sessão/bloqueio local/offline separadas da conta cloud;
- OOBE persistente e coerente com idiomas/fuso/rede/modo sem conta;
- jornada cotidiana de Arquivos fechada, com Lixeira recuperável e restauração no-clobber; exclusão permanente não faz parte do fluxo cotidiano do MVP;
- diagnóstico/recovery de produto e inventário mínimo de hardware/suporte;
- release-manifest/4 real com `local-ai-runtime.erofs` assinada/materializável.

Store pública, Mobile completo, Native em disco, **sync irrestrito de toda classe de dado**, federação, cobrança e
tools/agentes mutáveis de IA permanecem pós-MVP. O MVP inclui, porém, a **nuvem mínima bounded da conta**:
cadastro/sessão/recovery/export/close, sync das classes explicitamente aprovadas, Cloud Memory `account`/`Space`
e armazenamento privado de arquivos explicitamente selecionados. A exceção de colaboração é a **OrdaX Network MVP**
deliberadamente limitada por `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`: diretório opt-in
por Space, comunidades, grupos, mensagens e trust & safety mínimos. **A fundação arquitetural** de
Store/distribuição, Spaces/Profile Packs profissionais, entitlements, memória provider-neutral,
model router e ponte MCP externa continua entrando cedo para evitar migrações destrutivas depois que
contas/dados reais existirem. A Network e a nuvem mínima de conta são gates do lançamento público online,
mas não criam dependência de boot nem novo gate físico para a primeira prova Stable USB.

```text
PRE_USB_NOVA_ORDAX_AUDIT=PASS_SOURCE
CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_BOUND_VERSIONED_PRERELEASE_PRE_HARDENING
CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PENDING_POST_HARDENING_REPLACEMENT
FIRST_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF_PRE_HARDENING
FIRST_STABLE_MVP_USB_READBACK=PASS_17_OF_17_PRE_HARDENING
FIRST_STABLE_MVP_USB_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING
CURRENT_MAIN_STABLE_MVP_PHYSICAL_RETEST=BLOCKED_REPLACEMENT_RELEASE_PROOF
```

## 6. Gates do MVP público

Bloqueiam lançamento:

- replacement canonical v4 release proof para o candidato pós-hardening atual; o proof de `b924ff…` continua apenas como evidência histórica pré-hardening;
- publicação/promocão da release Stable no canal `latest`, somente depois do proof e da prova física correntes;
- Creator físico promovido e autorizado **para criação do USB**;
- readback verificável da mídia física do candidato atual (o primeiro proof controlado já obteve 17/17 no candidato pré-hardening);
- known-good/fallback suficientemente provados;
- reteste canônico Stable/MVP pós-hardening no hardware-alvo;
- boot USB -> OOBE/primeiro uso -> Surface -> apps;
- primeiro uso persistente com rota oficial **Continuar sem conta** e rede opcional;
- teclado físico utilizável no layout documentado para o hardware suportado; no MVP PT-BR, ABNT2 é o padrão Native e US é uma alternativa persistente;
- Ordax Intelligence presente como serviço de sistema e payload local de inferência verificável incluído na mídia/release; falha da IA não pode impedir boot/Surface;
- uso real sem instalação no disco interno;
- update oficial sem Git;
- recovery/rollback;
- catálogo público fail-closed;
- **Conta/Cadastro real funcional no MVP**, preservando `Continuar sem conta`: cadastro, login, refresh, logout/revogação e recuperação de acesso provados contra o owner real;
- **ciclo de vida da conta**: exportação e fechamento provados E2E; fechamento exige reautenticação recente, revoga sessões e limpa/tombstoneia dados cloud sem deixar blobs órfãos;
- privacidade/termos finais, versionados, com hash/URL/data efetiva, e aceite validado server-side pelo request antes da ativação pública;
- same-origin account gateway implantado, cookies Secure/HttpOnly/SameSite, CSRF e rate limits/proxy de IP real provados;
- configuração real do provider de identidade revisada/provada para password policy, confirmação de e-mail, redirects e recuperação;
- **Account Sync bounded**: prova real com sessões independentes, ownership por conta, cursor/revisão/tombstone, conflito e restore, sem provider tokens no payload;
- **Cloud Memory do MVP**: scopes `account`/`Space` com entitlement server-authoritative, mutação atômica, isolamento negativo, conflito, tombstone e fresh-install restore provados; `device`, `session`, `project` e `restricted` continuam fora do rollout inicial;
- **armazenamento privado de arquivos do usuário**: bucket não público, metadata canônica separada dos bytes, reservation + quota server-side, autorização curta de upload/download, chave opaca, verificação de tamanho/SHA-256, isolamento negativo entre contas/Spaces, delete/export/restore e limpeza no fechamento da conta;
- **downgrade seguro**: exceder quota nunca apaga dados silenciosamente; novo crescimento pode ser bloqueado, mas export/delete continuam disponíveis;
- hardware suportado documentado;
- **Profiles demonstráveis seguros**: `pizzaria-br@1` e `impressao-3d-br@1` ativáveis/desativáveis em Space profissional no Stable/MVP pelo mesmo boundary genérico, sem downloads extras ou privilégio novo;
- **OrdaX Network MVP segura**: diretório de Spaces somente opt-in, membership explícita, grupos, mensagens 1:1/grupo, bloqueio/denúncia/rate limit, autorização server-side fail-closed e prova negativa de isolamento entre contas/Spaces; indisponibilidade da Network não pode impedir boot ou apps locais.

**Não bloqueiam o MVP:** instalador Native, boot por SSD/NVMe/HD, dual boot, resize/particionamento interno, preço final, cobrança ativa, compra de plano pago, cliente Web completo ou cliente Mobile completo. A arquitetura de entitlement/quota deve estar pronta antes disso, mas valores comerciais sensíveis a custo só são definidos após medir o custo real.

O layout do teclado físico é uma capability do host Native, não uma preferência Web. A alteração feita em Ajustes é gravada no USB e aplicada pelo Cage no próximo início da Surface. O seletor não deve aparecer no primeiro uso enquanto não existir uma troca segura na sessão atual ou um handoff gráfico anterior ao compositor.

## 7. Fundação Native pós-MVP

Não apagar, duplicar ou degradar a arquitetura já construída para Native.

Permanecem como fundação pós-MVP:

- contratos de storage Native;
- Creator Core e planners;
- identidade/revalidação de target;
- LUKS2 + Btrfs;
- initramfs Native;
- kernel compartilhado com pré-requisitos Native;
- boot entries e ESP Native;
- provas descartáveis de storage/runtime/ESP;
- brokers/adapters de descoberta;
- testes e provenance.

No perfil Stable/MVP:

```text
native-install-capability = disabled
internal-disk-destructive-write = forbidden
native-install-ui = absent
native-install-api-token = absent
```

A reativação futura exige promoção explícita pós-MVP e novos gates de produto/hardware.

## 8. Pendrive e Creator

### USB Owner / Development

- Git-first;
- diagnóstico/recovery de engenharia;
- não é release pública.

### USB Stable / MVP

- gerado por Creator/release autorizada;
- sem Git operacional;
- manifest/hash/provenance;
- conhecido-bom e recovery;
- usuário não manipula partições ou terminal;
- é um **modo de produto utilizável**, não mídia de instalação.

### Fluxo público obrigatório

```text
site oficial
 -> baixar OrdaX Creator
 -> conectar USB
 -> Creator seleciona release Stable autorizada
 -> verifica assinatura/hash
 -> pré-materializa a release verificada e o conhecido-bom no USB
 -> prepara e verifica o USB
 -> usuário inicializa pelo USB sem depender da internet para o primeiro boot
 -> usa o OrdaX diretamente pelo pendrive
```

O Creator do MVP prepara mídia removível. Não oferece gravação/instalação em disco interno.

**IA não é um extra selecionável do Creator.** O Stable/MVP inclui Ordax Intelligence e seu backend local verificado como parte do produto. Depois da instalação, modelo, quantização ou engine podem evoluir por atualização governada; isso não equivale a oferecer um checkbox para instalar o OrdaX sem sua camada de Intelligence.

### Estado técnico atual do USB durável v2

O alvo durável do MVP não deve ser confundido com a mídia transitória de três partições usada nas primeiras provas físicas.

```text
MVP target
 -> ORDAX-ESP   FAT32
 -> ORDAX-DATA  exFAT
    -> .ordax/releases/<commit>/system.erofs
    -> .ordax/state/persistent-state.img   # ext4
    -> arquivos do usuário
```

Estado atual do caminho v2:

- storage `ORDAX-ESP + ORDAX-DATA`: prova descartável verde;
- release `system.erofs`: determinística e byte-reprodutível em CI;
- `release-manifest/2`: compatibilidade preservada;
- `release-manifest/3`: generator + signer + verifier + aquisição não-ativante implementados e verdes em CI, com `system.erofs` + `native-surface-runtime.erofs`;
- runtime gráfico v3: armazenamento content-addressed por SHA-256 e reuso de bytes verificados entre releases implementados;
- `release-manifest/4`: caminho de protocolo implementado para acrescentar `local-ai-runtime.erofs`, com binding assinado ao source-lock do engine/modelo e armazenamento da IA por SHA-256 separado do runtime gráfico; o runtime **real** de `llama-server` + Qwen3.5-0.8B-Q4_0 já foi construído duas vezes com bytes idênticos no mesmo job, montado read-only e validado com inferência real tanto no host de CI quanto em Alpine 3.22.5. O engine está pinado por SHA-256/size; boot/handoff v4 e regressão descartável QEMU/UEFI já estão provados em source/CI. A candidata v4 foi assinada e materializada como prerelease, com proof agregado validado e vinculado; promoção do canal estável `latest` e prova física do candidato **pós-hardening** continuam pendentes, embora a primeira prova física pré-hardening já tenha ocorrido;
- materialização portátil: implementada sem ativação implícita; v4 também permanece não-ativante;
- revalidação offline exata da release assinada: implementada para v2, v3 e para o caminho de protocolo v4;
- mount EROFS + estado ext4 + runtime system read-only: prova descartável verde;
- helper de mount portátil dentro do initramfs: conectado ao PID1 candidato; continua sem autoridade de assinatura/ativação própria;
- estado de ativação `current/known-good/candidate/rejected`: implementado no ext4 persistente;
- transação Portable one-shot: `prepare -> select-boot -> commit/rollback`, com replace atômico + fsync e sem ponteiro mutável no exFAT;
- `candidate` só ganha autoridade de boot quando existe uma transação armada; recebe **uma tentativa** e nunca substitui `current` antes do cold-health;
- SHA rejeitado fica persistido e não é rearmado enquanto o canal oficial não avançar para outro commit;
- o supervisor Stable inspeciona o `manifest_schema` assinado e escolhe `materialize/verify-portable-v3` ou `v4` explicitamente; v4 é o caminho MVP atual com Surface + IA local, enquanto v3 permanece apenas para compatibilidade de dispositivos pré-v4. Depois que o boot corrente é v4, uma release remota v3 é bloqueada como downgrade. O fluxo continua `inspect -> materialize/verify exato -> arm -> reboot -> cold-health -> commit/rollback`, sem Git e sem ativação implícita pelo materializador; a prova descartável QEMU/UEFI v4 está fechada e o reteste do candidato atual no USB físico continua separado;
- bootstrap capsule EROFS: determinística, reprodutível, pinada e verificada pelo PID1 candidato;
- Stable Base EROFS: Alpine e conjunto APK transitivo pinados; handoff QEMU/UEFI v2-base já provado em CI, reteste físico do candidato atual ainda pendente;
- runtime gráfico offline: lock exato de 253 pacotes e EROFS byte-reprodutível provados em CI; handoff v3, preseed Creator e launcher Stable offline já implementados no candidato atual;
- Stable/MVP não instala nem atualiza o runtime gráfico via `apk add` durante o boot; o runtime assinado usa EROFS read-only + OverlayFS efêmero em `/run`;
- handoff do runtime v3 em QEMU direct-kernel e OVMF/UEFI: **revalidado regressivamente como PASS no commit atual da main** `c8c8fe526d03ced7630420cd116dd954b08ef03a` pelo run `35598937763`, com rede desabilitada e sem tocar mídia física;
- essa prova confirma release v3 + runtime offline + Stable Init, mas **não** declara a Surface gráfica completa em hardware real;
- writer físico Portable: implementado apenas no backend interno/tagged e continua inacessível ao Creator público;
- boot físico Stable/MVP pré-hardening: **PASS UEFI em proof controlado**; o candidato pós-#588 continua `PENDING_PHYSICAL_RETEST`;
- Secure Boot: não provado;
- canonical release trust público: **PASS** — anchor Ed25519 canônico pinado. O proof v4 agregado de `b924ff8d74d1761232381ae3f9604bba17497cfd` permanece **PASS como evidência histórica pré-hardening**, mas foi supersedido para a promoção da `main` atual. O candidato pós-hardening precisa de outro proof assinado/materializado e binding antes de qualquer autorização física fresca; o canal `latest` continua não promovido;
- Native continua fora do MVP.

A mídia transitória atual continua apenas como caminho de validação de hardware. O trust público canônico já está resolvido e o caminho Stable/MVP atual é v4. O primeiro proof físico governado não transforma o writer interno em capability pública nem autoriza novas gravações. Não habilitar o writer público antes de **prova canônica v4 assinada/materializável, binding do receipt, autorização física explícita válida para o contexto atual e prova física pós-hardening do USB Stable/MVP**.

## 9. Site público e rotas

```text
/            -> landing pública
/download/   -> Creator / releases
/login/      -> autenticação
/cadastro/   -> criação de conta
/conta/      -> área autenticada
```

A Surface/área do usuário nunca substitui `/`. OrdaX Web é experiência autenticada futura e separada do portal público.

Landing e Download comunicam MVP USB-only. Instalação permanente só pode aparecer como **futuro/pós-MVP**. Web completo e Mobile completo continuam pós-MVP; a conta/nuvem bounded do MVP só pode ser anunciada como disponível depois que `docs/contracts/mvp-account-cloud.json` estiver verde e o rollout real estiver ativado.

## 10. Conta e monetização

No MVP:

- não ativar cobrança antes de a política comercial estar deliberadamente definida;
- não publicar preços antes da decisão comercial final;
- os IDs estruturais `free`, `personal`, `professional` e `team` podem existir para preparar entitlements, mas não constituem por si só uma oferta paga ativa;
- não impor limite comercial de dispositivos;
- não cobrar arbitrariamente pelo segundo dispositivo;
- conta, quando ativada, é uma identidade única;
- registro de dispositivos/sessões pode existir por segurança e revogação, não como paywall.

A arquitetura deve estar pronta para dispositivos, sincronização, backup, continuidade PC/Web/Mobile, armazenamento, assinatura/entitlements e serviços premium, sem tornar preço uma dependência técnica para login, export/delete ou uso local.

Antes do MVP público, a fundação distingue:

- **perfil da conta**: identidade pessoal do usuário, nunca um produto premium;
- **Space**: contexto pessoal/de trabalho/profissional que contém projetos, memória e futuras memberships;
- **Profile Pack**: composição versionada aplicada a um Space, por exemplo Developer, Creator, Business ou Legal/Advocacia;
- **entitlement**: decisão server-authoritative para capacidade/serviço remoto, nunca uma alegação do cliente;
- **quota**: limite/uso medido server-side; cliente não pode alegar consumo menor nem transformar quota em autoridade de ação.

A experiência gratuita fica **arquiteturalmente preparada** para até 2 Spaces privados ativos como
default provisório. Isso não é preço nem promessa pública de capacidade de cloud.
Categorias de Profile Pack não são bloqueadas só pelo nome: a monetização futura deve recair sobre
valor mensurável como Spaces adicionais/compartilhados, membros, memória cloud/histórico, sync/backup,
armazenamento de objetos, compute externo, conectores, automações e suporte.

A direção futura de monetização é vender **valor do ecossistema** — sincronização, backup, continuidade, armazenamento, colaboração, compute e serviços — e não transformar quantidade de dispositivos isoladamente no produto vendido.

Preços, franquias de bytes/histórico/compute e cobrança permanecem abertos até existirem unit economics medidos. Downgrade nunca autoriza exclusão silenciosa dos dados do usuário.

## 10.1 Fundação de ecossistema pré-MVP

A especificação canônica dessa fundação está em `PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md` e nos
contratos `ordax.entitlements/1`, `ordax.spaces/1`, `ordax.profile-packs/1`,
`ordax.memory/1` e `ordax.model-router/1`.

Memória persistente pertence ao OrdaX e pode alimentar, mediante autorização, o backend local ou
provedores externos futuros. GPT, Grok, llama.cpp ou outro modelo não são donos da memória do usuário.

O Product MCP futuro autentica o usuário na conta OrdaX e resolve Space/projeto/capability antes de
expor ferramentas. Conexão GitHub é uma autorização separada, preferencialmente por GitHub App e
repositórios selecionados; tokens GitHub não são entregues ao modelo externo.

Profile Packs profissionais podem definir fontes de conhecimento, políticas de atualização,
templates e composição de apps, mas não podem conceder privilégios, ignorar assinatura de pacotes ou
transformar resposta de modelo em fonte autoritativa. O pack `legal-br` inicial permanece **draft**
até existir pipeline de fontes oficiais/versionadas e validação de domínio.

## 10.2 Profiles profissionais no MVP

O MVP inclui a **fundação do sistema de Profiles**, não todos os payloads profissionais.

A imagem USB mantém apenas o catálogo leve e os componentes base. Profile Packs profissionais
são preparados para provisionamento sob demanda, com cálculo de dependências e uso offline após
instalação. O runtime não possui executor público de download nesta fase: qualquer payload futuro
precisa de identidade de artefato, SHA-256, assinatura, stage, health e rollback antes de ser
instalável.

`Developer` permanece prova interna. `Legal BR` pode aparecer no catálogo como conhecido,
mas permanece bloqueado até existir knowledge oficial/versionado, validação de domínio e cadeia
pública de trust.

O MVP inclui dois Profiles demonstráveis sobre o mesmo mecanismo seguro: `pizzaria-br@1` e `impressao-3d-br@1`. Ambos usam
somente apps first-party já presentes e não baixam componentes externos. Eles servem como
prova real de que negócios de setores distintos podem receber um ambiente OrdaX especializado sem
outro sistema, outra imagem ou reinstalação do USB. PDV, fiscal, delivery, estoque
avançado e financeiro completo ficam para atualizações posteriores.

Isso evita inflar o pendrive e preserva a evolução por atualização.

## 10.3 OrdaX Network no MVP

A Network é uma capability horizontal compartilhada por Profiles, não um recurso privado de
`pizzaria-br`. O Profile pode recomendar a comunidade `industry.food.pizzeria.br`, mas não pode
publicar o Space nem fazer auto-join. A identidade profissional visível é o **Space**; a conta pessoal,
e-mail e localização exata permanecem privados por padrão.

O recorte obrigatório do MVP é diretório opt-in, comunidades, grupos, mensagens 1:1/grupo,
bloqueio, denúncia, rate limit e moderação/auditoria mínimas. Feed algorítmico, anúncios, marketplace,
voz/vídeo e federação aberta ficam posteriores. O contrato de segurança é
`docs/contracts/network-foundation.json`; afinidades Profile -> comunidade ficam em
`system/network/profile-affiliations.json`.

A Network é um domínio colaborativo próprio: não usa account sync como barramento de chat e não
ingere conversa automaticamente em Memory. Toda autorização de membership/role é server-side e
default-deny. O sistema local continua utilizável sem conta ou internet.

## 11. Conta OrdaX

A conta OrdaX é **opcional para usar o sistema operacional**. O primeiro uso deve oferecer uma rota explícita **Continuar sem conta**, preservando Arquivos, Notas, Internet, Ajustes, atualizações, Intelligence local, Memory local e preferências locais no USB.

O mínimo da conta para **fechar o MVP público** é criar conta, entrar, refresh, sair/revogar, recuperar acesso, sessão real, perfil básico, `/conta/`, exportar os próprios dados, fechar a conta com reautenticação recente, Account Sync bounded, Cloud Memory `account`/`Space` e armazenamento privado de arquivos explicitamente selecionados. Entrar/Criar conta no OOBE são capability-driven: ficam inativos enquanto os owners reais não estiverem prontos e nunca bloqueiam a conclusão local do primeiro uso.

`/conta/` permanece fail-closed enquanto identidade/sessão reais não estiverem conectadas. Não simular dados, dispositivos, sync ou assinatura. O portal público usa o mesmo gateway same-origin para `/auth/*`, `/sync/*` e `/account/*`; provider tokens nunca entram em JavaScript da Surface.

Conta online e PIN/senha local do dispositivo são responsabilidades diferentes. Cliente Web completo, Mobile completo, sync irrestrito de toda classe de dado e políticas avançadas de backup permanecem pós-MVP. A nuvem bounded definida por `docs/contracts/mvp-account-cloud.json` é requisito de lançamento, mas continua com rollout desligado até todas as provas reais passarem.

## 11.1 Idiomas do lançamento

O MVP público oferece **pt-BR e en-US** nos seletores de primeiro uso e da Surface; ambos possuem cobertura compartilhada no source atual. **es-ES, de-DE e fr-FR** permanecem preservados como locales de compatibilidade/OOBE e rollout futuro, mas ficam ocultos dos seletores públicos até atingirem a mesma cobertura da Surface. PT-BR permanece idioma-fonte e padrão inicial.

## 12. Ordem recomendada de lançamento

```text
1. **histórico concluído:** o candidato v4 `b924ff8d74d1761232381ae3f9604bba17497cfd` foi assinado/publicado como prerelease, materializado, vinculado e usado no primeiro proof físico pré-hardening
2. **histórico concluído:** o primeiro proof controlado obteve 17/17 readback e boot UEFI, expondo os pontos corrigidos pelo hardening posterior
3. gerar um **novo** candidato v4 a partir de um source commit pós-hardening, sem reutilizar o proof histórico
4. assinar/publicar esse candidato como prerelease versionada, materializar/verificar os três artefatos e produzir um replacement `canonical-v4-release-proof.json`
5. validar e vincular o replacement proof ao trust, source commit, manifest, envelope e três artefatos; somente então o preflight de consentimento pode voltar a ficar alcançável
6. obter nova autorização explícita do dono para esse contexto exato, sem reutilizar consentimento anterior
7. revalidar o USB real, UAC e confirmação destrutiva específica do alvo somente quando o reteste físico for deliberadamente iniciado
8. validar UEFI, rede, assinatura, Surface, OOBE e apps no hardware suportado com o candidato pós-hardening
9. validar cold-health -> known-good e o rollback/recovery offline físicos
10. executar o smoke físico estruturado da Surface com FAIL=0
11. fechar Secure Boot ou registrar explicitamente a política de suporte do MVP sem alegar prova inexistente
12. fechar o gate de Conta/Nuvem do MVP: legal/auth hardening, cadastro/login/recovery/revogação, export/close, Account Sync, Cloud Memory e user object storage com provas reais; a conta continua opcional no boot
13. definir preços/quotas comerciais apenas quando os custos reais estiverem medidos; billing não precisa ser ativado para provar segurança/arquitetura
14. fechar legal/publicação e publicar o MVP USB-only somente com os gates físico, local e online obrigatórios verdes
```

Native permanece em trilha técnica pós-MVP, sem bloquear a sequência.

## 13. Regras para próximos chats

- sincronize com `main` e PRs antes de editar;
- não duplique trabalho paralelo;
- Stable/MVP público = USB-only;
- preserve fundações Native, mas não as exponha no MVP;
- não introduza escrita destrutiva em disco interno no MVP;
- não introduza Git operacional no Stable/MVP;
- conta/nuvem bounded fazem parte do gate do MVP, mas conta nunca bloqueia boot/uso local;
- mantenha rollout público de conta, Memory e storage desligado até os gates reais passarem;
- não anuncie recurso futuro como disponível;
- não invente preços nem quotas de custo sem medição; IDs estruturais de plano não são oferta comercial ativa;
- preserve gates fail-closed;
- não declare prova física quando houve apenas CI/prova descartável;
- não use exemplos de documentação como snapshot atual quando há manifest/contrato estruturado;
- qualquer mudança de versão, `releaseMode`, geometria física ou outro valor canônico deve atualizar o snapshot/contrato correspondente no mesmo change set e manter o guardrail de freshness verde;
- prefira arquitetura a paliativos.

## 14. Referências técnicas

- `docs/CURRENT-STATE.md`;
- `docs/PUBLIC-SITE.md`;
- `docs/PRODUCT-MODES.md`;
- `docs/ACCOUNT-SYNC-AND-PLANS.md`;
- `docs/NATIVE-INSTALLATION.md`;
- `docs/PHYSICAL-MEDIA.md`;
- `docs/contracts/distribution-profiles.json`;
- `docs/contracts/portable-bootstrap-v2.json`;
- `docs/contracts/portable-usb-v2.json`;
- `docs/contracts/portable-boot-handoff.json`;
- `docs/contracts/native-installation.json`;
- `docs/contracts/public-site.json`;
- `docs/contracts/mvp-account-cloud.json`;
- `docs/contracts/user-cloud-storage.json`;
- `docs/contracts/cloud-memory-sync-boundary.json`;
- `docs/contracts/foundation.json`;
- `docs/contracts/sync-model.json`;
- `docs/contracts/first-run.json`.

Este documento define o **escopo público do MVP**. Os contratos machine-readable continuam autoridade dos invariantes técnicos.
