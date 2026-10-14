# Loja OrdaX — página isolada de apresentação

Esta página foi solicitada explicitamente como prévia separada, usando as cores e
identidade visual Meridian. Não é uma composição de produção da Store nem um
segundo catálogo oficial. Pode ser aberta no host Web existente em
`/store-preview/`, sem instalar dependências ou executar build.

## Inventário factual preservado

- `system/apps/store/` continua sendo o app estrutural.
- `system/contracts/app-store.mjs` e o catálogo verificado continuam owners reais.
- `verified-store-projection.mjs`, `store-lifecycle-request-service.mjs` e
  `store-update-request-batch.mjs` continuam os serviços de projeção e requests.
- Aquisição HTTPS, CAS, assinatura, staging e ativação permanecem no runtime.
- Esta página importa o catálogo demonstrativo e o reducer de sessão existentes
  de `system/surface/workspace/lib/store/`; não conecta ports oficiais.
- Essenciais usa os IDs do owner `first-run-selection.mjs`.

## Implementado nesta prévia

Descoberta, essenciais, aplicativos, modelos/provedores/agentes, conectores,
extensões, pacotes, biblioteca, instalados, atualizações e fichas por item.
Busca global por metadados, filtros de categoria/plataforma/tipo e ordenação.
Coleções editoriais; previews de interface claramente ilustrativos. Fichas com
versões, tamanho, changelog, permissões, origem, licença e requisitos quando
existem no exemplo. Modelos com comparação e instalação indisponível.

Fluxos demonstrativos de instalação, autorização, aplicação, remoção e update.
Atualizações organizadas em disponíveis, fila e resultados. Etapas visuais próprias
para apps, remoção, conectores, agentes e pacotes. Fila serial, cancelamento antes
da execução, progresso ilustrativo e resultado
explicitamente simulado. Notas demonstra falha de update preservando a versão
anterior. Remoção exige confirmação, preserva dados e só pode ser seguida de
reinstalação voluntária. Modos de catálogo disponível/offline/loading/erro com
retry; biblioteca conhecida permanece acessível durante falha/loading do catálogo.
Navegação por URL hash, retorno com busca/filtros/rolagem preservados, foco visível,
dialog nativo e busca por teclado. Modelos podem ser filtrados por tarefa.
Idiomas mostram reinício pendente; templates ficam disponíveis para novos projetos.
Argila/Grafite usam o mesmo DOM e a mesma navegação.

## Dados e proveniência

`preview-data.js` acrescenta somente metadados fictícios de apresentação ao
catálogo demonstrativo já existente. Versões, datas, canais Beta, tamanhos e
changelogs são exemplos. Não correspondem a artefatos publicados ou verificados.
Nenhum modelo recebe requisito ou compatibilidade inventada.

Paleta e glyphs vêm do estudo Meridian no repositório `ordaxsystems/ordax-os`,
referência de Visual Freeze `e7cf628a01878c484d47997721518fe6f2330c10`, pelos arquivos
`meridian.tokens.css` (somente Argila/Grafite) e `icons.mjs`. Símbolo e fonte Inter
consomem os assets do OS. Nenhum shell/controller experimental é importado.

## Pendente e limites

Backend, inventário combinado real, receipts assinados, lifecycle first-party,
ativação, probation, rollback físico, direitos de conta e Native dependem dos
owners canônicos e de seus gates. Esta página não implementa pagamento,
marketplace executável de terceiros, OAuth real, downloader ou permission manager.
A escolha do material não grava preferências. Estado dos mocks dura na sessão.

Testes, npm, typecheck e build não foram executados por solicitação do usuário.
A abertura da página para apresentação não homologa a experiência de produção.
Próximo gate: revisão visual pelo usuário; integração posterior pelo owner Surface,
sem promover mocks a estado oficial. A tentativa anterior no renderer integrado
foi supersedida e não faz parte da página isolada publicada nesta branch.
