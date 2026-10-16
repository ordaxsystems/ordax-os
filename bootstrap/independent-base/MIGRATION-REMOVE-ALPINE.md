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

`.github/workflows/remove-alpine-fast.yml` roda somente em `platform/remove-alpine` para mudanças relevantes e valida contratos, testes unitários, sintaxe e compilação Python sem compilar Buildroot, kernel ou imagem USB inteira.

O gate também executa `tests/test_alpine_removal_boundary.py`, que congela o conjunto atual de consumidores Python de `bootstrap/base/alpine_core.py`. Novos consumidores são proibidos; a allowlist só pode encolher à medida que a migração avança.

Objetivo: permitir ciclos normais de desenvolvimento em minutos, sem transformar cada commit em build completo e sem permitir que a dependência Alpine cresça durante a remoção.

### Gate pesado

`.github/workflows/independent-base-experiment.yml` continua sendo a prova pesada existente, com Buildroot, kernel verificável e QEMU. Ele não é o loop de desenvolvimento diário.

Executar o gate pesado somente quando necessário:

1. manualmente durante marcos da migração;
2. no PR final de integração quando os paths afetados o exigirem;
3. depois de mudanças estruturais em Buildroot, kernel, EROFS, boot handoff ou rede mínima.

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

A otimização correta é reutilizar componentes autenticados e content-addressed, não pular verificação. O workflow pesado já reutiliza o kernel verificado por fingerprint. Próximas otimizações devem priorizar cache seguro de downloads e componentes Buildroot cuja identidade seja derivada de inputs versionados.

Não compartilhar diretórios mutáveis de build entre commits como se fossem artefatos verificados.

## Documentação canônica relacionada

A política geral permanece nos owners existentes:

- `docs/DEVELOPMENT-WORKFLOW.md` — branch temporária e loop de desenvolvimento;
- `docs/BUILD-AUTONOMY.md` — separação entre gates baratos e provas caras;
- `bootstrap/independent-base/README.md` — estado e limites da implementação Buildroot;
- `docs/CURRENT-STATE.md` — só deve declarar a troca como estado corrente depois que o corte estiver integrado em `main` e comprovado; a existência desta branch não muda o estado Stable/canônico.

## Critério de conclusão

A migração termina quando Alpine deixa de ser dependência ativa do runtime/base canônico, os consumidores foram convergidos para owners neutros ou para a Independent Base, a prova completa passa e `main` volta a conter uma única implementação ativa sem compatibilidade Alpine residual desnecessária.
