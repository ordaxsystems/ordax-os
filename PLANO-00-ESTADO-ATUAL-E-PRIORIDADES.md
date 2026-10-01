# OrdaX — estado atual e prioridades de execução

**Status:** overlay factual de execução. **Revisão:** 26/09/2026. **Base:** `main`, sempre revalidada contra contratos e source estruturado; este documento não fixa um SHA como autoridade.

Este arquivo existe para impedir que inventários históricos dos planos longos sejam usados como se fossem o estado atual do repositório. Ele **não substitui a especificação de produto** de `PLANO-FUNCIONAL-SURFACE-E-APPS.md` nem a análise de legado de `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md`. Quando houver divergência sobre **o que já existe, o que já foi provado ou qual é a próxima prioridade**, prevalecem, nesta ordem:

1. contratos e código estruturado do commit atual;
2. `docs/CURRENT-STATE.md` e `docs/PROMOTION-GATES.md`;
3. este overlay de execução;
4. inventários e prioridades históricas dos planos longos.

Antes de implementar qualquer item marcado como ausente em plano anterior, revalidar o source atual. Drift documental não autoriza duplicar serviço, tela, contrato ou fluxo já existente.

## 1. Estado factual que não deve regredir

### Sistema

`Sistema` já possui navegação canônica por **Visão geral**, **Atualizações**, **Armazenamento**, **Diagnóstico** e **Sobre**, com targets internos validados e lifecycle compartilhado. O rodapé e os atalhos devem abrir esses destinos canônicos, não criar telas paralelas.

A apresentação de atualização já separa versão do produto, Entrega, SHA e versões/modos dos componentes. Aplicativos e sistema não devem voltar a compartilhar uma identidade de versão fictícia.

O histórico de atualização já possui porta e apresentação consumível pela UI. A lacuna restante não é “criar histórico do zero”, mas ampliar comandos e informações somente quando houver contrato/autoridade reais.

### Diagnóstico

Diagnóstico já possui fluxo local de **preparar revisão**, indicar fontes incluídas/indisponíveis/falhas, avaliar atualidade da observação, mostrar estado de persistência do journal, **copiar resumo sanitizado** e **salvar/exportar a revisão preparada**. Falha ou cancelamento preserva a revisão para nova tentativa.

Portanto, os planos antigos que dizem que ainda faltam “tela local completa”, “estado de atualidade” ou “exportação revisável” estão obsoletos nesse ponto. O trabalho futuro de diagnóstico deve ser guiado por lacunas concretas de fonte, retenção, política ou prova — não por recriação desse fluxo.

### Arquivos

`ordax.file-space/11` já cobre navegação/listagem, criação de pasta, leitura textual limitada, renomeação, cópia/duplicação, movimento com regras explícitas, importação/exportação, **lixeira recuperável com restauração no-clobber**, metadados reais, busca/ordenação, Recentes locais, retomada da última pasta validada e catálogo local de Projetos. A lixeira pertence ao mesmo owner de file-space, usa namespace interno reservado e invisível, preserva caminho de origem em metadata privada e não oferece exclusão permanente no fluxo cotidiano do MVP.

Continuam lacunas reais como múltiplos itens/diretórios em operações que ainda não suportam isso, associações de “Abrir com”, miniaturas/visualizadores ampliados e outros recursos que exigem contrato próprio. Exclusão permanente/esvaziar Lixeira permanece deliberadamente fora deste primeiro recorte recuperável. A composição Web não deve fingir um filesystem real quando não houver adapter.

### Ajustes

Tema, contraste, redução de movimento e escala de texto já são preferências reais, validadas e persistidas. **Ajustes → Rede** já é o destino canônico para gerenciamento Wi‑Fi quando o adapter Native está disponível. Notificações também possuem política/store real para as fontes integradas.

Papel de parede arbitrário, idioma completo, periféricos/áudio avançados e outras preferências só entram quando houver capacidade real. Não criar controles cosméticos que não persistem nem alteram o dono correto.

### Conta e sincronização

