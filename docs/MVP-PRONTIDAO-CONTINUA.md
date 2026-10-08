# OrdaX OS — prontidão contínua para o MVP

**Direção do produto:** manter um núcleo Stable/MVP mínimo, utilizável e em evolução contínua **sem definir antecipadamente uma data de lançamento**. A decisão comercial pode acontecer quando o produto e as provas reais estiverem prontos; novas funcionalidades não são pré-requisitos automáticos.

## Donos canônicos — não criar controle paralelo

| Responsabilidade | SSOT existente |
|---|---|
| Escopo integrado do ciclo MVP (USB + Native) | `MVP.md` (escopo), `docs/contracts/distribution-profiles.json` e `docs/contracts/native-installation.json` (disponibilidade) |
| Entrega dos apps do MVP | `docs/contracts/mvp-app-delivery.json` |
| App essencial vs opcional e atualização assinada | `system/services/apps/mvp-delivery-policy.mjs` e `system/supervisor` |
| Gates de produto, integridade, boot e promoção | `docs/PROMOTION-GATES.md` |
| Avaliação fonte/USB e autorização física | `tools/creator/stable_mvp_usb_readiness.py` e `docs/contracts/physical-write-authorization.json` |
| Distinção primeiro USB / Creator público | `tools/ops/first_mvp_operator_readiness.py` e `docs/contracts/creator-code-signing.json` |
| Trust e rollback do sistema | Contratos de release e ativação canônicos |
| Disponibilidade da compatibilidade Windows | `docs/contracts/application-compatibility.json` |

**Distinção obrigatória:** o ciclo de desenvolvimento/homologação do MVP inclui OrdaX Native em SSD/NVMe/HD. A candidata Stable atualmente habilitada continua **USB-only**; instalação Native e escrita destrutiva em disco interno seguem desativadas nos contratos até implementação, prova física, recuperação e autorização específica. Isso não adia o desenvolvimento Native nem autoriza ativá-lo por documentação, UI ou flag.

Nenhum relatório ou interface pode inferir `execution_available`, instalação, suporte físico, consentimento ou release pública a partir de PR aprovada, testes verdes ou uma versão de aplicativo.

## Fluxo de trabalho permanente

1. **A cada atualização da `main`:** executar o snapshot read-only `Stable MVP Continuous Readiness Snapshot`; registrar o commit exato, a fase atual e os gates pendentes em artefato de CI. É observabilidade, não publicação.
2. **A cada PR:** validar somente o domínio alterado e suas integrações; criar branches/PRs isolados, sem sobrepor alterações de outros chats. Não integrar mudanças com gates obrigatórios falhando.
3. **Núcleo Stable atualmente distribuível:** preservar boot USB, segurança/trust, primeira utilização, rede opcional, aplicativos essenciais, persistência, diagnósticos, atualização assinada, fallback e recuperação. Falhas nessa cadeia são bloqueadores do primeiro release USB; o recorte Native segue no ciclo MVP, com gates próprios, sem ser anunciado como disponível antes da homologação.
4. **Evolução em paralelo:** Loja completa, Wine, formatos de conteúdo, utilitários, recursos adicionais de IA, Studio e Apps podem avançar antes **e** depois do lançamento. Ausência de um componente opcional não pode tornar o boot ou a primeira utilização indisponíveis.
5. **Atualizar sem reinstalação do USB:** enquanto a distribuição independente `component-slot` não estiver comprovada, o canal Stable assinado do supervisor é o caminho canônico para adicionar/atualizar componentes, preservando versão anterior e rollback. Não criar um segundo updater.
6. **Ao decidir lançar:** selecionar um **commit candidato exato**, produzir/verificar release canônica v4 vinculada a seus bytes; a prova anterior não vale se o código foi alterado. Após a autorização explícita e a confirmação específica do dispositivo, executar as provas físicas atuais de boot, UI, primeira utilização, cold-health e rollback. Só então publicar no canal Stable.
7. **Se uma correção essencial alterar o candidato:** gerar/revalidar a prova para o novo SHA, em vez de reutilizar evidências antigas. Trabalho opcional continua em branches próprias sem mudar os bytes do release candidato.

## Leitura contínua, sem falso indicador de pronto

```sh
python tools/ops/first_mvp_operator_readiness.py --repo-root .
python tools/creator/stable_mvp_usb_readiness.py --repo-root .
```

O primeiro comando é o agregador **já existente**: compõe exatamente uma leitura da prontidão USB com o estado separado da assinatura e disponibilização pública do Creator. O segundo é a consulta direta do gate físico, útil para diagnóstico. O workflow executa **apenas o agregador** e deriva `status.json` do objeto USB aninhado; não repete a auditoria nem persiste novo estado.

`first_usb` indica a preparação/prova do primeiro USB controlado. `official_creator.publication_ready` indica o gate específico de identidade Authenticode e publicação do Creator oficial. **Um pode estar bloqueado sem que isso autorize ou bloqueie automaticamente o outro**. Nenhum dos dois campos, isoladamente, atesta que o produto inteiro pode ser lançado.

Workflow: `.github/workflows/stable-mvp-readiness-snapshot.yml`, acionado em todo push da `main`, por despacho manual ou PR que altere o boundary de prontidão.

O job é considerado bem-sucedido quando o **avaliador** funciona e o snapshot é íntegro. Isso **não** significa que o status interno seja `ready`, muito menos que a release pública esteja autorizada. O campo `remaining_gates` define o trabalho físico pendente; `status=ready` nesse avaliador significa, no máximo, *candidato autorizado para um fluxo físico posterior*, não lançamento liberado.

Artefatos incluem `operator.json` (agregador canônico), `status.json` (mesmo objeto USB sem nova avaliação) e explicação por SHA; só leitura, sem chave privada, sem seleção de USB, sem alteração da autorização, sem acionamento do writer e sem publicação.

## O que falta hoje para um lançamento público

A auditoria de source/CI e o boot em QEMU não substituem a prova física da Stable/MVP atual. A release canônica v4 existente é histórica/pré-hardening e não deve ser reaproveitada para uma nova autorização. Faltam prova nova exata da versão candidata, gate de pré-autorização, autorização do proprietário no contexto específico, testes físicos com leitura de artefatos, sessão gráfica, first run, apps essenciais, cold-health e rollback. Ver `docs/MVP-PRE-PHYSICAL-HANDOFF.md` para a ordem e os requisitos atualizados.

**Gates independentes do modo Native:** além das provas USB acima, a disponibilidade pública em SSD/NVMe/HD exige demonstrar instalação segura do disco inteiro selecionado, boot sem USB, proteção dos dados, health e rollback/recovery em hardware homologado; jamais promover `native_install_capability_enabled` ou escrita destrutiva por mera alteração documental.

**Regra de evolução:** otimizar o sistema e avançar seus recursos continuamente, mas nunca mascarar um blocker essencial como opcional, nem exigir concluir opcional para iniciar os procedimentos de lançamento.
