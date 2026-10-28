# P0 — OrdaX Dev USB: build direto, incremental e independente de CI

Status: **PLANO URGENTE DE EXECUÇÃO** — 2026-10-27. Owner de implementação: `ordax-os`, PR **#2243** (mesma branch, sem PR paralela). **Este plano não declara solução implementada nem USB pronto.**

## Problema confirmado

O desenvolvimento Owner/Dev ficou acoplado à homologação no GitHub Actions. Na revisão `8162efdb`, o QEMU exigiu o artefato `native-surface-runtime.erofs` antes de o produtor disponibilizá-lo; o cache GitHub falhou e o armazenamento R2 não estava configurado no runner. Um cache miss não pode virar um bloqueio permanente ou reconstrução repetida de kernel/base/Surface. O Creator e o build Surface ainda estavam pendentes na última verificação. **Não confundir workflows verdes de contrato com USB inicializável**.

## Decisão do proprietário do projeto

**DEV DIRETO PRIMEIRO. CI É EXECUTOR OPCIONAL, NÃO AUTORIDADE NEM PRÉ-REQUISITO DO USB DEV.** Implementar a correção na origem, no repositório e nas ferramentas; não resolver por instruções específicas de chat, rotinas manuais não documentadas, segundo builder, Alpine, fallback inseguro ou afrouxamento de Stable.

- Linux é o **kernel**. Base nativa Buildroot/musl, runtime gráfico Cage/Wayland/Mesa/WebKit e serviços OrdaX têm seu ciclo de build próprio; isso NÃO implica reconstruí-los a cada mudança.
- Preservar **um produtor canônico por componente**: `bootstrap/independent-base/build.py`, `bootstrap/surface-runtime/build.py`, produtor canônico de kernel/initramfs, montador de imagem e `ordax-creator` independente. Nenhum executor GitHub inventa outra receita.
- Fluxo diário: **editar → testes afetados → compilar SOMENTE componentes cujas entradas mudaram → reutilizar artefatos por fingerprint + SHA256/proveniência → montar imagem DEV → teste rápido → opcional gravação explícita em USB removível**.
- Surface e serviços atualizados isoladamente NÃO recompilam kernel; USB não precisa ser regravado quando update/delta no dispositivo serve. QEMU é teste útil, não requisito para obter uma imagem DEV local.
- Separar três ações visíveis: `dev build` (incremental), `dev image` (montagem para teste) e `release verify/publish` (homologação completa). Os nomes reais dos entrypoints devem ser escolhidos a partir dos owners atuais — **não criar nova CLI duplicada**.

## Sequência obrigatória na PR #2243 (sem micro-PRs)

1. **Auditar entrypoints reais** de kernel/base/Surface/Creator, caches, caminhos de composição e documentação; identificar dependências causais, bloqueios artificiais e atualizações Git em andamento. Fixar o grafo com fingerprints de fontes, configs, toolchain e ambiente.
2. **Desacoplar a montagem DEV da CI**: executar os builders já existentes em ambiente Linux compatível (máquina local, VM ou runner) por um comando documentado e reprodutível, sem credenciais GitHub Actions, publicação Stable ou exigência de QEMU completo. No Windows, `ordax-creator` consome artefato verificado, sem exigir toolchain do usuário final.
3. **Cache persistente e verificado**: cache de downloads, compilados e imagens com provenance/digests; validar entradas e reusar; cache miss produz **uma vez** o componente no executor responsável; QEMU consome resultado, nunca compila segundo EROFS. Não confiar cegamente em cache, não recomputar tudo por troca de job.
4. **Dois níveis de prova**: DEV rápido (checks locais afetados, integridade das imagens, QEMU smoke opcional, boot físico sob autorização explícita); release/homologação (CI extensa, duas inicializações offline, rollback, assinatura, promoção). Não equiparar imagem DEV não homologada a release assinada Stable.
5. **Creator USB DEV**: montar do conjunto exato kernel/base/initramfs/Surface/ESP + contratos/receipts; gerar imagem verificável independente da CI; escrita física somente no dispositivo removível explicitamente escolhido e inspecionado. Sem escrita no disco interno nem promoção Stable.
6. **Regressões automáticas**: modificar código + testes que provem que mudança Surface NÃO chama kernel/Buildroot base, mudança serviço NÃO recompila EROFS, alteração kernel invalida apenas dependentes, cache hit pula compilação cara, cache miss volta ao produtor e montagem DEV não depende de `GITHUB_ACTIONS`, R2 ou QEMU.
7. **Concluir o corte**: evidência de imagem DEV gerada, hashes, boot e health observados; distinguir “imagem gerada” de “USB gravado/testado”; fechar PR #2243 com CI apropriada e integração na `main` apenas quando íntegra. Não sacrificar integridade da entrega para obter CI verde artificial.

