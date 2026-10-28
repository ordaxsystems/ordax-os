# Integração de sources externos no OrdaX OS

**Owner da integração:** ordaxsystems/ordax-os. **Sem segundo updater.**

O OS integra somente revisões **imutáveis e verificadas** de código externo. Um merge em outro repositório não instala nada automaticamente no dispositivo: o owner externo valida seus bytes, o OS aprova o par de versões e o atualizador **já existente** do perfil do dispositivo consome o commit OS aprovado.

## Caminho Owner/Development

A única automação para avançar locks de source embutido é
[external-source-lock-integration.yml](../.github/workflows/external-source-lock-integration.yml).
Ela roda a cada seis horas ou por workflow_dispatch, verificando os dois owners cujo
código é materializado na distribuição do OS:

| Owner | Lock canônico OS | Gate upstream obrigatório | Verificador reutilizado |
| --- | --- | --- | --- |
| Surface | docs/contracts/surface-source.json | validate-source-integration.yml em main | tools/surface-source/materialize.py |
| Intelligence | docs/contracts/intelligence-source.json | ci.yml em main | tools/intelligence-source/materialize.py |

O script [advance.py](../tools/source-integration/advance.py) usa o repositório
registrado **no próprio lock**. Exige SHA completo e descendente do commit
pinado, alteração real apenas no source do respectivo owner, Git checkout limpo,
conteúdo/modos/árvore aprovados pelo verificador **já canônico**. Para Intelligence,
os oito Git blobs exatos são atualizados em conjunto. Um commit que muda só
documentação não causa release/rebuild do OS. O avanço nunca altera status,
activation_authorized, cutover_complete, política de distribuição, dispositivos
físicos ou o código de serviços do OS.

O job exige um workflow upstream **concluído com sucesso para aquele exato
SHA da main** quando uma fonte realmente consumida muda. Rejeita CI ausente,
falha, cancelada ou em andamento. Se houver uma PR de integração aberta para
o mesmo owner, não cria PR paralela. Caso a main tenha sido reescrita, falha
em vez de aceitar um force-push como atualização. A PR altera **somente um
lock**. No caso da Intelligence, apenas os oito Git blobs fixados contam como
código consumido; um helper adicional exclusivo do Windows, documentação ou CI
externa não entra no OS, não altera o pin nem obriga recompilar o kernel.

A integração usa os workflows consumidores que o OS **já possui**, com
workflow_dispatch em SHA de branch quando a PR é criada por GITHUB_TOKEN.
Não há merge automático que salte CI, gate de hardware, revisão ou rollback.

## Autenticação do job — sem PAT obrigatório

A prioridade é a credencial efêmera **GITHUB_TOKEN** do próprio repositório
ordax-os (permissions por job: contents:write, pull-requests:write,
actions:write). Não se copia segredo, token de conta ou chave de release no
source. Uma única configuração administrativa do GitHub pode ser necessária:
permitir que GitHub Actions crie pull requests em Actions → General →
Workflow permissions. Se essa política estiver desabilitada, o job falha
fechado e não tenta atualizar a main diretamente.

Como PRs abertas por GITHUB_TOKEN não disparam eventos pull_request, a
própria automação dispara via workflow_dispatch **as implementações
originais** de CI no SHA da branch, sem duplicar código de testes:

- Surface: Foundation, Surface External Source Consumer, Owner Surface Source
  Transaction e Windows Desktop Dev.
- Intelligence: Foundation, Intelligence cross-repository source gate e
  Owner Intelligence source staging.

Checks adicionais necessários à promoção — como Creator/USB/QEMU e outros
consumidores sujeitos a gating próprio — continuam exigidos antes de merge.
Nenhum workflow_dispatch publica Stable ou altera dispositivos físicos.

Opcionalmente, pode-se configurar ORDAX_INTEGRATION_TOKEN como credencial
GitHub App de escopo mínimo para permitir que o GitHub dispare os próprios
eventos pull_request e toda a CI habitual; nesse caso o workflow **não**
dispara o segundo conjunto de verificações. Essa credencial não é requisito
para o caminho nativo. Nunca usar PAT pessoal amplo como atalho.

Se o repositório proibir criação de PR pelo GitHub Actions, é necessário
autorizar o controle administrativo correto ou fornecer uma credencial de
GitHub App reduzida; sem isso, a proposta não é publicada.

## Ativação após o merge

- **Windows Desktop Dev:** tools/windows-desktop/dev-update.cjs observa a main
  do OS, compõe a revisão Surface fixa naquele SHA e usa o journal,
  health e rollback do Desktop. Não atualiza por conta própria o executável
  Electron, nem instala o OS no disco ou USB.
- **USB/Native Owner Dev:** ordax-pull + Supervisor usam o mesmo OS SHA e a
  Surface pinada. Intelligence só é ativada após seu próprio cutover
  explícito, com boot offline, ABI e rollback comprovados.
- **Stable/MVP:** somente o pipeline de releases verificadas/assinadas
  pode entregar a combinação aprovada. Não há Git direto no dispositivo.

## Outros owners: não transformar dependências em cópias do OS

Apps removíveis em ordax-apps seguem pacote/catálogo e component-slot
assinados pelo mecanismo **existente** do OS após autorização operacional.
Não criar pin global de main dos apps em ordax-os só para publicar um app.
Ordax-runtime para Windows mantém seu ciclo de instalação/versionamento;
o host Native consome contratos públicos do OS. Ordax-platform publica
serviços backend de forma independente e compatível. Ordax-site e
ordax-creator possuem builds e entregas próprias.

Uma atualização de app ou backend não obriga recompilar kernel ou Surface;
mudanças de contratos só podem avançar com testes de compatibilidade nos
consumidores. Não confundir gate de CI, PR de integração e release ativa.

## Regressões

Executar:
python3 -m unittest discover -s tests -p test_source_integration_advance.py -v

O teste inclui alteração de source, ausência de mudança relevante, rollback
proibido, idempotência, rejeição de arquivos fora do grafo Intelligence e
preservação de activation_authorized=false. Testes do consumidor continuam
nos workflows originais, sem cópia do materializador nem outro updater.
