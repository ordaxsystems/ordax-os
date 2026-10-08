# MVP — OrdaX

Status: CANÔNICO PARA PLANEJAMENTO DO MVP

Este arquivo define o escopo público do MVP. Leia-o antes de trabalhar em lançamento, pendrive, Creator, site, conta, releases, instalação Native ou monetização.

## 1. Escopo revisado: MVP integrado, progressivo e verificável (2026-10-08)

**MVP não é sinônimo de USB-only, nem de apenas cinco aplicativos.** A meta de produto desta etapa é consolidar **todas as capacidades com implementação efetivamente iniciada** nos quatro owners canônicos do OrdaX — OS, Apps, Runtime e Platform — respeitando o SSOT de cada responsabilidade, antes de declarar encerrada a consolidação. Não adiar trabalho utilizável simplesmente por ser chamado de "pós-MVP"; concluir os recortes já iniciados e continuar evoluindo mesmo antes da primeira distribuição.

Entram no inventário e no ciclo de integração: boot/Kernel/Base, USB e **instalação Native SSD/NVMe/HD**, Creator, recuperação e atualizações; Conta e autenticação, perfis/Spaces/Memory, OrdaX Intelligence e IA local, Personal OrdaX, ferramentas e ações governadas; Surface e layout; Store, gerenciador e apps first-party; Studio e Runtime/Device Host; rede/Network; Web, site público, serviços da Platform, Cloudflare, PostgreSQL, Vercel, segurança, distribuição e atualizações. Capacidades Web/Mobile/Desktop com código já iniciado também devem ser inventariadas, sem inventar APK, serviço ou port inexistente.

**A inclusão no escopo não é autorização de exposição.** Cada capacidade possui evidência própria de maturidade: `fonte/estrutura` → `funcional e testada` → `integrada` → `homologada no host-alvo` → `disponível no release/canal autorizado`. Ícone, contrato, arquivo-fonte, branch, build ou CI verde não equivalem a uma função utilizável. Funcionalidade real já madura entra em um candidato compatível; trabalho ainda bloqueado fica versionado, visível no inventário, isolado e com próximo gate definido. Nenhuma falsificação de "pronto" para ampliar contagem de apps.

**Modos do MVP:** OrdaX USB é o primeiro modo de execução já comprovado parcialmente em hardware; **OrdaX Native (SSD/NVMe/HD) também passa a ser alvo de implementação/homologação deste ciclo de MVP**, aproveitando o Creator Core, storage LUKS2/Btrfs, initramfs e provas existentes. O Native não deve ser empurrado automaticamente para outra fase, mas sua ativação pública exige provas reais de escrita segura, boot, recovery e proteção de dados. A primeira candidata Stable pode continuar USB-only enquanto o modo Native não passar nesses gates: isso descreve o **release atualmente habilitado**, e não reduz o escopo de desenvolvimento do MVP.

**Segurança de disco:** por enquanto o contrato `stable-mvp` ainda desativa `native_install_capability_enabled` e proíbe `internal_disk_destructive_write_allowed`. São **verdades operacionais atuais**, não veto definitivo ao modo Native. Nunca mudá-las apenas para habilitar UI, token ou teste. A promoção deve ocorrer em PR técnico próprio, alinhando contrato, implementação, provas descartáveis + físicas e autorização específica do dono/alvo. Inicialmente admitir somente instalação de disco inteiro selecionado conscientemente; **não** prometer dual boot, redimensionamento automático ou instalação preservando dados já existentes sem novos contratos e provas.

**Gestão de releases:** manter sempre um caminho Stable passível de homologação e recuperação, sem esperar todas as capacidades independentes ficarem públicas. Não converter todas as frentes iniciadas em bloqueadoras do primeiro USB: o bloqueio é por requisito essencial do modo/fluxo anunciado, risco crítico, violação de contrato ou segurança. Todos os demais recortes seguem sendo concluídos e entregues por releases e atualizações verificadas, inclusive antes do lançamento se aprovados.

O SSOT de escopo é este `MVP.md`; `docs/CURRENT-STATE.md` e os contratos machine-readable continuam descrevendo **o que está implementado e habilitado hoje**. Nenhuma decisão textual transforma um gate técnico não realizado em `PASS`.

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
- **modo de execução atualmente habilitado: USB**, com Native dentro do ciclo de implementação/homologação MVP;
- **instalação Native: desativada no release atual até fechar gates próprios**;
- **escrita destrutiva em disco interno: proibida sem promoção técnica e autorização explícita do alvo**;
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
13. usar `/conta/` como área autenticada separada da landing quando uma sessão real existir, incluindo logout e recuperação de acesso;
14. quando autenticado e usando um Space profissional opt-in, usar a **OrdaX Network** para descobrir outros Spaces do segmento, participar voluntariamente de comunidades/grupos e trocar mensagens 1:1 ou em grupo, sem expor automaticamente a conta pessoal;
15. quando o modo Native estiver homologado e oferecido pelo canal autorizado, selecionar conscientemente um disco interno, visualizar plano e consequências, confirmar a instalação de disco inteiro sem preservar os dados anteriores, instalar uma release assinada e iniciar/recover sem USB. **Esse item está em implementação, não disponível agora.**

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