## Critérios objetivos de aceite

- Um executor Linux configurado segue instrução versionada do repositório para construir imagem USB DEV sem abrir workflow remoto.
- Após primeira compilação, rodar novamente sem alteração de insumos **não recompila** kernel/base/Surface. Mudança só na Surface usa caches do kernel/base; mudança apenas nos serviços não recompila runtime gráfico.
- Mesmo artefato verificado é usado pelo Creator e pela prova de QEMU. A ausência de EROFS produz erro de dependência claro com comando do produtor, não reconstrução monolítica implícita.
- Artefatos e provenance identificam **SHA fonte, entradas/fingerprint, ferramenta, hashes e alvo**. Sem duplicação de owners.
- A PR #2243 disponibiliza os comandos e as evidências reais; **até lá, não dizer que a funcionalidade existe**.

## Regras de continuidade para outros chats/agentes

**Ler este documento + `AGENTS.md` + `docs/DEVELOPMENT-WORKFLOW.md` antes de atuar no USB Dev.** Consultar HEAD, CI, caches e artefatos atuais; não usar estado de conversa como verdade. Trabalhar na PR #2243, sem reformular escopo, criar nova arquitetura, iniciar recompilações paralelas, abrir PRs auxiliares ou bloquear DEV por gates de Stable. Não abrir novo build caro enquanto outro produtor do mesmo fingerprint estiver executando; não cancelar trabalho caro já iniciado sem causa específica. Corrigir causa raiz, registrar teste e evidência no source. Se houver bloqueio real de ambiente, identificá-lo precisamente e manter o restante executável.

## Estado inicial do plano, não prova de execução

PR: https://github.com/ordaxsystems/ordax-os/pull/2243

HEAD verificado na criação: `8162efdb048935bb6ab1e9b0439ce3f34ab92c84`; QEMU sem EROFS; jobs de Creator e Independent Surface pendentes. Esse estado envelhece; reler GitHub antes de continuar.

**Próxima ação de engenharia:** implementar o entrypoint DEV reproduzível por composição dos builders existentes e os testes de não-recompilação, evitando modificar um produtor pesado já ativo antes de entender o estado do run.

## Implementação parcial registrada em 2026-10-27

Entry point inicial **somente de componentes**: `python3 tools/ci/dev_components.py plan --component all` mostra o que falta; `python3 tools/ci/dev_components.py build --component base` ou `--component surface` chama os builders existentes e verifica o resultado. `--root /caminho/externo` permite cache persistente fora do checkout. Não depende de variáveis GitHub Actions nem escreve USB. Testes de regressão: `python3 -m unittest tests.test_dev_components_direct -v`.

**Limite explícito:** isso NÃO monta imagem USB, não substitui o Creator e não prova cold boot. Não declarar tarefa concluída até integrar composição/Creator e testar de verdade. O orquestrador usa fingerprints de entradas conservadoras; conferir/expandir dependências reais e travamento concorrente antes de executá-lo em ambientes paralelos. As provas da CI ainda não foram executadas nesta intervenção.

### Extração do manifesto Owner/Dev (etapa concluída no source)

A derivação do manifesto antes embutida no workflow `creator-owner-dev-git.yml` foi movida **sem segunda receita** para `tools/creator/owner_dev_manifest.py`; o workflow chama o mesmo arquivo. Uso fora da CI a partir da raiz do checkout com os artefatos kernel/initramfs já produzidos em `out/`: `python3 tools/creator/owner_dev_manifest.py /tmp/minimal-bootstrap-owner-dev.json`. A versão do kernel deriva de `bootstrap/kernel/source.json` caso a variável opcional `ORDAX_KERNEL_VERSION` não esteja definida. **Esta etapa não produz sozinha imagem USB**; exige artefatos locais preparados. Ainda falta provar por CI e extrair/compor o restante do caminho direto.

### Etapa adicional: staging Owner/Dev fora da CI (código, sem prova física)

