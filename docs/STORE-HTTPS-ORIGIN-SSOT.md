# Origem HTTPS canônica dos transportes Native da Loja

Status: contrato canônico da configuração de origem **somente de transporte**.

## SSOT

`system/surface/runtime/native_store_https_origin.py` é o validador
compartilhado de origem HTTPS para os dois fluxos Native:

- `native_store_catalog_acquisition.py` baixa bytes do catálogo,
  cuja verificação criptográfica/anti-replay pertence a
  `native_store_catalog.py`.
- `native_app_artifact_acquisition.py` baixa bytes de blobs
  *content-addressed* a partir da identidade do plano do lifecycle;
  tamanho/hash e cache são verificados pelos owners existentes.

Os pontos de entrada públicos de cada transporte preservam suas
exceções especializadas; nenhum novo port, rede de confiança,
catálogo, instalador ou autoridade de lifecycle é criado.

## Política

Somente uma URL base com esquema HTTPS, host e prefixo de caminho
explícitos e sem credenciais, query, fragmento ou caracteres de
controle pode ser configurada. Portas inválidas, zero, caminhos
`.`/`..`, barras invertidas e escapes `%` no prefixo são recusados.

Proxies e servidores podem decodificar caminhos de modo diferente.
O prefixo de implantação do catálogo/artefatos não precisa ser
percent-encoded; em vez de tentar interpretar variantes como
`%2e%2e`, `%2f` ou dupla codificação, o validador falha
fechado. A barra final do prefixo é normalizada uma única vez
antes de adicionar o nome fixo do catálogo ou caminho SHA-256.

A configuração dessa origem **não** concede autoridade para confiar
no conteúdo: verificação de assinatura, anti-replay, SHA-256,
compatibilidade e ativação continuam obrigatórias. Redirecionamentos
são proibidos pelo transporte existente e respostas são limitadas
em bytes.

## Testes

`tests/test_native_store_https_origin.py` cobre a mesma política
pelas três entradas (SSOT, catálogo e artefatos) e a derivação das
URLs finais. Os testes do próprio catálogo e do transporte de
artefatos permanecem como provas de regressão.

CI: `.github/workflows/runtime-component-candidate.yml` valida
o novo owner e executa os testes, sem gate duplicado.