A conta continua opcional para usar o OrdaX. A `main` já possui identidade real provider-neutral por gateway OrdaX, com o Supabase dedicado `ordax-control-plane` como backend atual, além de cadastro, login, refresh, logout, exportação autenticada e isolamento de sessão sem expor tokens do provedor à Surface. O gateway source v13 está implantado como Edge Function revisão 16 e inclui leitura autenticada/RLS de Spaces; isso **não** ativa login público. O navegador público continua **fail-closed** até os gates de origem HTTPS/same-origin, Auth hardening e legal autorizarem a ativação; isso não invalida o caminho real Native/USB.

O backend de continuidade por conta também já está aplicado e a mesma semântica `ordax.sync-transport/1` está integrada em source na Web e no Native/USB para `appearance`, preferências portáveis e metadata portátil do workspace. O Native preserva sessão e checkpoint em estado privado do dispositivo. A tela Conta → Sincronização agora distingue transporte disponível, continuidade autenticada ativa e host ausente a partir do snapshot real do runtime.

`Conta → Spaces` já consome somente Spaces reais da sessão, via gateway OrdaX e RLS, sem criar Space fictício e sem expor mutação/billing. `Conta → Memória` já monta no Native/USB a revisão da memória OrdaX real: owners `device|account`, busca/paginação, edição e exclusão com confirmação de persistência. O Web não finge memória durável. Essa UI não concede acesso automático da IA à memória; a ponte Intelligence continua exigindo autorização explícita da composition layer.

Isso ainda **não prova lançamento público de sync nem continuidade física entre dois dispositivos**: rollout público, prova multi-device em USB real, integração Mobile e novas classes como Notes/arquivos continuam pendentes e não devem ser anunciadas como entregues.

### Surface e prova física

O harness read-only do smoke integrado existe no source com coleta baseline/pós-tour, checklist machine-readable gerado por `tour-template` e `finalize` fail-closed que recalcula a comparação e exige os 12 itens do tour em PASS, incluindo Conta/Memória sem tornar login online requisito do boot. O resolver do harness reconhece tanto o runtime dinâmico Owner/Development quanto o runtime WebKit verificado Stable/MVP, e a coleta automática inclui o layout físico de teclado configurado/aplicado. Isso melhora a qualidade da evidência, mas não converte execução pendente em PASS físico.

Estados canônicos que permanecem explícitos em `docs/PROMOTION-GATES.md`:

```text
PORTABLE_V2_PID1_INTEGRATION=PASS_SOURCE
PORTABLE_QEMU_DIRECT_KERNEL_BOOT_BASELINE=PASS_CI_DISPOSABLE
PORTABLE_QEMU_UEFI_BOOT_BASELINE=PASS_CI_DISPOSABLE_OVMF_NON_SECURE_BOOT
PORTABLE_RUNTIME_V3_CURRENT_MAIN_BASELINE_PROOF=PASS_CI_EVIDENCE_FILE
PORTABLE_V3_UPDATE_ACTIVATION=PASS_CI_DISPOSABLE_ONE_SHOT_FAILURE_FALLBACK
PORTABLE_V3_UPDATE_ROLLBACK=PASS_CI_DISPOSABLE_REJECTED_SHA_FALLBACK_PHYSICAL_PENDING
PORTABLE_PHYSICAL_WRITER=PASS_TAGGED_INTERNAL
PORTABLE_PHYSICAL_USB_BOOT=NO
MVP_SURFACE_SMOKE_HARNESS=PASS_SOURCE
MVP_SURFACE_SMOKE_PHYSICAL=PENDING
CANONICAL_STABLE_GRAPHICAL_MODE=PENDING
CANONICAL_RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
PORTABLE_COLD_HEALTH_PROOF_SCOPE=PHYSICAL_STABLE_MVP_REQUIRED_NO_SYNTHETIC_CI
PUBLIC_PHYSICAL_APPLY=NO
```

O USB Owner/Development possui provas físicas próprias; elas não equivalem à promoção Stable/MVP canônica.

## 2. Prioridades atuais do sistema

### P0 — consolidar o Stable/MVP portátil a partir do estado já implementado

