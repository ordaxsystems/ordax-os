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

1. Esperar os três **resultados reais** dos jobs, exigir sucesso;
   comparar source commit/manifest/artefatos por SHA e IDs válidos.
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
