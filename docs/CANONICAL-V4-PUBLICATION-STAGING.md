# Stable v4 — admissão para publicação canônica

## Propósito

A aprovação do handoff assinado **não publica automaticamente** uma versão. A publicação dos arquivos no canal HTTPS canônico continua sendo uma ação deliberada do operador, separada da materialização e da gravação física.

A fonte oficial da candidata é o pedido ativo em `docs/contracts/canonical-v4-signing-request-active.json`. O documento `canonical-v4-publication-staging.json` é apenas um plano **derivado** dos bytes realmente verificados. Ele não substitui o manifesto assinado, o recibo da Step 5 nem o contrato de autorização física.

## Verificação automatizada

O workflow existente `.github/workflows/canonical-v4-signed-handoff-proof.yml`, depois de executar a Step 5 oficial com o release-agent, chama `tools/release-operator/validate_v4_publication_staging.py`. A ferramenta somente lê:

- `release-manifest.json` e `release-envelope.json`;
- os três EROFS reais, calculando SHA-256 em blocos de 1 MiB;
- a confiança pública, o pedido ativo e o recibo de handoff assinado.

O validador exige o mesmo commit e a mesma referência de candidata, as cinco identidades de arquivo, URLs do repositório oficial, tamanhos e hashes do manifesto e do recibo, payload byte a byte idêntico ao manifesto e os indicadores de assinatura aprovada e de ausência de publicação, ativação ou gravação. Arquivos não regulares e estados contraditórios são rejeitados.

O resultado é adicionado ao artifact de evidência do próprio handoff, ao lado do recibo assinado, **sem enviar EROFS nem material privado ao artifact de evidência**.

## Limites e sequência do operador

A assinatura Ed25519 continua sendo conferida pelo release-agent da revisão congelada na Step 5; o validador não cria uma segunda implementação de assinatura. Os testes unitários em `tests/test_validate_v4_publication_staging.py` usam dados sintéticos exclusivamente para validar condições de rejeição, nunca como evidência real de release.

Depois da aprovação do handoff, o operador ainda precisa revisar e publicar deliberadamente os cinco arquivos exatos (`release-manifest.json`, `release-envelope.json` e três EROFS) na release correspondente à candidata. Em seguida, o workflow canônico `canonical-v4-materialization.yml` precisa materializar e verificar a fonte HTTPS. O recibo dessa materialização e o do handoff alimentam a prova agregada da Step 7, que pode então ser vinculada ao contrato do Creator pelo comando canônico já existente.

A execução desta validação não faz upload para releases, não publica, não ativa, não concede autorização do proprietário, não escolhe disco e não grava pendrive. Enquanto os gates posteriores não passarem, `physical_write_allowed=false`.