A consolidação USB-only da antiga PR #357 já foi integrada à `main`. Depois dela, o source avançou: o Portable v2 possui PID1 candidato conectado, verificação offline, Stable Base e runtime gráfico separado por conteúdo; o Creator também possui writer Portable v2 interno/tagged para o layout final `ORDAX-ESP + ORDAX-DATA`. A ativação Portable v3 está integrada à `main` sobre o **mesmo estado ext4 existente**, sem duplicar A/B nem criar symlink no exFAT: `prepare -> candidate one-shot -> cold-health -> commit/rollback`, com `rejected` persistente para não repetir um SHA ruim. O commit `c8c8fe526d03ced7630420cd116dd954b08ef03a` passou o baseline exato de boot direto e OVMF/UEFI no run `35598937763`. A prova dedicada posterior no source `837a99733654943f08a400d6cc3fb28bf84605f8` / run `35607396175` fechou também o caminho one-shot de falha em mídia descartável: candidate uma vez, segundo boot no previous, `rejected=candidate` e limpeza da transação. O commit saudável por cold-health e a prova física continuam separados. A evidência corrente desse baseline fica em `docs/evidence/portable-runtime-v3-main-proof.json`; não promover o contrato histórico como se ele provasse o one-shot.

A falha histórica `ORDAX-ESP partition not found` de um head antigo foi superada e não é uma pendência atual. Não voltar a habilitar flags BusyBox, aumentar timeouts ou criar rotas alternativas por causa daquele log sem primeiro reproduzir a falha no source e CI atuais.

O que permanece aberto é de outra classe: primeiro um **replacement canonical v4 release proof** para a `main` pós-hardening; depois consentimento físico novo para o contexto que esse proof vincular; e só então boot/recovery/cold-health Stable/MVP no USB final, Secure Boot e validação gráfica integrada em hardware. A prova agregada v4 de `b924ff8d74d1761232381ae3f9604bba17497cfd` continua válida apenas como evidência histórica pré-hardening e não pode ser rebinding para reabrir consentimento. Se um contrato de evidência conflitar com texto de plano, o contrato vence e o texto deve ser reconciliado.

### P0 — trust público resolvido; replacement proof v4 pós-hardening pendente

A infraestrutura de cerimônia, promoção do trust público, verificação e recuperação já está resolvida para o primeiro protótipo controlado. O anchor Ed25519 canônico de SHA-256 `d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250` está pinado, o recovery criptográfico passou e o full-bootstrap canonical-trust proof está fechado. A chave privada continua fora de Git, CI e USB.

O candidato Stable/MVP v4 histórico de `b924ff8d74d1761232381ae3f9604bba17497cfd` foi assinado, publicado como prerelease versionada, materializado/verificado e vinculado ao trust, manifest, envelope e três artefatos. Essa prova sustentou o primeiro proof físico pré-hardening. Depois das correções de produto/boot, o contrato `physical-write-authorization.json` voltou deliberadamente para `blocked-canonical-v4-release-proof-pending` e marca `canonical_v4_release_proof_bound=false` para o contexto corrente. Portanto o próximo passo não é consentimento: é gerar, assinar, materializar e vincular um replacement proof de outro source commit pós-hardening.

Os receipts históricos dos três EROFS permanecem evidência do candidato anterior; não autorizam a `main` atual e não podem ser reaproveitados como proof corrente. Backup off-device continua obrigatório antes de distribuição pública ampla; KMS/HSM gerenciado permanece evolução provider-neutral. Nenhuma dessas etapas seleciona USB, registra consentimento ou autoriza escrita.

### P0 — prova Stable/MVP integrada

Com o handoff Portable v2 implementado e a transação de update Portable v3 agora conectada em source, o próximo fechamento técnico é provar esse ciclo em mídia descartável: canal assinado -> materialização v3 -> arm one-shot -> reboot -> cold-health -> commit e também candidato falho -> rejected -> rollback offline. Depois disso, o fechamento canônico continua sendo trust real + publicação autorizada + prova física do USB final. Não reaproveitar evidência Owner/Development como se fosse prova de produto.

As provas baseline de QEMU direto e UEFI/OVMF reduzem o risco do boot candidato, mas continuam sendo prova descartável. O baseline do commit corrente da `main` está registrado em `docs/evidence/portable-runtime-v3-main-proof.json`; a prova dedicada `previous -> candidate one-shot -> previous + rejected` já passou em CI. A auditoria do runtime gráfico confirmou que o cold-health real depende do caminho Cage/Wayland/WebKit/seatd + host nativo + heartbeat/health com SHA exato; não existe hoje um modo headless equivalente que preserve essa semântica. Portanto, **não criar mock/synthetic cold-health só para fechar CI**: o próximo fechamento saudável deve ocorrer no USB Stable/MVP físico depois do trust/autorização. CI, Web candidate e USB de desenvolvimento não substituem `CANONICAL_NOTEBOOK_UEFI_BOOT`, `CANONICAL_STABLE_GRAPHICAL_MODE`, Secure Boot nem outras provas físicas canônicas pendentes.

