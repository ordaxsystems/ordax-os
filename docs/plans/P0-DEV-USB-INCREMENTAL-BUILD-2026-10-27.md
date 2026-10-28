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