O estágio lógico do Creator foi extraído para `tools/creator/owner_dev_stage.sh` e o workflow existente agora usa **exatamente** essa receita. São necessários manifesto derivado, caminho vazio de payload, caminho vazio de stage, CLI canônica do Creator, diretório de rootfs verificado e produtor Surface EROFS verificado. A variável `ORDAX_DEV_GEOMETRY_OUT` define o destino da geometria derivada. O script conserva as chamadas ao Core `verify-payload`/`stage-tree`, verificação offline da Surface, capacidades Owner e recusa de symlinks; não autoriza mídia física. `sudo` continua necessário para materializar rootfs com metadados próprios; é dependência de host real que deve ser formalizada, não um novo gate de CI.

**Lacunas abertas:** geração local de kernel/initramfs/raiz integrada; RAW descartável `disposable_media.py` ainda encadeado no workflow; CI da revisão, integração do Creator independente e boot real. Não classificar staging como USB final.

### RAW Dev direto — integração de execução (2026-10-27)

O produtor RAW continua **único** em `tools/creator/proof/disposable_media.py`. O entrypoint `tools/creator/owner_dev_raw.py` apenas delega `--contract`, `--stage-root` e `--output-root`; o workflow chama agora o mesmo entrypoint. Exemplo após staging validado:

```bash
sudo python3 tools/creator/owner_dev_raw.py \\
  --contract /tmp/owner-dev-physical-media.json \\
  --stage-root /tmp/owner-prototype-stage \\
  --output-root /tmp/owner-prototype-media
```

A saída é descartável, **não autorização de gravação**. A prova RAW, o teste QEMU, a evidência de boot e a publicação permanecem separadas. Teste adicionado: `python3 -m unittest tests.test_owner_dev_raw_direct -v`. Não declarar USB pronto até passar os testes e existir artefato verificado. Esta extração ainda não fornece automaticamente os insumos de kernel, initramfs ou rootfs.

## Modelo de desenvolvimento após o cutover — decisão de desacoplamento

A arquitetura-alvo não implica criar novos repositórios. Respeitar owners existentes: `ordax-os` (kernel/base/serviços/composição), `ordax-surface` (UI), `ordax-apps` (apps removíveis), `ordax-runtime` (runtime local conforme contrato), `ordax-platform` (serviços remotos), `ordax-creator` (produto Creator) e `ordax-site` (site público). Confirmar ownership vigente em `docs/contracts/repository-ownership.json` antes de qualquer migração.

### Matriz de impacto exigida

| Alteração | Build mínimo | Ativação esperada |
| --- | --- | --- |
| UI/CSS/JS da Surface | pacote visual da Surface + testes relevantes | atualizar UI; não reconstruir WebKit/Mesa/base/kernel |
| Aplicativo removível | pacote do app + seus testes | atualizar o app |
| Serviço Native do OS | serviço e dependentes reais | restart/health do serviço; sem recompilar kernel |
| Runtime gráfico Cage/WebKit/Mesa | EROFS gráfico, se suas entradas mudaram | restart de sessão/health, mantendo rollback |
| Base Buildroot/musl | base e dependentes efetivos | transação de base quando exigida |
| Kernel/initramfs/boot | artefatos afetados + prova de boot | slot/boot, reinicialização e rollback quando exigidos |

Esta matriz é **critério de projeto**, não afirmação de que todos os caminhos já funcionam. O kernel Linux é um componente; os demais binários Native também precisam de build próprio quando suas entradas mudarem.

### Regras anti-regressão

1. CI executa receitas canônicas, mas não é pré-requisito para produzir imagem DEV em executor compatível. Homologação completa fica no fluxo de release.
2. Não criar novo repositório para artefato, cache, SDK, serviço ou interface cuja responsabilidade já pertença a owner existente.
3. Surface visual separada do runtime gráfico compilado: modificar visual não recompila WebKit, Mesa, Cage ou kernel. Verificar fingerprints e testes que comprovem isso.
4. USB físico só é regravado quando necessário; para atualização de componente, usar transação versionada com health e rollback já contratados.
5. Dev rápido não significa ignorar integridade, isolamento de dispositivos, autorização de escrita em mídia ou confiança de artefatos.
6. Registrar tempos e contagem real de compilações no primeiro build e nos rebuilds sem mudança, só Surface e só serviço; nenhuma promessa de duração sem medição.
7. Antes de extrair outro módulo para novo owner, demonstrar acoplamento real, consumidor concreto, contrato de migração e ausência de autoridade duplicada.

