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
node --test tools/windows-desktop/runtime.test.cjs tools/windows-desktop/checkout.test.cjs tools/windows-desktop/dev-update.test.cjs
```

A CI verifica o processo Electron instalado, a Surface realmente montada, o runtime imutável e a porta de rede. O instalador alpha.6 passou esse gate: 83,4 s de instalação e 6,5 s de startup no runner Windows, sem promessa de tempo universal.
Homologação exige, além disso, Conta, internet real, armazenamento, apps,
Intelligence com inferência real, update Dev/MVP e rollback E2E no Windows
instalado. O fato de o bootstrap/USB e Desktop consumirem código Git idêntico
não prova atualizações equivalentes.

**Não mesclar/promover até esses gates; nunca sobrescrever o USB por
atualização do app Windows.**
