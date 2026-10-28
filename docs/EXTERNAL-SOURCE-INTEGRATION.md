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
SHA da main**. Rejeita CI ausente, falha, cancelada ou em andamento. Se houver
uma PR de integração aberta para o mesmo owner, não cria PR paralela. Caso a
main tenha sido reescrita, falha em vez de aceitar um force-push como atualização.
A PR altera **somente um lock** e aciona os workflows consumidores já existentes.
Não há merge automático que salte CI, gate de hardware, revisão ou rollback.

## Credencial do job

Configurar uma vez no repositório ordax-os o secret Actions
ORDAX_INTEGRATION_TOKEN, com credencial de GitHub App ou token de escopo
mínimo restrito ao ordax-os: Contents read/write e Pull requests read/write.
Não gravar tokens em source, logs ou release. Um GITHUB_TOKEN ordinário não
substitui essa credencial para criação de PR: GitHub impede que PRs criadas
por GITHUB_TOKEN disparem os workflows consumidores. Sem a credencial, a
proposta falha fechada e nenhuma branch é publicada. A execução manual do
workflow também usa o mesmo contrato.

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
