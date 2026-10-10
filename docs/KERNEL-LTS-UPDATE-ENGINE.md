# Atualizações LTS do kernel — contrato operacional OrdaX OS

## Princípio arquitetural

Uma atualização de patch do kernel não deve exigir renomear workflows, replicar
versões, duplicar hashes nem escrever verificadores ad hoc. O owner é
`bootstrap/kernel/`, em conjunto com consumidores já existentes, sem novo broker,
sem nova autoridade de release, sem memória paralela.

- **Ativo:** `bootstrap/kernel/source.json` (único pin do kernel estável).
- **Candidato:** `bootstrap/kernel/candidates/<versão>.json` (identidade de
  source imutável por revisão: URL kernel.org, SHA-256, configuração, fingerprint
  e chave de origem revisada).
- **Seleção:** `bootstrap/kernel/candidates/proposal.json` (apenas caminho do
  candidato; não repete versão, URL, digest nem chave).
- **Descoberta:** `bootstrap/kernel/update_engine.py` lê o feed oficial
  `https://www.kernel.org/releases.json`; restringe-se à família LTS atual,
  recusa EOL, URLs inesperadas e versões de outra linha.
- **Preparação:** o mesmo owner baixa em limites explícitos, calcula o hash dos
  bytes, verifica a assinatura detached sobre o tar descomprimido usando o
  verificador OpenPGP e a chave imutável **já revisada**. Nunca descobre chaves
  arbitrárias. Só depois publica manifesto e altera o seletor.
- **Compilação/prova:** `bootstrap/kernel/candidate_pipeline.py` resolve o
  seletor e confere source commit, proveniência OpenPGP e hashes dos arquivos
  produzidos pelo builder oficial. O workflow genérico
  `kernel-lts-candidate.yml` não contém números de versão.
- **Proposta:** `kernel-lts-update-proposal.yml` descobre patches semanalmente
  e também aceita disparo manual. Quando encontra patch novo, propõe PR
  (nunca faz merge automático), e solicita o workflow de build do candidato.
  Um branch de proposta já existente não é sobrescrito.
- **Promoção:** deve continuar no owner de release existente. O candidato
  NÃO altera source ativo, não substitui Stable Base, não gira chaves, não cria
  token de implantação e não autoriza escrita física.

## Máquina de estados mínima

`descoberto` -> `identidade-assinada` -> `candidato-em-PR` ->
`build/ABI/proveniência comprovados` -> `elegível para migração`.

A *elegibilidade* não é publicação. Para promover ao MVP, é necessário trocar
o pin canônico via PR **própria**, reconciliar o UAPI do initramfs, contratos e
inventários dependentes, reconstruir todos os consumidores, medir boot QEMU
PID1/OVMF com rollback e provar o ambiente fixado da nova revisão. Boot em
máquina real, Secure Boot, prova de mídia física e autorização de escrita não
podem ser inferidos de QEMU ou de um build bem-sucedido.

Uma troca de família (por exemplo, 6.6 -> outra LTS) não ocorre por esse
atualizador de patches. Exige revisão separada de compatibilidade e drivers.
Assim, a arquitetura aceita décadas de revisões sem confundir mudança
incompatível com atualização automática trivial.

## Comandos

```bash
python3 bootstrap/kernel/update_engine.py discover
python3 bootstrap/kernel/update_engine.py prepare
python3 bootstrap/kernel/candidate_pipeline.py select
python3 bootstrap/kernel/build.py check \
  --source-contract bootstrap/kernel/candidates/6.6.158.json
python3 bootstrap/kernel/build.py build \
  --source-contract bootstrap/kernel/candidates/6.6.158.json \
  --work-dir out/kernel-next-work --out-dir out/kernel-next
python3 bootstrap/kernel/candidate_pipeline.py prove \
  --out-dir out/kernel-next --source-commit <sha-exata-de-40-hex>
python3 -m unittest discover -s tests -p 'test_kernel_candidate_pipeline.py' -v
python3 -m unittest discover -s tests -p 'test_kernel_update_engine.py' -v
```

O exemplo com 6.6.158 ilustra somente o candidato já existente; o workflow
obtém a versão de `proposal.json` e não depende desse literal.

## Operação, permissões e limites honestos

GitHub Actions usa `contents:write` e `pull-requests:write` **apenas**
no workflow de proposta iniciado por cron/disparo confiável na `main`.
Workflows de build são somente leitura. O job de proposta usa `GITHUB_TOKEN`
do próprio repositório. Alguns repositórios bloqueiam criação de PRs por
GitHub Actions: nesse caso a operação deve reportar erro; não substituir por
um token pessoal, desativar branch protection ou simular uma PR criada.
PR criada com `GITHUB_TOKEN` não aciona o evento `pull_request` por padrão;
o workflow envia `workflow_dispatch` explícito para a etapa staging.

A atualização é idempotente por versão, não reescreve branches existentes e
não envia conteúdo gerado por IA não validado. Agentes de IA podem executar
esses comandos, interpretar JSON e propor alterações, mas as provas são dos
owners e ferramentas reais, não de afirmações da IA.

O acesso à fonte externa e à chave imutável exige rede; o preparo impõe limite
de tamanho e verificação OpenPGP. O limite atual é 512 MiB de arquivo tar.xz,
revisável por contrato futuro caso o source legítimo cresça. A compilação e
a prova de QEMU custam tempo de CPU; o fluxo automatiza a gestão e os
critérios, não mascara esse custo. Não executar auto-merge/autopromoção ao
receber novos pacotes.