Store pública, Mobile completo, Native em disco, sync cloud geral, federação, cobrança e
tools/agentes mutáveis de IA, **quando houver implementação iniciada**, integram o inventário do ciclo MVP e os seus gates de integração; continuam indisponíveis no release até homologação específica. A exceção de colaboração é a **OrdaX Network MVP**
deliberadamente limitada por `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`: diretório opt-in
por Space, comunidades, grupos, mensagens e trust & safety mínimos. **A fundação arquitetural** de
Store/distribuição, Spaces/Profile Packs profissionais, entitlements, memória provider-neutral,
model router e ponte MCP externa continua entrando cedo para evitar migrações destrutivas depois que
contas/dados reais existirem. A Network é gate do lançamento público online, mas não cria dependência
de boot nem novo gate físico para a primeira prova Stable USB.

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
- **Conta/Cadastro real funcional no MVP**, preservando `Continuar sem conta`: cadastro, login, logout/revogação e recuperação de acesso provados contra o owner real;
- privacidade/termos finais, versionados e com data efetiva antes da ativação pública;
- hardware suportado documentado;
- **Profiles demonstráveis seguros**: `pizzaria-br@1` e `impressao-3d-br@1` ativáveis/desativáveis em Space profissional no Stable/MVP pelo mesmo boundary genérico, sem downloads extras ou privilégio novo;
- **OrdaX Network MVP segura**: diretório de Spaces somente opt-in, membership explícita, grupos, mensagens 1:1/grupo, bloqueio/denúncia/rate limit, autorização server-side fail-closed e prova negativa de isolamento entre contas/Spaces; indisponibilidade da Network não pode impedir boot ou apps locais.

**Não bloqueiam a primeira candidata USB:** instalador Native e boot por SSD/NVMe/HD ainda não homologados; ambos permanecem no ciclo MVP com gates explícitos. Dual boot, resize e editor de partições não são requisitos iniciais da modalidade Native de disco inteiro. O lançamento do modo Native é bloqueado enquanto sua escrita/boot/recovery físicos não estiverem comprovados.

O layout do teclado físico é uma capability do host Native, não uma preferência Web. A alteração feita em Ajustes é gravada no USB e aplicada pelo Cage no próximo início da Surface. O seletor não deve aparecer no primeiro uso enquanto não existir uma troca segura na sessão atual ou um handoff gráfico anterior ao compositor.

## 7. Instalação Native — trabalho do MVP com disponibilidade condicionada

**Decisão de escopo:** concluir e homologar o recorte Native já iniciado faz parte do MVP integrado. Não reimplementar Creator Core, não criar outro produto, não bifurcar Surface nem compartilhar grants da forma errada.

Fundação já registrada no repositório: planners não destrutivos de storage e instalação; vinculação/revalidação de identidade de alvo; GPT + LUKS2 + Btrfs; Native initramfs; pré-requisitos do kernel; modo `native-disk` separado de `usb`; teste de materialização de storage descartável; adapter read-only de descoberta. **Ainda não há prova de APPLY físico, boot Native completo, recovery e first-boot health do candidato real.** Esses itens não podem ser declarados implementados por existir sua estrutura.

Para tornar o modo Native publicável neste ciclo, exigir nesta ordem de dependência: verificar a proteção ao USB de origem e discos não selecionados; provar plano exato e consentimento destrutivo; implementar o APPLY no owner existente; verificar bytes/GPT/ESP/LUKS2/Btrfs e a release assinada no alvo; testar boot UEFI sem USB, desbloqueio, atualização, recovery/rollback e persistência após reinicialização; executar homologação no hardware declarado. Criar ou consumir evidências versionadas e observáveis em cada etapa. Não usar uma opção de UI como bypass.

**Política operacional durante o desenvolvimento:**

```text
native-install-capability = disabled (release Stable atual)
internal-disk-destructive-write = forbidden (até promoção e autorização)
native-install-ui = absent/disabled enquanto indisponível
native-install-api-token = absent enquanto indisponível
native-development-scope = MVP_INTEGRATED
native-public-availability = PENDING_E2E_PHYSICAL_GATES
```

O contrato atual em `docs/contracts/native-installation.json` e a distribuição em `docs/contracts/distribution-profiles.json` governam a disponibilidade efetiva. A futura mudança de flags exige revisão conjunta de contrato/implementação/testes no mesmo PR, nunca uma alteração documental isolada. O escopo inicial será **disco inteiro com apagamento informado**, sem dual boot/resize/editor de partições nesta fase.

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

