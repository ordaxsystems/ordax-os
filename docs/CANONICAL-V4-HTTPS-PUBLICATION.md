# Publicação HTTPS canônica da candidata Stable v4

A candidata congelada `03f88eeaf382a59aaefbcf4943d0639d2730741b` passou pela prova de handoff assinado, mas a liberação pública dos arquivos EROFS ainda é uma ação distinta. O script **`tools/release-operator/publish_verified_v4_release.py`** é o operador específico desse passo. Ele reutiliza a admissão de pré-publicação existente e **não é um gravador de USB**.

## Antes de qualquer publicação

Utilizar somente o pacote exato verificado pelo Step 5, contendo `release-manifest.json`, `release-envelope.json`, `system.erofs`, `native-surface-runtime.erofs`, `local-ai-runtime.erofs`, a confiança pública e o release-agent correspondente à revisão congelada. É necessário também o pedido ativo em `docs/contracts/canonical-v4-signing-request-active.json` e o `signed-handoff-verification.json` emitido pelo workflow [38156353913](https://github.com/ordaxsystems/ordax-os/actions/runs/38156353913).

Na primeira execução, omitir `--publish`. Exemplo em um terminal com Git e Python:

```powershell
python tools/release-operator/publish_verified_v4_release.py `
  --source-root . `
  --source-commit 03f88eeaf382a59aaefbcf4943d0639d2730741b `
  --bundle-dir C:\Release\v4 `
  --signing-request docs/contracts/canonical-v4-signing-request-active.json `
  --signed-receipt C:\Release\v4\signed-handoff-verification.json `
  --trust C:\Release\v4\release-ed25519.json `
  --release-agent C:\Release\v4\ordax-release-agent.exe
```

Esse comando realiza apenas leitura: confere a âncora pública da revisão congelada diretamente dos bytes do objeto Git, executa de verdade o `verify-envelope` do release-agent (assinatura Ed25519), confronta manifesto e recibo, verifica SHA-256/tamanho dos três EROFS por streaming e emite o plano das cinco URLs canônicas. Não inventa recibos.

## Publicar após revisão explícita

O mesmo comando, **com os mesmos caminhos aprovados**, admite dois argumentos adicionais:

```text
--publish --confirm-tag ordax-stable-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b
```

Requisitos: `gh` autenticado no repositório oficial com permissão de escrita em releases; confirmação exata da tag; arquivos com exatamente os nomes previstos. O script consulta a **coleção autenticada de releases** (incluindo rascunhos, que podem retornar 404 na consulta por tag). Se a tag ainda não possuir release, exige ausência da referência Git e cria um único rascunho com os cinco arquivos. Se já existir um **rascunho canônico**, exige a mesma revisão congelada, `prerelease=true` e exatamente os cinco SHA-256/tamanhos/nomes; somente então reutiliza a mesma identidade **sem reenviar, substituir, apagar nem duplicar arquivos**. Se houver divergência, release já pública ou inventário ambíguo, bloqueia. A publicação altera `draft=false` somente pelo **ID imutável** da release verificada, seguida de nova conferência de identidade e dos cinco assets públicos. Não usa `--clobber`. Se a confirmação final falhar, o estado remoto deve ser inspecionado antes de nova operação.

Ao final, a release permanece marcada como *prerelease*; a promoção ao canal Stable não ocorre. A publicação é a etapa necessária para permitir a materialização HTTPS canônica. Depois é obrigatório executar `.github/workflows/canonical-v4-materialization.yml`, obter o recibo de materialização, executar a verificação agregada Step 7 e vincular a nova prova ao Creator por `tools/creator/bind_canonical_v4_release_proof.py`.

**Nenhum dos comandos acima escolhe disco, autoriza gravação física, aplica UAC nem altera a instalação de desenvolvimento.** O contrato `physical_write_allowed=false` só pode mudar pelo owner de autorização do dispositivo, em etapa explícita posterior.

## Execução sem o computador de operador

O workflow manual **Canonical v4 Verified HTTPS Publication** (`.github/workflows/canonical-v4-verified-publication.yml`) também utiliza o publicador oficial, sem depender do desktop Windows. Para executá-lo, abrir esse workflow na aba **Actions** do repositório e selecionar **Run workflow** obrigatoriamente na branch `main`. Na primeira execução, manter o modo padrão `verify` e deixar `confirm_tag` vazio: o job baixa e verifica os artefatos reais, verifica a assinatura com o release-agent e preserva o plano de hashes, **sem criar release**. Apenas depois de conferir essa prova, usar o mesmo workflow com modo `publish`, informando no campo `confirm_tag` a tag exata `ordax-stable-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b`.

O próprio workflow rejeita branches diferentes da `main`, revisões que não sejam o HEAD atual da `main`, modo desconhecido e confirmação incompatível. A revisão oficial é conferida novamente imediatamente antes da publicação. O código de verificação e o código de publicação permanecem no **mesmo workflow/owner**, sem publicar a partir de uma branch experimental. O modo `verify` nunca invoca o publicador com `--publish`.

O contrato `docs/contracts/canonical-v4-publication-request.json` contém os IDs imutáveis dos recibos de assinatura/handoff, validados pela API do GitHub junto ao pedido ativo. O runner Ubuntu baixa os três artefatos EROFS por run/artifact name oficial, reconstitui o envelope a partir do blob do Git, compila o release-agent da revisão congelada, verifica a assinatura e os hashes e só então invoca o publicador. A permissão de gravação é restrita ao job manual de release, nunca ao gravador de disco. Um recibo pequeno é preservado como artifact do workflow; os EROFS não são reenviados como comprovante duplicado.

**Prazos dos recibos:** os arquivos atuais do GitHub Actions expiram em **25 de outubro de 2026**. Se expirarem, é necessário gerar novos recibos verificados e atualizar o contrato pela `main` antes de publicar; o workflow rejeita IDs expirados. A aprovação da execução publica apenas uma *prerelease* HTTPS. Ainda serão obrigatórios materialização canônica, prova agregada Step 7, vínculo ao Creator e autorização física específica.

O workflow **não executa automaticamente em push ou PR**. Ter o código em `main` não publica nada, e a tag precisa ser confirmada explicitamente por quem dispara a execução.

## Execução real de 11/10/2026 — reconciliação do rascunho

O run [38179444721](https://github.com/ordaxsystems/ordax-os/actions/runs/38179444721) verificou assinatura e cinco hashes, enviou os cinco assets, mas falhou em `cannot parse canonical release metadata`: a consulta `releases/tags/<tag>` não retornou o rascunho que já existia. A release ID `409954063` permaneceu `draft=true`, com cinco arquivos de SHA-256 e tamanho idênticos ao plano aprovado. A correção no mesmo publicador só reconcilia esse rascunho exato consultando a coleção autenticada e publicando pelo ID, **sem reupload**. Repetir o workflow com `mode=publish` e confirmação explícita continua necessário; não há publicação automática após o merge e nenhuma autorização de gravação física é concedida.

## Fechamento real da etapa HTTPS e Step 7 em 11/10/2026

A correção do draft foi efetivamente executada: [run 38180305105](https://github.com/ordaxsystems/ordax-os/actions/runs/38180305105) publicou a mesma release ID `409954063` como `draft=false` e `prerelease=true`, com os cinco assets verificados. A [materialização canônica 38180886646](https://github.com/ordaxsystems/ordax-os/actions/runs/38180886646) passou usando a URL pública assinada, com recibo GitHub Actions `11717681602` (expira em 18/10/2026). O Step 7 oficial conferiu o recibo dessa materialização contra o handoff assinado `11709145163` e gerou a nova prova pós-hardening `docs/evidence/canonical-v4-release-proof.json` — SHA-256 `768e24011afc5cc20dd5f5e2bf8d2462359d2c348b51a6d81135aeca31475049`. O binder canônico do Creator validou essa prova e mantém a gravação física bloqueada. Trilha detalhada em [evidência HTTPS de 11/10](../evidence/canonical-v4-post-hardening-https-proof-2026-10-11.md).

**Próximos gates ainda pendentes:** autorização explícita e escopo da mídia descartável para o novo candidato, prova de escrita e readback 17/17 no USB selecionado, boot UEFI físico/saúde e somente então promoção de canal. Nenhuma dessas ações é implícita por esta PR.
