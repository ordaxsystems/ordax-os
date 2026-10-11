# Publicação HTTPS canônica da candidata Stable v4

A candidata congelada \`03f88eeaf382a59aaefbcf4943d0639d2730741b\` passou pela prova de handoff assinado, mas a liberação pública dos arquivos EROFS ainda é uma ação distinta. O script **\`tools/release-operator/publish_verified_v4_release.py\`** é o operador específico desse passo. Ele reutiliza a admissão de pré-publicação existente e **não é um gravador de USB**.

## Antes de qualquer publicação

Utilizar somente o pacote exato verificado pelo Step 5, contendo \`release-manifest.json\`, \`release-envelope.json\`, \`system.erofs\`, \`native-surface-runtime.erofs\`, \`local-ai-runtime.erofs\`, a confiança pública e o release-agent correspondente à revisão congelada. É necessário também o pedido ativo em \`docs/contracts/canonical-v4-signing-request-active.json\` e o \`signed-handoff-verification.json\` emitido pelo workflow [38156353913](https://github.com/ordaxsystems/ordax-os/actions/runs/38156353913).

Na primeira execução, omitir \`--publish\`. Exemplo em um terminal com Git e Python:

\`\`\`powershell
python tools/release-operator/publish_verified_v4_release.py \`
  --source-root . \`
  --source-commit 03f88eeaf382a59aaefbcf4943d0639d2730741b \`
  --bundle-dir C:\Release\v4 \`
  --signing-request docs/contracts/canonical-v4-signing-request-active.json \`
  --signed-receipt C:\Release\v4\signed-handoff-verification.json \`
  --trust C:\Release\v4\release-ed25519.json \`
  --release-agent C:\Release\v4\ordax-release-agent.exe
\`\`\`

Esse comando realiza apenas leitura: confere a âncora pública da revisão congelada diretamente dos bytes do objeto Git, executa de verdade o \`verify-envelope\` do release-agent (assinatura Ed25519), confronta manifesto e recibo, verifica SHA-256/tamanho dos três EROFS por streaming e emite o plano das cinco URLs canônicas. Não inventa recibos.

## Publicar após revisão explícita

O mesmo comando, **com os mesmos caminhos aprovados**, admite dois argumentos adicionais:

\`\`\`text
--publish --confirm-tag ordax-stable-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b
\`\`\`

Requisitos: \`gh\` autenticado no repositório oficial com permissão de escrita em releases; tag canônica livre (se a tag existir, não substitui nem reutiliza); arquivos com exatamente os nomes previstos e espaço suficiente para o upload. O script cria **uma release draft/prerelease**, envia os cinco arquivos, busca seus metadados diretamente da API do GitHub, exige a presença dos cinco hashes \`sha256:\` e tamanhos exatos e só então retira o status de draft. Não usa \`--clobber\` e não modifica releases preexistentes. Em caso de falha após criar o draft, **o draft permanece para reconciliação manual**, sem autopublicação e sem substituição silenciosa.

Ao final, a release permanece marcada como *prerelease*; a promoção ao canal Stable não ocorre. A publicação é a etapa necessária para permitir a materialização HTTPS canônica. Depois é obrigatório executar \`.github/workflows/canonical-v4-materialization.yml\`, obter o recibo de materialização, executar a verificação agregada Step 7 e vincular a nova prova ao Creator por \`tools/creator/bind_canonical_v4_release_proof.py\`.

**Nenhum dos comandos acima escolhe disco, autoriza gravação física, aplica UAC nem altera a instalação de desenvolvimento.** O contrato \`physical_write_allowed=false\` só pode mudar pelo owner de autorização do dispositivo, em etapa explícita posterior.
