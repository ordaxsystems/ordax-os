# OrdaX OS no Windows — paridade de produto e SSOT (20/10/2026)

**Decisão Owner:** O instalável Windows de desenvolvimento não é uma demo da
Surface. Ele é um **host do mesmo produto OrdaX**, executado sobre Windows.
A única diferença autorizada é a implementação de capacidades de plataforma:
não instala kernel Linux, não faz boot/UEFI e não assume controle do hardware
do sistema hospedeiro. **Ele deve ter Internet.**

Este documento fixa o escopo da PR #2040 e evita que os próximos agentes
interpretem "Surface compartilhada" como paridade funcional. É um plano
de entrega verificável, não uma declaração de prontidão.

## Única autoridade

- Source e componentes: `system/contracts/`, `system/services/`,
  `system/apps/`, `system/surface/` e `system/composition/`.
- Adaptação Windows: **somente** `system/adapters/desktop/` e o shell mínimo
  `tools/windows-desktop/`. Sem `apps-windows`, `surface-windows`,
  `intelligence-windows`, second account service ou duplicate update policy.
- As cinco modalidades da família definidas em `docs/PRODUCT-MODES.md`
  continuam válidas. Este host é a materialização Windows do modo `desktop`,
  **não** um sexto produto/modo.
- Contracts canônicos: `docs/contracts/product-capabilities.json`,
  `docs/contracts/distribution-profiles.json`,
  `docs/contracts/update-nomenclature.json`,
  `system/contracts/update-status.mjs`, `system/contracts/product-family.mjs`.
- A versão do **instalador Windows** é distinta da versão do **OS**, dos
  componentes e da Entrega. O instalador alpha não autoriza uma release pública.

## Dev e MVP: uma política, dois canais, executores específicos da plataforma

| Perfil | Fonte | Contrato de segurança | Ativação Windows |
| --- | --- | --- | --- |
| Owner/Development | `ordaxsystems/ordax-os` `main` | origem/branch/SHA exatos, checkout íntegro, atualização staging + ativação transacional, known-good, health e rollback/pin; sem perda de dados | mecanismo Windows adaptado ao **contrato real** do `bootstrap/dev-base/ordax-pull`, `system/supervisor` e `docs/DEV-USB-GIT.md` |
| Stable/MVP | release OrdaX autorizada | artefato assinado, integridade/proveniência, aquisição e ativação/rollback verificadas; **Git não é dependência do MVP** | atualização assinada do pacote Windows + componentes internos compatíveis; nenhum flash/boot involuntário |

O código Linux `ordax-pull` não pode ser executado como shell nativo
Windows. **Compartilhar a política não implica copiar o executável.** Um
executor Windows deve satisfazer os mesmos gates observáveis e devolver o
mesmo contrato `ordax.update-status/1`; nunca chamá-lo de `ordax-pull`
homologado antes da prova de staging, pin, health, rollback e recovery.

O atual `tools/windows-emulator/dev-supervisor.mjs` usa `git merge
--ff-only` na árvore ativa: **NÃO É equivalente ao Pull Owner USB atômico**.
Ele permanece temporariamente como ferramenta de desenvolvimento, não
autoridade da distribuição Windows. O modo MVP não deve usar esse polling.

## Paridade — critério funcional, não presença de arquivo no ZIP

| Capacidade do mesmo OrdaX | Fonte SSOT | Windows exigido | Estado comprovado da alpha.2 |
| --- | --- | --- | --- |
| Surface, Central, First Run, Design, apps | `system/surface`, `system/apps`, `system/composition` | UI e comportamentos reais | apresentação e persistência limitada; não é E2E completo |
| Internet e estado da rede | `ordax.network-status/1`, `network.https` | HTTPS utilizável e observações reais; controles Wi-Fi Windows só sob suporte explícito | adaptador status read-only incluído nesta PR, E2E instalado em CI pendente |
| Conta OrdaX/Spaces/sync | `system/services/account`, `system/services/spaces`, `system/services/sync` | sessão real, seguro dispositivo, logout/revogação, reabertura | indisponível / não homologado |
| Arquivos, navegador, notas, app data, Store | `system/apps`, `system/services` + contratos | mesma UI/serviços, portas Windows reais e seguras | não homologados; interfaces sozinhas não contam |
| Intelligence, Assistant, Memory, modelos locais | `system/services/intelligence`, `system/services/local-ai` | motor e pesos Windows verificados, mesmo router/memory; prova de inferência offline | sem motor/modelo Windows; IA operacional ausente |
| MCP/Device Agent e permissões | OrdaX Platform/Runtime existentes | conexão account-bound e grants canônicos; sem novo executor | não integrado no shell |
| Updates Dev e MVP | `docs/DEV-USB-GIT.md`, contratos de update/release | staging/health/rollback por perfil com histórico real | Git Dev simplificado; MVP ausente |
| Wi-Fi, bateria, notificações, sistemas de arquivos | capacidades em `docs/contracts/product-capabilities.json` | APIs Windows mediante consentimento/política; leitura antes de mutação | não homologados |
| Kernel/boot/recovery/UEFI | Linux USB/Native | **não aplicável** ao host Windows; não exibir controles falsos | não aplicável |

Uma capacidade pode ficar indisponível **apenas** quando o host não a suporta
ou quando o gate de segurança/produto não está pronto. Isso não autoriza
remover sua UI, duplicar sua implementação ou afirmar que o OS está completo.

## Gates por prioridade

1. **Fechar o instalador e o boot:** medir tempo por etapa, arquivos,
   CPU/I/O, etapa/progresso real do NSIS; resolver travas, reduzir somente
   dependências comprovadamente desnecessárias, preservar upgrade e userData.
   Ao final exibir resultado verificável, nunca só uma animação percentual.
2. **Host Windows canônico:** compor cada porta usada por `system/composition/native`
   através de `system/adapters/desktop` ou cliente compartilhado; medir
   disponível/indisponível em uma matriz automatizada. Nenhum placeholder
   pode retornar sucesso.
3. **Conta/Internet/Apps:** login real e persistência autorizada;
   navegador isolado; arquivos com escopo/consentimento; app data; apps
   Native e Space/Sync. Testar reinicialização, offline e negação.
4. **Intelligence:** usar o router `ordax.intelligence/1` e backend
   `ordax.local-ai/1`, com engine/modelo Windows de proveniência
   verificada; testar prompt/response reais offline, cancelamento e saúde.
5. **Atualizações:** portar semântica Owner Dev de candidata atômica,
   verificação e rollback; implementar release MVP assinada sem Git.
   Validar edição na `main` → alteração ativa no Windows e no USB Dev
   por seus canais (físico USB exige gate e autorização próprios).
6. **Gate final:** CI Windows instala um build protegido contra escrita,
   reabre o app, percorre UI real e executa testes de cada capacidade;
   comparação com USB e contratos canônicos; crash/recovery/rollback;
   zero regressões. Somente então remover draft e avaliar promoção.

## Proibições e evidência

- Não sobrescrever pendrive, alterar disco interno, iniciar reflash nem
  mesclar PR inacabada para fazer um teste "passar".
- Não embutir localhost de modelos sem isolamento, credenciais na UI,
  executar terminal arbitrário como autoridade de app, nem transformar
  login em acesso de computador sem OAuth/permite/grants.
- Não usar `npm run emulator:windows` como substituto de teste de pacote
  instalado. A versão alpha.2 provou boot HTTP e pacote, mas não essa matriz.
- Relatar commits, CI, hashes, passos E2E e **gaps remanescentes** por recurso.
