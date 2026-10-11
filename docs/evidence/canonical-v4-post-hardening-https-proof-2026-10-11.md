# Stable v4 pós-hardening — prova HTTPS canônica e vínculo com o Creator

**Data:** 11/10/2026. **Fonte assinada:** `03f88eeaf382a59aaefbcf4943d0639d2730741b`.
**Repositório:** `ordaxsystems/ordax-os`.
**Escopo:** publicação HTTPS, materialização da release e agregação de recibos. **Não** é homologação física, ativação Stable ou instalação.

## Cadeia real verificada

1. **Assinatura e handoff originais:** workflow [38156353913](https://github.com/ordaxsystems/ordax-os/actions/runs/38156353913), artifact `11709145163`, `signed-handoff-verification.json`.
2. **Publicação após revisão humana:** workflow [38180305105](https://github.com/ordaxsystems/ordax-os/actions/runs/38180305105), conclusão `success`, artifact de publicação `11716848738`. Release `ordax-stable-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b`, ID `409954063`, `draft=false`, `prerelease=true`, cinco assets com `sha256` e tamanho exatos.
3. **Materialização HTTPS real:** workflow [38180886646](https://github.com/ordaxsystems/ordax-os/actions/runs/38180886646), conclusão `success`; `ordax-release-agent materialize-portable-v4` e `verify-portable-v4-exact` da fonte assinada; artifact do recibo `11717681602`, retenção até 18/10/2026.
4. **Agregação Step 7:** `tools/release-signing/windows/7-Verify-PortableV4-Canonical-Proof.ps1` obtido **da fonte assinada** por GitHub blob `3bcdb6e05be9f8a60e287ecc766d710f0ac1ca14`. Executado no Windows com os **dois recibos reais baixados dos workflows** e confiança pública da fonte congelada, Git blob `268c89a8827042f131e12ae799a9f6bfb2a71750`; resultado `PORTABLE_V4_CANONICAL_RELEASE_PROOF=PASS`. Prova exata no arquivo `docs/evidence/canonical-v4-release-proof.json`, SHA-256 `768e24011afc5cc20dd5f5e2bf8d2462359d2c348b51a6d81135aeca31475049`.
5. **Vínculo pelo owner do Creator:** `tools/creator/bind_canonical_v4_release_proof.py`, da `main` de referência `babcbe5aed94253f805ef08677cfc290a09b1073`, executado em sandbox temporário no Windows com o contrato real e prova gerada pelo Step 7. Retorno `canonical-v4-release-proof-bound`, sem invocar gravador, sem selecionar dispositivo e sem habilitar autorização física.

## Identidades e hashes

- Confiança pública canônica: `d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250`.
- Manifesto da release: `5dc9213b65eaffa7adf67c0addc7dbe32af1e06ae4b9a4f5a8dea37aa8ee99d6`.
- Envelope assinado: `d9ab389cd55c481785491cb1c3881936e47e7347bdc69ccea5c76a7437969a90`.
- `system.erofs`: `c17a19d68f02b1f00228707fa991af32e2d63ff6f40dc3ea798a675c6a261145`, 7.520.256 bytes.
- `native-surface-runtime.erofs`: `9f1dfc339a69ac95b2c3f56e4d103e550dca8e4cb2b8b35cc2dcb9a581af69ef`, 1.052.020.736 bytes.
- `local-ai-runtime.erofs`: `b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a`, 568.061.952 bytes.

## Limites do que foi provado

A prova confirma assinatura, download público, integridade dos bytes, materialização isolada e vínculo canônico da release ao Creator. **Não** confirma boot gráfico real da candidata no USB atual, leitura posterior à gravação, cold-health, rollback físico ou instalação em SSD/NVMe.

O contrato `docs/contracts/physical-write-authorization.json` fica em `blocked-explicit-physical-authorization-pending`, com `physical_write_allowed=false`, `explicit_owner_authorization=false`, `authorization_context_sha256=null`; os limites de segurança continuam em vigor. A vinculação desta prova **não é consentimento para gravação**. O canal Stable `latest` não é promovido por esta etapa.

A retenção do artifact da materialização é curta; preserve estes identificadores de auditoria no repositório, sem alegar que o receipt remoto é eterno.
