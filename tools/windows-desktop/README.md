# OrdaX OS Desktop Dev — Windows (Alpha)

**Produto pretendido:** a mesma fonte canônica do OrdaX OS USB, em uma
aplicação Windows. Não é um segundo OrdaX nem um fork da Surface. As
diferenças permitidas são as capacidades que exigem Windows em lugar do
kernel/serviços Linux; o Windows deve ter Internet, Conta OrdaX, apps, Spaces,
Intelligence, modelo local e os mecanismos de atualização aplicáveis à
modalidade. O objetivo é **paridade de produto**, não um emulador visual.

**Estado real deste build:** ALPHA INCOMPLETA. A implementação já compartilha
`system/composition/native`, `system/apps`, `system/services` e os
contratos, mas diversas portas ainda são um host de desenvolvimento. Um
arquivo existente no instalador não prova a capacidade funcionando. A
matriz, bloqueios e gates estão em
[`docs/plans/ordax-os-desktop-windows-ssot-2026-10-20.md`](../../docs/plans/ordax-os-desktop-windows-ssot-2026-10-20.md).

## Integração com a source authority atual — 25/10/2026

O Windows consome **a mesma revisão OS de `main`** utilizada pelos outros
modos. A revisão visual é **a única Surface externa** fixada por
`docs/contracts/surface-source.json`, propriedade de
`ordaxsystems/ordax-surface`. O código visual antigo
`system/surface/ui` e `system/surface/workspace` **não é rastreado pelo
repositório OS**. A CI Windows usa o verificador já canônico
`tools/surface-source/materialize.py` em checkout *descartável*, validando
proveniência Git e materializando a Surface apenas para build/teste e
empacotamento desta candidata. Não há segundo editor da UI.

A PR foi reconciliada com a `main` em `cbd4a9b9`, sem rebase/force-push,
e conserva os ajustes específicos Windows. O navegador usa o mesmo protocolo
Native, com transporte específico de Electron apenas quando seu bridge
restrito existe; indisponibilidade de bridge privilegiado do USB não é
substituída por uma autoridade falsa.

**Staging Dev por fonte foi implementado; a jornada real instalada ainda
não está homologada.** `dev-update.cjs` usa o mesmo OS SHA da `main` e o
`source_commit` da Surface fixado nesse commit. `surface-stage.cjs` é o
adaptador Git/Windows: obtém a revisão exata, valida origem, blobs Git,
limites e recusa symlinks; monta os arquivos visuais somente durante a
compilação, remove o overlay e grava o recibo OS/Surface com SHA-256 de
todos os ativos compilados. `hasNativeBundle` impede boot de candidata
sem lock, sem recibo ou com ativo JS/CSS alterado. Isso foi testado em CI e
fixtures Git offline; **ainda falta uma atualização real instalada
`main A → main B → health/rollback` no Windows**. Não chamar isso de paridade
completa do `ordax-pull` até essa prova, nem instalar Python no usuário
ou distribuir uma segunda cópia permanente da Surface.

Os perfis `owner-development` e `stable-mvp` continuam definidos somente
em `docs/contracts/distribution-profiles.json`: o primeiro pode utilizar
desenvolvimento Git controlado e o segundo deve consumir **releases assinadas
sem Git obrigatório**. O Windows executa o mesmo produto com adaptadores de
host distintos; **não** possui outro catálogo de apps, outro mecanismo de
assinatura, outra política comercial ou uma segunda versão de código.
O instalador CI agora transporta o lock da Surface e o recibo contendo
OS SHA, Surface SHA e fingerprint SHA-256 dos arquivos Native gerados. O
Electron recusa abrir o bundle de instalação se faltar esse manifesto ou
houver divergência dos bytes. Isso não é assinatura de release pública.
Intelligence/Aura local, autenticação real, updates assinados e rollback
E2E instalado ainda **não estão homologados**. A PR permanece draft.

## Desenvolvimento e empacotamento

A partir da raiz (Node/npm instalados):

