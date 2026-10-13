# Candidato canônico v4 — reconstrução iniciada em 10/10/2026

Repositório: `ordaxsystems/ordax-os`.

## Fonte imutável do novo candidato

`69032495dc5679ebe126274afe9daef3ce271b5a`

Este SHA contém as correções de boot e recuperação (com prova QEMU
em revisão anterior), a localização consolidada, a proteção de
permissões de apps externos e os commits de Conta, Creator e
Intelligence já integrados até o congelamento. Alterações posteriores
na `main` **não** estão automaticamente incluídas.

## Jobs canônicos disparados por workflow_dispatch

| Artefato necessário | Workflow | Run | Resultado neste registro |
| --- | --- | --- | --- |
| Sistema / EROFS | `portable-release-image.yml` | [38038180623](https://github.com/ordaxsystems/ordax-os/actions/runs/38038180623) | em execução |
| Surface / EROFS | `surface-runtime-lock-discovery.yml` | [38038183168](https://github.com/ordaxsystems/ordax-os/actions/runs/38038183168) | em execução |
| IA Local / EROFS | `local-ai-runtime-candidate.yml` | [38038185133](https://github.com/ordaxsystems/ordax-os/actions/runs/38038185133) | em execução |

## Provas de operator artifacts confirmadas posteriormente

- **Sistema: SUCCESS** no run 38038180623; artifact canônico
  `11663959008` (`canonical-v4-operator-system-69032495...`),
  digest do ZIP no GitHub
  `sha256:485b3d26772bc0aac239b3d0f370254a0225c26e6f7cd371ba456770b9ff904e`,
  `expired=false`, expira em 24/10/2026 às 08:32 UTC.
- **Surface: SUCCESS** no run 38038183168; artifact canônico
  `11665055995` (`canonical-v4-operator-surface-69032495...`),
  digest do ZIP no GitHub
  `sha256:ed92a488f1bf9f1a2f05f1868ee1b56dd146aa1cbaa141a832385b80bb8dee2a`,
  `expired=false`, expira em 24/10/2026 às 08:33 UTC.
- **IA Local: SUCCESS** no run 38038185133; artifact canônico
  `11663964587` (`canonical-v4-operator-local-ai-69032495...`),
  digest do ZIP no GitHub
  `sha256:3ef25b30b27679661dbd7d6cf6f98b1bd40305dceffd3e048c2edc102d6908fc`,
  `expired=false` na consulta de 10/10/2026; criado em 10/10/2026 às 08:38 UTC.

**Atualização da observação:** os três workflows concluíram com `success`
para o mesmo `head_sha` congelado e os três artifacts do operador
estão identificados por ID e digest de ZIP. O conteúdo interno, os
recibos de origem e os EROFS ainda precisam de admissão independente;
esses resultados **não** são autorização de assinatura ou escrita física.

Esses digests são dos **ZIPs de artefatos do GitHub Actions**,
não substituem o manifesto assinado nem o checksum dos EROFS
materializados. A admissão canônica de release deve conferir
os IDs de artefatos, workflow/runs, SHA congelado e recibos reais.

A API GitHub confirmou `headSha` exatamente igual ao SHA congelado
para os três runs. Esta prova de origem evita compor artefatos de
diferentes versões da `main`. Não se considera nenhum deles apto
para assinatura até que o workflow passe e que seu artifact ID,
retenção, checksum, materialização e recibos sejam verificados.

## QEMU / confiabilidade conhecida

A [prova QEMU manual 38035813342](https://github.com/ordaxsystems/ordax-os/actions/runs/38035813342)
concluiu **success** no SHA
`7bb6ba296f5fb0424efd9b382d1cc798ba6d217c`.
Ela comprova o caminho de boot/candidate-one-shot para essa revisão
anterior; **não prova o boot completo deste candidato 69032495**.

## O que ainda falta — sem alegar conclusão

1. Os três workflows já concluíram com **success** no mesmo source commit;
   ainda falta validar o conteúdo interno, os recibos de operador e
   os EROFS materializados por hashes e identidade exata.
2. Gerar a nova solicitação canônica de assinatura v4 usando
   **exatamente esses três runs**, validar admissão online, gerar
   manifest e envelope assinado fora do repositório com a chave
   de owner já protegida. Não copiar chave PEM para Actions, chat
   ou arquivos públicos.
3. Publicar os três EROFS e envelope/manifests verificáveis em
   URLs estáveis, exercitar `canonical-v4-materialization.yml` e
   obter recibos offline com conteúdo exato.
4. Exigir destino USB removível e devidamente identificado antes
   de qualquer escrita; executar validação pós-gravação e boot
   físico/cold reboot. Nenhuma mídia foi gravada nesta etapa.
5. Atualizar prontidão do MVP apenas quando o novo candidato
   passar seus gates; o envelope histórico de `6128e2c`
   continua prova **da fonte antiga** e não é reaproveitável.

A documentação registra estados observados, não promove
automaticamente o canal Stable nem declara launch-ready.
