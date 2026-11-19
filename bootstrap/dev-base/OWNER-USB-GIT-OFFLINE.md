# Owner Dev — pacote Git offline pelo USB

O helper `bootstrap/dev-base/ordax-owner-usb-git` recebe um **pacote Git
de desenvolvimento** transportado por `ORDAX-DATA`, sem baixar um rootfs,
formatar o pendrive, alterar o checkout ativo ou ativar outra versão.

Entrada: diretório absoluto contendo exclusivamente os arquivos obrigatórios
`owner-git-bundle.txt` e `ordax-main.bundle`. O manifesto usa cinco linhas
LF exatas, nesta ordem:

```text
schema=ordax.owner-dev-usb-git/1
repository=ordaxsystems/ordax-os
source_commit=<40 lowercase hex>
bundle_sha256=<64 lowercase hex>
bundle_bytes=<decimal 1..1000000000>
```

`inspect ABSOLUTE_BUNDLE_DIRECTORY` verifica tamanho, SHA-256, único ref
`refs/heads/main`, integridade/pré-requisitos do Git bundle e origem do
checkout sem modificá-lo. `stage ABSOLUTE_BUNDLE_DIRECTORY` importa o
candidato apenas para `refs/ordax/offline/main` e exige fast-forward do
commit instalado. Nenhuma chamada executa `ordax-pull` ou `prepare`.

Ambos exigem `ORDAX_DISTRIBUTION_PROFILE=owner-development` e Git local
canônico. Os bytes são copiados para uma área privada antes da verificação,
para impedir troca do dispositivo durante o uso. O helper não é um mecanismo
de autenticação de origem: SHA-256 protege integridade, mas o manifesto de
desenvolvimento não possui uma assinatura de release. Por isso, este
transportador **não deve ser habilitado como ativação automática**, nem usado
no Stable, sem uma autoridade assinada e um handoff explícito ao Supervisor.

A seleção/montagem da partição, a geração de bundles no Windows e a ativação
continuam fora deste helper. A disponibilidade do helper em Git também não
significa que o pendrive físico já possua esta revisão.

### Consumo canônico no Supervisor (Owner Dev)

O `system/supervisor` monta temporariamente a partição 3 `ORDAX-DATA` do **mesmo**
disco removível que contém a raiz ext4 ativa, com `ro,nodev,nosuid,noexec`.
A identidade do disco deriva de `/proc/self/mountinfo` e `/sys/dev/block`,
sem selecionar outro pendrive apenas por rótulo. No ciclo existente do Supervisor,
a importação ocorre uma única vez por boot, através deste helper, e só alimenta
`refs/ordax/offline/main`. A montagem é desmontada em seguida.

O Supervisor continua consultando `origin/main` pela conexão HTTPS canônica.
Apenas quando esse SHA remoto corresponde **exatamente** aos objetos já importados,
reutiliza o cache para a preparação do `ordax-pull`, sem baixar esses objetos
novamente. O mesmo preflight, troca atômica, health-check e rollback existentes
seguem obrigatórios. Sem internet ou quando há discrepância, **não há ativação
offline**: o checkout atual continua íntegro e a reconciliação fica pendente.

A Base antiga, sem este consumidor, necessita de uma instalação inicial de Base
atualizada. Copiar o bundle para `ORDAX-DATA` não altera a Base instalada.