```sh
npm ci
cd tools/windows-desktop
npm ci
npm start
# em Windows: npm run dist:win
```

O NSIS é uma **prévia sem assinatura**, exclusiva do canal de
desenvolvimento. A CI Windows usa `windows-desktop-dev.yml`, instala em
diretório isolado, verifica execução do Electron e valida o Runtime com
dependências não graváveis. O instalador ainda não possui medição e
porcentagem suficientes; concluir a otimização é um gate pendente.

## Composição canônica

- A mesma Surface e apps vêm de `system/`; não criar telas ou serviços
  Windows paralelos.
- `system/adapters/desktop/` é o dono de capacidades Windows.
  O host Vite/Electron não é autoridade de domínio.
- Primeiro uso/preferências usam estado isolado do usuário; não apagam
  nem alteram USB e não fabricam uma sessão de Conta OrdaX.
- Leitura de estado de rede Windows está ligada ao contrato já existente
  `ordax.network-status/1`; outras portas ficam indisponíveis até
  possuírem adaptador seguro e E2E real.
- Intelli­gence (serviços/contratos) está em `system/`, mas **não há**
  engine/pesos Windows homologados nesta alpha; apresentar modelo como
  conectado seria erro de produto.

## Atualização por perfil — política canônica

**Owner/Dev** acompanha a `main` oficial e precisa oferecer staging,
verificação, ativação transacional, health, rollback/pin e histórico, conforme
`docs/DEV-USB-GIT.md` e `system/contracts/update-status.mjs`.
O executor Windows em `dev-update.cjs` **não altera a árvore ativa**:
consulta `main` após abrir a interface, materializa uma candidata isolada,
valida commit/origem/ancestralidade e compatibilidade, ativa no próximo
início e conserva a anterior. Uma candidata sem recibo de saúde é revertida;
o rollback Owner mantém pin até desfixação explícita. O supervisor do emulador
não executa mais Git merge no aplicativo Desktop. O journal local guarda
apenas o estado de transação, **não** define outra política, versão ou registro
de componentes. Ainda falta comprovar Git `main` real no app instalado e
publicar as observações no contrato público `ordax.update-status/1`.
Não chamar isso de paridade completa do `ordax-pull` USB.

**MVP/Stable** não pode depender de Git; precisa de distribuição assinada
do aplicativo e componentes com release verificada, staging, health e
rollback, mantendo identidade/versionamento canônicos. **MVP no Windows
não está implementado neste build**.

As políticas de atualização não pertencem ao Electron e não podem gerar
um segundo update registry, uma segunda versão dos apps ou outra origem de
código. Artefatos e executores de instalação são específicos da plataforma.

## Testes e promoção

```sh
node --test tests/test_desktop_network_status.mjs
node --test tools/windows-desktop/runtime.test.cjs tools/windows-desktop/checkout.test.cjs tools/windows-desktop/dev-update.test.cjs tools/windows-desktop/surface-stage.test.cjs tools/windows-desktop/native-build.test.cjs
```

A CI verifica o processo Electron instalado, a Surface realmente montada, o runtime imutável e a porta de rede. O instalador alpha.6 passou esse gate: 83,4 s de instalação e 6,5 s de startup no runner Windows, sem promessa de tempo universal.
Homologação exige, além disso, Conta, internet real, armazenamento, apps,
Intelligence com inferência real, update Dev/MVP e rollback E2E no Windows
instalado. O fato de o bootstrap/USB e Desktop consumirem código Git idêntico
não prova atualizações equivalentes.

**Não mesclar/promover até esses gates; nunca sobrescrever o USB por
atualização do app Windows.**

### Alpha.6 — evidência

CI Windows [#39446071435](https://github.com/ordaxsystems/ordax-os/actions/runs/39446071435) passou NSIS, read-only, rede Desktop e Native montada. Instalação 83,4 s e startup 6,5 s no runner. A porcentagem do instalador e o canal MVP assinado continuam pendentes. O materializador Git só ficará operacional contra `main` após o contrato Desktop ser integrado à fonte oficial, sem promover a PR inacabada.
