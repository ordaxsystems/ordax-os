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
o grafo portátil completo — todos os módulos `src/*.mjs` e o builder técnico
exato — é derivado da árvore Git e atualizado em conjunto. Um commit que muda só
documentação não causa release/rebuild do OS. O avanço nunca altera status,
activation_authorized, cutover_complete, política de distribuição, dispositivos
físicos ou o código de serviços do OS.

O job seleciona o **último commit da linha principal (first-parent)
que realmente alterou um caminho consumido pelo OS**. Isso evita que uma
mudança de documentação posterior, sem workflow upstream por filtro de paths,
mascare a CI que validou a alteração real. O commit selecionado precisa ser
descendente do pin anterior: caso contrário a integração falha fechada e não
retrocede SHA. O job exige o workflow upstream **concluído com sucesso para
esse exato commit da main** quando uma fonte realmente consumida muda.
Rejeita CI ausente, falha, cancelada ou em andamento. Quando há uma PR pendente para o mesmo owner, o coordenador
**reaproveita essa PR** e acrescenta a revisão mais recente por commit
fast-forward, com CI novamente vinculada ao novo head. O inventário percorre
todas as páginas de PRs, exige repositório de origem correto, base main e
diff contendo **exatamente um lock**; duas PRs concorrentes, mudança simultânea
de main ou branch alterada durante a operação falham fechadas. Se não existir
PR aberta, usa a branch determinística
`automation/advance-<owner>-<source_sha_completo>`, vinculada ao commit
imutável que passou no gate upstream. Isso evita reutilizar uma branch
antiga mantida após merge por *squash*: o commit da PR fechada pode não ser
ancestral da `main`, mesmo com o lock aprovado. Ao encontrar uma branch
com **o mesmo nome exato** de candidata nova, permite fast-forward apenas
se a referência já for ancestral da `main`. Se o `git push` da candidata
tiver sido concluído, mas a criação da PR falhou depois, pode recuperar
**somente aquela branch exata**: commit com pai único ancestral da
`main`, diff contendo exatamente o lock, conteúdo idêntico ao source
revalidado, referência remota ainda inalterada e nenhuma PR anterior
(aberta, fechada ou integrada) para a branch. O único efeito dessa
recuperação é criar a PR que faltou; não faz novo commit nem force-push.
Uma branch anteriormente revisada e fechada não é reaberta, mesmo se
contiver o mesmo lock. Qualquer divergência falha fechada sem reescrever
branches de terceiros. Uma única PR aberta para o owner continua tendo
precedência, mesmo quando sua branch foi criada para um commit upstream
anterior. Não há force-push, rebase
de histórico de terceiros nem segunda PR simultânea. Caso a main
upstream tenha sido reescrita, falha em vez de aceitar um force-push como
atualização. A PR altera **somente um lock**. No caso da Intelligence, todos os
módulos `src/*.mjs` e o builder técnico fixado contam como código consumido;
um helper adicional exclusivo do Windows fora de `src/`, documentação ou CI
externa não entra no OS, não altera o pin nem obriga recompilar o kernel.

A integração usa os workflows consumidores que o OS **já possui**, com
workflow_dispatch em SHA de branch quando a PR é criada por GITHUB_TOKEN.
Não há merge automático que salte CI, gate de hardware, revisão ou rollback.

## Autenticação do job — GitHub App renovável somente para PR nova

A automação já usa o **GITHUB_TOKEN efêmero** para verificar source e atualizar
uma PR existente, comprovadamente única e limitada ao lock do owner. O token
nativo não tem autorização para **criar** PRs neste repositório.

Para criar uma PR nova, provisionar **uma única vez** um GitHub App instalado
somente em `ordaxsystems/ordax-os`, com `Contents: write` e
`Pull requests: write` (mais a permissão implícita de metadata read).
Configurar em **Settings → Secrets and variables → Actions** estes dois
segredos, pertencentes à mesma instalação aprovada:

- `ORDAX_INTEGRATION_APP_CLIENT_ID`: Client ID do GitHub App canônico;
- `ORDAX_INTEGRATION_APP_PRIVATE_KEY`: chave privada PEM desse GitHub App.

**Não armazenar installation access token** como segredo estático: ele expira.
Quando o workflow verifica uma fonte nova e comprova que nenhuma PR do lock
está aberta, a action oficial `actions/create-github-app-token` (versão
imóvel por commit) cria um **installation token de vida curta**, restrito ao
repositório e às duas permissões acima. A action o revoga ao final do job.
Se faltar um dos dois segredos, o job falha fechado. Se ambos faltarem,
o preflight já existente impede `git push` ou criação de branch órfã.
Não usar PAT amplo, credencial de conta pessoal, nem token de release.

Se a PR única **já estiver aberta**, o workflow continua com `GITHUB_TOKEN`
e não cria token App nem PR adicional. Como mudanças com `GITHUB_TOKEN`
não provocam os eventos usuais `pull_request`, ele despacha os workflows
consumidores **já existentes** no SHA da branch, sem duplicar testes:

- Surface: Foundation, Surface External Source Consumer, Owner Surface Source
  Transaction e Windows Desktop Dev.
- Intelligence: Foundation, Intelligence cross-repository source gate e
  Owner Intelligence source staging.

Uma PR recém-criada com o token App provoca a CI nativa e não dispara
um segundo conjunto de checks. Checks adicionais de Creator/USB/QEMU
continuam sujeitos aos gates da composição. **Nenhuma credencial, CI verde
ou PR integrada autoriza escrita física, Stable ou ativação Intelligence**.

## Ativação após o merge

- **Windows Desktop Dev:** `ordaxsystems/ordax-desktop/dev-update.cjs` observa a main
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

O teste inclui alteração de source, ausência de mudança relevante, seleção
do commit de origem quando a main termina com documentação ou ferramentas
Windows não consumidas, rollback proibido, idempotência, isolamento do grafo
portátil completo da Intelligence, autorização de source inativa e ciclo da PR
única (paginação, verificação de repositório/lock, deduplicação e atualização
sem force-push). Testes do consumidor continuam
nos workflows originais, sem cópia do materializador nem outro updater.