**Próxima prova prioritária:** teste automatizado que altere somente arquivos visuais externos e constate que kernel, Buildroot base e runtime gráfico são reutilizados, seguido da primeira geração RAW por comando direto fora da CI. Os comandos extraídos anteriormente permanecem candidatos até execução e provas end-to-end.

## Auditoria transversal — Windows Desktop e Apps (2026-10-27)

Escopo de análise complementar, **sem ampliar a execução de código da PR #2243**: não abrir PR paralela, não remover jobs no escuro e não criar segunda autoridade de build. As responsabilidades continuam no contrato de ownership vigente.

### Fatos verificados
- `ordax-os/.github/workflows/windows-desktop-dev.yml` produz candidato Desktop Windows baseado no OS e consome a Surface externa fixada por SHA em `docs/contracts/surface-source.json`. O job prepara visual em runner Windows, usa Node/Python, testa contratos e empacota o candidato.
- `ordax-runtime/.github/workflows/windows-product-build.yml` constrói produto Windows do Runtime, com contratos/empacotamento e fonte do Studio fixada externamente. **Antes de chamar duplicação, mapear os produtos finais e quem os consome.**
- `ordax-apps/.github/workflows/foundation.yml` faz verificações abrangentes em push/PR na main, incluindo dependências cross-repo; `notes-unsigned-candidate.yml` constrói pacote de Notes a partir de `tools/app-package/build.py`.
- A existência de um workflow GitHub não é requisito para desenvolver/executar aplicativos ou Desktop.

### Contrato-alvo de desenvolvimento
1. **Windows Desktop**: comando local `dev`/watch/HMR no owner correto; editar Surface ou lógica sem reconstruir instalador, Runtime ou OS. Serviço e UI reiniciam/atualizam isoladamente onde suportado. Empacotamento e assinatura só em `package`/`release`. Verificar que os dois jobs Windows representam artefatos diferentes, ou consolidar responsabilidade se duplicam.
2. **Apps**: cada aplicativo deve ter comando de execução local e testes de sua responsabilidade. O comando `package` reutiliza o packager canônico; publicar/verificar releases é uma etapa separada. Um app não deve exigir workflow GitHub ou testes globais de todos os apps para executar localmente.
3. **Surface**: manter única fonte em `ordax-surface`, com visual servível em preview sem recópia manual para OS; o empacotador do consumidor fixa SHA para release, mas preview Dev não precisa reconstruir EROFS nem instalador.
4. **CI enxuta**: gates rápidos e por impacto para PRs, integração cross-repo só quando contratos/locks mudam, builds de instalador/pacote completo apenas quando artefatos respectivos são alterados ou publicação é solicitada. Não eliminar checks mandatórios de proteção de release/segurança ao publicar.
5. **Provar com dados**: inventariar workflow → artefato → consumidor → gatilho → custo/duração → comando local equivalente; apontar redundâncias reais, então reduzir gatilhos e jobs. Contar rebuilds de Surface-only e app-only; meta é **zero builds de kernel/base/instalador** para mudanças exclusivamente de UI/app.

### Ordem e limites
A **prioridade P0 atual ainda é gerar USB Dev diretamente na PR #2243**; este diagnóstico Windows/Apps previne regressão conceitual, não justifica atrasar a entrega do USB ou migrar novos owners. Executar otimizações adicionais nos repositórios respectivos só após auditoria, sem supor que os workflows possam ser apagados em bloco.

## Limpeza transversal de GitHub Actions — autorização explícita do proprietário (2026-10-27)

**Diretriz:** em ambiente DEV, retirar workflows desnecessários em TODOS os repositórios OrdaX, sem manter verificações duplicadas só porque foram criadas no passado. NÃO interpretar esta diretriz como autorização para apagar a receita de build, o teste em si, assinaturas, recuperação, implantação ativa ou contratos de consumidor. GitHub Actions deve ser apenas um executor opcional para desenvolvimento; manter jobs de publicação/deploy ou verificação exigida na integração quando não houver substituto. Reduzir acionamentos por paths/impacto antes de manter CI de alto custo em todo PR.

### Inventário inicial (2026-10-27)

- `ordax-os`: 164 workflows no inventário inicial.
- `ordax-apps`: 12.
- `ordax-runtime`: 7.
- `ordax-platform`: 17.
- `ordax-surface`: 4 (antes da limpeza).
- `ordax-creator`: 3.
- `ordax-site`: 1.

