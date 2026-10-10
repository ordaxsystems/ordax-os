# Evidencia: divergencia entre politica legal e HTML publicado (2026-10-10)

**Estado: bloqueio de release, nao resolvido.** Auditoria somente leitura de
`https://ordax.com.br` e do projeto Supabase canonico `ordax-platform`.
Nao ocorreram atualizacoes no banco, exclusoes de usuarios, modificacoes de
recibos de aceite ou relaxamento de controles de Conta.

## Fontes de verdade

- A politica de consentimento vigente e seus hashes pertencem ao servidor
  (`private.ordax_account_legal_policies` no destino Supabase). O frontend
  nao pode redefinir hashes ja aceitos.
- A publicacao HTML pertence ao build canonico `tools/public-site/build.py`.
- `tools/public-site/public_legal_integrity.py` e o verificador compartilhado
  utilizado pela prova DNS/legal e pela prova de deployment. Este arquivo de
  evidencia e apenas um snapshot investigativo, nao outro SSOT.

## Observacoes verificadas

- Existe **uma politica ativa**, nao aposentada, ativada no servidor.
- Versoes de privacidade e termos: `2026.10.09`.
- Contagens agregadas: **2 registros** em `auth.users` e **2 recibos**
  em `private.ordax_account_legal_receipts` no instante da auditoria.
- URLs vigentes sao `https://ordax.com.br/privacidade/` e
  `https://ordax.com.br/termos/`.
- Hashes SHA-256 do corpo HTML publicado (HTTP 200, sem compressao) diferem
  dos valores registrados na politica:

| Documento | SHA-256 registrado na politica | SHA-256 do HTML publicado |
| --- | --- | --- |
| Privacidade | `0f79381f43b5ac69f0978d4d28eaa30844dd33eb20d03396f30dc268e5a04a80` | `67d12cb8ca5b4a6df043cf1e329ba10ae72c00e2a487a7b0c3056d38cd8d313e` |
| Termos | `efba2ef11af9a46eaad985b15b7f5612b5846d37f2b53f96f4eff87ebea38a4b` | `ba73bf8929ac724850e01f1ad210d3fd0b66fcfd09b2433c36aee8c0474be93d` |

O hash cobre **bytes exatos do HTML**, nao somente texto juridico. Mudancas de
layout/template podem afetar esses bytes mesmo sem mudanca de texto legal.
A causa exata da divergencia anterior nao foi demonstrada apenas pelo historico
local; nao atribuir uma data ou commit especifico sem comprovacao.

As duas validacoes rejeitam corretamente o site neste estado:

```text
ORDAX_PUBLIC_LEGAL_INTEGRITY=FAIL reason=published-legal-document-hash-mismatch:privacy
PUBLIC_SITE_DEPLOYMENT_PROOF=FAIL reason=public-legal-integrity:published-legal-document-hash-mismatch:privacy
```

A prova de DNS/HTTPS e a verificacao de origem do portal podem continuar verdes;
isso **nao** autoriza lancamento com politica inconsistente.

## Reconciliacao necessaria

1. Recuperar, caso exista, a evidencia dos bytes imutaveis do documento
   historico aprovado; manter acessiveis as provas das versoes antigas.
2. Revisar os documentos legais atuais e definir uma **nova versao de politica**,
   com vigencia e hashes exatos do HTML publicado, sem reescrever a politica
   antiga nem seus recibos.
3. Utilizar o fluxo canonico de ativacao
   `.github/workflows/public-legal-policy-activation.yml`, sob o owner,
   confirmando a operacao com o recibo sanitizado e controle de unicidade da
   politica ativa. Nao fazer update manual de `sha256` em linha com recibos.
4. Reexecutar `python tools/public-site/probe_public_network.py --legal-consistency`
   e `python tools/public-site/prove_deployment.py --origin https://ordax.com.br`;
   ambos devem passar **antes** de autorizar o MVP publico. Completar E2E
   de cadastro, sessao e revogacao separadamente.

Ate la, `account_activation_ready=false`, recovery/sync bloqueados e a
publicacao de release Stable deve permanecer pendente.