### P0 — smoke físico da Surface

Executar o runbook source-controlled no notebook em uma única sessão técnica: gerar `tour.json` via `tour-template`, coletar baseline, realizar o tour funcional, coletar pós-tour, gerar `comparison.json` e encerrar com `finalize`. A sessão só pode ser promovida quando `final.json` tiver `FAIL=0`; não preencher manualmente PASS fora do checklist estruturado nem reutilizar comparação stale/editada.

### P1 — lacunas locais reais, sem expandir produto prematuramente

Depois dos P0, priorizar somente lacunas suportadas por necessidade concreta: comandos manuais do atualizador quando houver autoridade real; inventário/armazenamento além das métricas atuais quando houver contrato; recuperação local por perfil; lixeira/associações de arquivo; e melhorias de acessibilidade/continuidade ainda comprovadamente ausentes.

A fundação de identidade/entitlements, Spaces/Profile Packs, memória provider-neutral, distribuição de apps e Product MCP pode avançar em source sem deslocar os gates físicos do MVP. A **OrdaX Network limitada do MVP** é a única colaboração online promovida para este recorte e deve seguir `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`; cloud sync geral, colaboração além desse recorte, billing, Store pública e ferramentas mutáveis continuam sem precedência sobre release/USB/rollback.

### Recorte do legado `novo-ordax-os` para o MVP USB-only

Os planos longos registram capacidades herdadas como referência de produto, mas a decisão posterior do MVP mudou a prioridade. Para o MVP público atual, interpretar a matriz C01–C27 assim:

| Capacidade do plano legado | Decisão para o MVP | Estado/ação atual |
|---|---|---|
| C01 Arquivos | **ENTRA no núcleo do MVP** | Operações locais principais já existem. Fechar somente falhas reais de uso/smoke; lixeira, miniaturas e associações avançadas não bloqueiam lançamento. |
| C02 Rede/Wi-Fi | **ENTRA e é requisito do MVP** | Ajustes → Rede e painel rápido existem; falta prova Stable/MVP no hardware-alvo e correção somente de gaps reproduzidos. |
| C03 Sessão local / lock | **ENTRA no recorte local de segurança** | `ordax.local-session/1` + lock Native/offline estão PASS_SOURCE, independentes de conta cloud; falta prova física Stable/MVP. |
| C04 Workspace/projetos | **JÁ HÁ recorte suficiente; não é gate** | Áreas, janelas, Recentes e catálogo local de Projetos existem. Continuidade avançada fica posterior. |
| C05 Checkpoints de sessão | **PÓS-MVP** | Não bloquear o lançamento por restauração completa de rota/documento/posição/rascunho. |
| C06 Home contextual | **NÃO BLOQUEIA** | Melhorias de “continuar trabalho” são P1/P2; não criar outro shell. |
| C07 Hardware/compatibilidade | **ENTRA no recorte de suporte** | MVP precisa hardware suportado documentado e diagnóstico suficiente; inventário sofisticado de periféricos é posterior. |
| C08 Conta de produto | **ENTRA NO MVP, MAS CONTINUA OPCIONAL** | Supabase dedicado `ordax-control-plane` e gateway real já existem. O usuário pode continuar sem conta, mas Entrar/Criar conta devem funcionar de ponta a ponta antes do fechamento do MVP. Ativação continua fail-closed até hardening/legal/deploy e provas da #805. |
| C09 Sync cloud | **PÓS-MVP** | Core local pode permanecer; não implementar transporte cloud para fechar o lançamento. |
| C10 Mobile | **PÓS-MVP** | Em breve; depende de conta/sync reais. |
| C11 Desktop instalado / Creator | **Creator ENTRA; Desktop instalado NÃO** | Creator USB é P0. Instalação permanente/desktop Native continua pós-MVP. |
| C12 Apps instaláveis/SDK | **FUNDAÇÃO PRÉ-MVP; instalação externa pós-MVP** | Contrato de manifesto/distribuição assinada entra agora para não refazer supply chain depois. Instalar apps terceiros/SDK público continua fora do primeiro USB. |
| C13 Store | **FUNDAÇÃO PRÉ-MVP; produto Store pós-MVP** | Store futura usa o mesmo manifesto/updater/permissions; UI pública, publicação de terceiros e billing continuam posteriores. |
| C14 Perfis profissionais | **FUNDAÇÃO MVP via Spaces/Profile Packs + provisioning sob demanda** | Conta pessoal é separada. Catálogo leve, planner fail-closed e seção Perfis na Conta já fazem parte da fundação do MVP; Developer continua prova interna e Legal-BR permanece bloqueado até knowledge/trust profissional. Ver `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md`. |
| C15 Objetos/proveniência de produto | **PÓS-MVP** | Fora do lançamento básico. |
| C16 IA nativa | **ENTRA como capability do sistema** | Intelligence + backend local fazem parte do Stable/MVP v4. A fundação `ordax.memory/1` + `ordax.model-router/1` preserva memória OrdaX/provider-neutral e rotas futuras; cloud e tools mutáveis ainda não estão ativos. |
| C17 Conectores/automações | **BOUNDARY PRÉ-MVP; runtime pós-MVP** | Product MCP/OAuth e separação GitHub App/Space/project ficam definidos agora. Conectores ativos, automações e mutações continuam posteriores. |
| C18 Diagnóstico/exportação | **ENTRA no recorte local útil** | Revisão/exportação sanitizada já existe; evoluir somente lacunas concretas de fonte/retenção/prova. |
| C19 Controle remoto | **PÓS-MVP** | Rescue/observação existentes não viram controle remoto genérico. |
| C20 Update/health/rollback | **ENTRA e é gate do MVP** | Canal oficial sem Git e transação Portable one-shot estão integrados à main; baseline current-slot e fallback one-shot/rejected já passaram em CI descartável. Falta provar commit por cold-health e depois known-good/rollback no USB Stable/MVP físico. |
| C21 Instalação/storage/recovery | **USB/recovery ENTRA; Native NÃO** | Layout Portable, persistência e recovery do USB são MVP; instalação em SSD/NVMe/HD permanece desativada. |
| C22 Build/cache/retenção | **ENGENHARIA, não feature do MVP** | Otimizar CI quando medido; não recompilar kernel por mudança administrativa sem dependência real. |
| C23/C24 Intelligence/Lab/federação | **PÓS-MVP** | Fora da trilha de lançamento. |
| C25 Navegador/produtividade | **Internet básico ENTRA; office/editor amplo NÃO** | O app Internet é parte dos apps principais do MVP; suíte de produtividade completa não é gate. |
| C26 Onboarding/notificações/acessibilidade | **ENTRA no básico de produto** | OOBE persistente, rota sem conta e localização pública pt-BR/en-US estão PASS_SOURCE; notificações/acessibilidade seguem somente onde há contratos reais. Falta prova física Stable/MVP. |
| C27 Backup/histórico pessoal | **PÓS-MVP** | Não confundir backup de dados com rollback/known-good do sistema, que é P0. |
| C28 OrdaX Network | **ENTRA NO MVP ONLINE, NÃO BLOQUEIA BOOT** | Diretório profissional opt-in por Space, comunidades, grupos, mensagens 1:1/grupo e trust & safety mínimos. Autorização é server-side/default-deny e a falha da Network degrada sem impedir Surface/apps locais. Ver `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`. |

Portanto, o fechamento do **primeiro USB físico** continua dominado pelas provas de C02/C03/C07/C16/C20/C21/C26 e por qualquer gap C18 realmente reproduzido. Em paralelo, C08/C12/C13/C16/C17 recebem as fundações de domínio definidas no `PLANO-04`, enquanto C14 segue também o `PLANO-06` de provisioning sob demanda; elas evitam dívida arquitetural, mas não transformam Store, billing, sync cloud ou MCP mutável em gates da mídia física.

## 2.1 Modo de encerramento do MVP

A partir deste ponto, o objetivo é **terminar e instalar**, não ampliar o produto indefinidamente.

Regras:

1. frentes/PRs já em andamento podem concluir **a tarefa atual**;
2. depois da tarefa atual, não abrir continuação automática da mesma frente sem um gate de MVP reproduzido;
3. fora da OrdaX Network já adotada e limitada pelo `PLANO-08`, nova feature não entra antes do primeiro Stable/MVP pós-hardening no notebook;
4. bug reproduzido que bloqueia boot, rede, OOBE, Conta/Cadastro, Surface, app essencial, update, rollback, recovery ou segurança continua elegível;
5. ideias de Store, apps novos, Creative/Video/CAD/3D, sync amplo, Mobile, billing, Windows Compatibility avançado e demais expansões ficam em backlog/pós-MVP;
6. Conta permanece opcional para usar o sistema, porém **Entrar/Criar conta passam a ser gate funcional do MVP** quando o usuário escolher esse caminho;
7. o catálogo de planos pode ser estruturado antes do MVP, mas cobrança e preços não bloqueiam a primeira instalação;
8. só criar issue nova antes do MVP quando ela representar um gate real não coberto por issue/PR existente.

Ordem de fechamento:

```text
drenar PRs atuais relevantes
 -> Conta/Cadastro real + caminho sem conta
 -> OrdaX Network: authorization/RLS, trust & safety e prova E2E multi-tenant
 -> replacement canonical release proof
 -> autorização física válida
 -> Stable/MVP no notebook
 -> smoke Surface/apps/rede/IA
 -> update + known-good + rollback/recovery
 -> corrigir somente falhas reproduzidas
 -> congelar v0.1.0
 -> evoluir por atualizações
```

A issue #805 é o owner operacional de Conta/Cadastro real. A issue #586 continua sendo a referência para hardening/prova física Stable/MVP. Backlogs de expansão não ganham precedência sobre esses dois gates.

## 3. Regra para trabalho paralelo

A `main` é a linha de integração e a fonte de verdade do desenvolvimento. Nesta fase, evitar proliferação de branches e PRs:

1. manter **no máximo uma branch ativa por frente** e, preferencialmente, **uma PR aberta por vez**;
2. não abrir nova branch para cada correção pequena do mesmo incremento;
3. agrupar mudanças relacionadas antes de disparar CI, evitando uma nova rodada pesada para cada microajuste;
4. mudanças somente documentais ou claramente isoladas/não destrutivas podem ir direto para `main` quando não houver colisão e a política do repositório permitir;
5. mudanças de trust, boot, storage, updater, contratos canônicos, writer físico ou outros limites de segurança continuam usando uma branch curta + revisão/gates proporcionais;
6. CI deve ser acionado por **dependência real**: mudança em script administrativo não deve recompilar kernel/QEMU se esse script não participa do artefato;
7. após merge, a branch deixa de ser linha de trabalho; não criar uma branch substituta sem necessidade concreta;
8. antes de editar, ler a `main` atual e as PRs abertas, cruzar plano com contrato/source e distinguir `PASS_SOURCE`, `PASS_IN_AGENT_TESTS`, `PASS_PHYSICAL_DEVELOPMENT_USB` e prova física Stable/MVP;
9. após CI/merge, atualizar a afirmação factual correspondente — nunca antecipar resultado.

Se uma frente externa estiver mexendo no mesmo arquivo/owner, prefira outro gap real ou diagnóstico independente em vez de produzir uma segunda implementação.

## 4. O que não fazer agora

- Não reconstruir Sistema/Diagnóstico porque um inventário de 18/09 ainda os descreve como incompletos.
- Não reabrir a falha histórica `ORDAX-ESP partition not found` nem a antiga reconciliação da PR #357 sem reprodução no source atual.
- Não criar updater/store de produção para app `git-app`; Git é mecanismo de desenvolvimento, não atualização independente Stable.
- Não transformar prova QEMU ou CI em prova física.
- Não habilitar escrita física/destrutiva para “testar mais rápido”.
- Não colocar chave privada canônica em source, artifact público, CI ou pendrive do produto.
- Não criar forks Web/Native da Surface para resolver diferenças de capacidade.
- Não adicionar botões que impliquem login, nuvem, atualização, recuperação ou hardware quando a operação real não existe.

## 5. Critério para encerrar este overlay

Este arquivo pode ser absorvido ou removido quando os planos longos tiverem seus inventários/status integralmente reconciliados com o source e houver uma proteção equivalente contra drift. Até lá, ele serve como ponte de execução; não é um novo contrato de produto.