Total observado: **208** definições de workflow em sete repositórios (contagem de arquivos, NÃO de execuções ou workflows obrigatórios). Cada arquivo deve ser classificado por gatilhos, comando real, consumo de artefatos, dependências, branch protection, custo, uso atual e proprietário. **Não excluir por nome**, nem assumir que workflows distintos duplicam o mesmo produto.

### Remoções executadas

1. `ordax-surface/.github/workflows/import-os-visual-source.yml`: removido da `main` no commit `4109df9e`; era importador único da migração histórica e a branch de destino `migration/surface-source-20261023` já existe. Preservada a história Git da migração, não o workflow executor.
2. `ordax-os/.github/workflows/creator-owner-build-diagnose.yml`: removido **na branch da PR #2243**, commit `b88b98c3`. Era dispatch manual separado do Creator com jobs de build/diagnóstico e sem triggers automáticos. Manter diagnósticos via testes/builders canônicos, não segundo pipeline.

### Critério de decisão reproduzível

- **Eliminar:** workflow de migração concluída, experimento aposentado ou diagnósticos duplicados sem consumidor obrigatório.
- **Consolidar:** testes semânticos iguais, mesmo produtor de artefato sob vários nomes e jobs que podem chamar a mesma receita; remover antigos apenas depois de migrar consumers.
- **Reduzir disparos:** CI que roda para toda mudança sem impacto; reservar provas pesadas para alterações relevantes e ações deliberadas.
- **Manter com justificativa:** publicação/deploy efetivo, assinatura, fronteira de confiança, recuperação crítica, protections obrigatórias sem substituto e testes de integração cujo consumidor ainda depende deles.

**Continuação mandatória:** auditar os demais 206 arquivos do inventário inicial antes de removê-los; eliminar gradualmente os comprovadamente dispensáveis, na autoridade do repositório dono; verificar status checks requeridos, referencias `workflow_call`, scripts e automações de publicação; registrar remoções e prova de que nenhuma entrega ativa ficou órfã. **Não considerar esta limpeza completa ainda.** A urgência do USB DEV direto continua P0 e não deve voltar a depender dos workflows sobreviventes.

## Instrução de continuidade executável — não recomeçar pelo workflow

**Estado verificado na revisão desta documentação:** há código em `tools/ci/dev_components.py`, `tools/creator/owner_dev_manifest.py`, `tools/creator/owner_dev_stage.sh` e `tools/creator/owner_dev_raw.py`. Estes são entrypoints **parciais**, não um comando comprovado de USB completo. Nunca tratar testes adicionados como testes aprovados sem sua execução real.

### Operações já versionadas para testar primeiro

```bash
# Sem compilar componentes; inspecionar necessidade de build:
python3 tools/ci/dev_components.py plan --component all

# Regressões rápidas, sem build de kernel/Buildroot/QEMU:
python3 -m unittest tests.test_dev_components_direct tests.test_owner_dev_raw_direct -v
python3 -m py_compile tools/ci/dev_components.py tools/creator/owner_dev_manifest.py tools/creator/owner_dev_raw.py
bash -n tools/creator/owner_dev_stage.sh

# Apenas com insumos kernel e initramfs existentes e verificados:
python3 tools/creator/owner_dev_manifest.py /tmp/owner-dev-manifest.json
```

`owner_dev_stage.sh` exige, além desse manifesto, Creator Core executável, rootfs preparado, Surface produzida e caminhos de saída; `owner_dev_raw.py` exige stage e contrato de geometria verificados. Não invocar essas operações com caminhos fictícios; não presumir compilação concluída por documentação.

### Critério da próxima intervenção

1. Obter resultados dos testes rápidos e corrigir defeitos reais no próprio source.
2. Identificar o produtor canônico de kernel/initramfs e **reusar** seus artefatos/receipts; não encadear recompilação monolítica.
3. Compor estágio e RAW de verdade a partir de entradas verificadas. Validar prova/hash e, se possível, QEMU.
4. Registrar comandos e evidência de saída/estado; separar `RAW gerado`, `boot provado` e `USB físico gravado`.
5. Só então concluir PR #2243 na `main` após validação, sem confundir documentação com entrega.

O conjunto de workflows remotos deve permanecer apenas onde houver função comprovada de testes exigidos, integração, distribuição ou implantação. O caminho local não deve depender de status remoto para construir componentes DEV.
