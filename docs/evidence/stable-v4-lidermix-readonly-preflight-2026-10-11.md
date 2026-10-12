# Stable v4 — pré-verificação física somente leitura do pendrive Lidermix

**Data local:** 11/10/2026. **Situação:** planejamento de geometria aprovado; autorização formal não registrada; gravação não realizada.

## Escopo e fontes oficiais

- Candidata assinada: `03f88eeaf382a59aaefbcf4943d0639d2730741b`, release pública em modo prerelease `ordax-stable-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b`.
- Prova agregada Step 7 em `docs/evidence/canonical-v4-release-proof.json`, SHA-256 `768e24011afc5cc20dd5f5e2bf8d2462359d2c348b51a6d81135aeca31475049`.
- Contrato único de consentimento: `docs/contracts/physical-write-authorization.json`.
- Donos da geometria e do plano: `tools/creator/core/storage_profiles.go`, `tools/creator/core/portable_media.go`.
- A PR [#1668](https://github.com/ordaxsystems/ordax-os/pull/1668) reconciliou o único binding divergente do contrato, `minimal_bootstrap_sha256`, com os bytes canônicos `a22d9963ee9d24dfb20810262e7d273fcdd3abb60522ad8da8b378e0345bb9d1`. A verificação oficial `authorize_physical_write.py check` passou na revisão `f186abf0fd230ed7665d9806f06b66525859f5a0`.

## Inspeção real do dispositivo Windows (somente leitura)

| Item | Disco 0 | Disco 1 |
|---|---|---|
| Barramento | SATA | USB |
| Dispositivo | WDC WD5000AZLX-00JKKA0 | Lidermix USB |
| Capacidade | 465,8 GiB | 8.053.063.680 bytes (7,5 GiB) |
| Papel | `IsBoot=true`, `IsSystem=true` | `IsBoot=false`, `IsSystem=false` |
| Estado | Disco de sistema, excluído | Online, não protegido contra escrita, GPT |

O disco USB apresentou originalmente **três partições**: 256 MiB (sem letra), 2 GiB (D:) e 5,25 GiB (E:). Não houve alteração dessa estrutura na inspeção. Não armazenamos nesta evidência a identificação serial nem o caminho único do dispositivo.

## Teste real do planejador Go

No Windows amd64, com Go 1.27.0, foi executado o comando **não destrutivo**:

```powershell
go run ./cmd/ordax-creator plan-portable --target-bytes 8053063680
```

Em execução isolada, a ferramenta retornou o JSON:

```json
{
  "profile": "portable-usb",
  "target_bytes": 8053063680,
  "esp_start_lba": 2048,
  "esp_last_lba": 1050623,
  "esp_bytes": 536870912,
  "payload_name": "ORDAX-DATA",
  "payload_start_lba": 1050624,
  "payload_last_lba": 15726591,
  "payload_bytes": 7514095616,
  "last_usable_lba": 15726591
}
```

`GO_PLAN_EXIT_CODE=0`, processo concluído com código 0. Uma primeira invocação, encapsulada por PowerShell, tinha retornado erro **depois de imprimir a mesma geometria**; foi repetida sem esse encapsulamento e o código de saída do planejador foi confirmado em 0.

**Interpretação limitada:** a geometria alvo é aceita pelo planejador. A execução não construiu plano de aplicação de 39 operações para os 17 artefatos, não carregou uma lista completa de bindings, não abriu o dispositivo para escrita, não criou partição, não realizou readback e **não prova boot real**.

## Limite de autorização e próxima etapa

O proprietário confirmou em conversa o escopo `first-real-stable-mvp-usb-proof`, a sequência `1`, a frase `AUTHORIZE_FIRST_REAL_STABLE_MVP_USB_PROOF` e o dispositivo físico **Lidermix USB, disco 1**, com ciência da perda de dados. Entretanto, a tentativa de executar a operação oficial `authorize_physical_write.py authorize` por acesso remoto foi **bloqueada pela camada de segurança da ferramenta antes de executar**, e não foi substituída por outro meio.

O contrato em `main` continuava em `blocked-explicit-physical-authorization-pending`, com `physical_write_allowed=false`, `explicit_owner_authorization=false` e sem `authorization_context_sha256`, após essa tentativa. Portanto, **não existe autorização registrada em SSOT**, candidato físico liberado, UAC aprovado, gravação ou verificação física pós-gravação.

O próximo gate exige registro real de consentimento pelo mecanismo oficial em ambiente autorizado e posterior verificação dos artefatos/seleção/revalidação do USB. O disco 0 do Windows deve permanecer excluído. Não contornar restrições de segurança da ferramenta nem assumir que o consentimento escrito já habilitou o gravador.

Esta evidência não muda o SSOT de autorização, não publica o Creator e não promove `latest`.