O Creator **atualmente disponível no recorte Stable** prepara mídia removível. A evolução do mesmo Creator Core para instalar OrdaX em disco interno integra este ciclo de MVP, mas seu APPLY físico continua bloqueado até gates próprios; não afirmar que já está disponível.

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

Landing e Download comunicam MVP USB-only. Instalação permanente só pode aparecer como **futuro/pós-MVP**. Web, Mobile, sync, backup e continuidade ainda indisponíveis podem aparecer apenas como **Em breve**.

## 10. Conta e monetização

No MVP:

- não implementar cobrança;
- não publicar preços;
- não definir tiers comerciais definitivos;
- não impor limite comercial de dispositivos;
- não cobrar arbitrariamente pelo segundo dispositivo;
- conta, quando ativada, é uma identidade única;
- registro de dispositivos/sessões pode existir por segurança e revogação, não como paywall.

A arquitetura continua preparada para dispositivos, sincronização, backup, continuidade PC/Web/Mobile, armazenamento, assinatura/entitlements e serviços premium.

Antes do MVP público, a fundação passa a distinguir:

- **perfil da conta**: identidade pessoal do usuário, nunca um produto premium;
- **Space**: contexto pessoal/de trabalho/profissional que contém projetos, memória e futuras memberships;
- **Profile Pack**: composição versionada aplicada a um Space, por exemplo Developer, Creator, Business ou Legal/Advocacia;
- **entitlement**: decisão server-authoritative para capacidade/serviço premium, nunca uma alegação do cliente.

A experiência gratuita fica **arquiteturalmente preparada** para até 2 Spaces privados ativos como
default provisório. Isso não é preço, tier comercial definitivo nem promessa de quota pública.
Categorias de Profile Pack não são bloqueadas só pelo nome: a monetização futura deve recair sobre
valor mensurável como Spaces adicionais/compartilhados, membros, memória cloud/histórico, sync/backup,
compute externo, conectores, automações e suporte.

A direção futura de monetização é vender **valor do ecossistema** — sincronização, backup, continuidade, armazenamento, colaboração, compute e serviços — e não transformar quantidade de dispositivos isoladamente no produto vendido.

Nenhuma política de preço, nome de plano comercial definitivo ou limite comercial de dispositivos está definida.

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

A conta OrdaX é **opcional para usar o sistema operacional**. O primeiro uso deve oferecer uma rota explícita **Continuar sem conta**, preservando Arquivos, Notas, Internet, Ajustes, atualizações e preferências locais no USB.

O mínimo futuro da conta pública é criar conta, entrar, sair, recuperar acesso, sessão real, perfil básico e `/conta/`. Entrar/Criar conta no OOBE são capability-driven: ficam inativos enquanto nenhum provedor real estiver conectado e nunca bloqueiam a conclusão local do primeiro uso.

`/conta/` permanece fail-closed enquanto identidade/sessão reais não estiverem conectadas. Não simular dados, dispositivos, sync ou assinatura.

Conta online e PIN/senha local do dispositivo são responsabilidades diferentes. Web, Mobile, backup e sincronização aparecem somente como **Em breve** até existirem de verdade; sincronização cloud não é requisito para o MVP USB.

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
12. conectar Conta OrdaX real apenas se o portal público for ativado, sem torná-la requisito de boot
13. fechar legal/publicação e publicar o primeiro candidato USB quando seus gates próprios passarem, sem tratar essa publicação como conclusão automática de todo o ciclo MVP
14. continuar a integração/homologação dos componentes iniciados e concluir a modalidade Native de disco inteiro nos mesmos owners, disponibilizando-a **somente** após gates completos
```

Native integra o escopo de trabalho do MVP, com gates específicos; não bloqueia artificialmente a primeira release USB segura, mas também não pode ser declarado entregue até funcionar e ser homologado.

## 13. Regras para próximos chats

- sincronize com `main` e PRs antes de editar;
- não duplique trabalho paralelo;
- escopo de implementação do MVP abrange tudo o que já foi realmente iniciado nos owners canônicos; disponibilidade é verificada por funcionalidade e canal;
- preserve e conclua Native neste ciclo, mas não exponha seu instalador enquanto seus gates não passarem;
- não introduza escrita destrutiva em disco interno sem contrato, prova, consentimento explícito e autorização do alvo;
- não introduza Git operacional no Stable/MVP;
- não anuncie recurso futuro como disponível;
- não invente preços, tiers ou limites comerciais;
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
- `docs/contracts/foundation.json`;
- `docs/contracts/sync-model.json`;
- `docs/contracts/first-run.json`.

Este documento define o **escopo público do MVP**. Os contratos machine-readable continuam autoridade dos invariantes técnicos.