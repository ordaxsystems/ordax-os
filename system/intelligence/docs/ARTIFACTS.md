# Artefato portátil — somente source (desenvolvimento)

O comando `npm run package` prepara `dist/ordax-intelligence-source-0.1.0-dev.0.tar` e `dist/receipt.json` de forma determinística usando apenas Node.js. `npm run package:verify` reconstrói o conteúdo e compara **todos os bytes**, SHA-256 e tamanho. O arquivo contém `src/**/*.mjs`, `package.json` e `manifest.json`, com hashes individuais. Nenhum engine, GGUF, token, chave ou binário da Base é incluído.

O recibo registra `activationAuthorized=false` e o pacote permanece `unsigned-source-handoff`. Esse fluxo é somente uma fonte versionável para consumo pelo pipeline verificado do OS. O OS mantém o único verificador de assinatura, slot/ativação, rollback, licença e ciclo de vida. Integrar os commits fixados e verificar a ABI Buildroot antes de qualquer artefato instalável. Nunca ativar um tar baixado sem atestação/autorização do OS.

As dimensões físicas, tempo de resposta, RAM/CPU, integridade da Base, QEMU e notebooks reais não foram medidos por esta CI. Não classificar pacote de source como inferência local funcional ou release de usuário.

## Integridade do recibo de proveniência

`npm run package:verify` exige identidade **byte a byte** tanto do `.tar` quanto de `dist/receipt.json`, reconstruídos a partir do source atual. Nenhuma alteração em `activationAuthorized`, `kind`, `engineIncluded`, `modelIncluded`, nome, SHA-256, tamanho, campos extras ou serialização do recibo é aceita. Links simbólicos sob `src/` são rejeitados em vez de serem silenciosamente omitidos. Isso é um gate de integridade de desenvolvimento, **não** uma assinatura ou autorização de ativação pelo OS.

## Árvore portátil e isolamento do empacotamento (2026-11-01)

`npm run check` e `npm run package` agora utilizam o mesmo walker `scripts/source-tree.mjs` para enumerar os módulos portáveis. O walker exige que `src/` seja um diretório físico, recusa links simbólicos em qualquer nível e não aceita árvore vazia. O empacotador também exige `package.json` regular e saída `dist/` não simbólica; uma pasta de saída redirecionada não recebe arquivos de handoff. Os caminhos individuais do tar e do recibo também são verificados com `lstat`, inclusive contra links quebrados, antes de qualquer gravação. Esses gates impedem que a entrega source-only incorpore código de um diretório externo ou grave recibos fora do workspace.

A lista de módulos permanece derivada dos arquivos locais, sem copiar o source lock canônico do OS, sem atualizar o modelo/engine e sem transformar a prova em release assinada. Testes negativos dos caminhos e a verificação byte a byte do tar/recibo são executados pela CI portátil.

## Nomes representáveis no formato TAR (2026-11-01)

O empacotador mantém o formato **ustar clássico**, sem extensões PAX. Nesse formato, `Buffer.write(..., "ascii")` não preserva um nome Unicode: o manifesto poderia registrar `src/nível.mjs` enquanto o cabeçalho TAR codificava bytes diferentes. O gate agora rejeita caminhos de membros com bytes não ASCII, caracteres de controle, segmento `.`/`..`, separadores vazios, barra invertida ou comprimento acima de 100 bytes **antes de publicar qualquer arquivo**. A versão usada no nome do pacote também precisa ser um único componente seguro, sem separadores, controles ou escapes. Os módulos existentes permanecem compatíveis; caso o projeto precise de nomes Unicode no futuro, a migração correta é implementar e testar PAX formalmente, não gravar bytes corrompidos silenciosamente. A CI inclui testes negativos para Unicode, controles, caminho longo e versão insegura. Continua sendo um pacote source-only sem ativação ou assinatura.
