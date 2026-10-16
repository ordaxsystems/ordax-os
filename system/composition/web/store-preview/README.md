# Loja OrdaX — página isolada de apresentação

Esta página começou como prévia separada, usando as cores e identidade Meridian.
Em 2026-10-14 o usuário autorizou integrá-la ao Web mantendo os mocks. O renderer,
as fixtures e a fila agora pertencem a `system/surface/workspace/components/store/presentation/`;
esta entrada continua disponível como apresentação isolada, sem segundo catálogo
oficial. Pode ser aberta no host Web existente em
`/store-preview/` durante o desenvolvimento. Para gerar somente esta página,
na raiz do repositório, com as dependências existentes:

```powershell
npm.cmd run build:store-preview --workspace tools/surface-web
npm.cmd run preview:store-preview --workspace tools/surface-web
```

O resultado fica em `out/store-preview` e o preview do build em
`127.0.0.1:4204`. A entrada do produto continua separada.

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

O `preview-data.js` compartilhado acrescenta somente metadados fictícios de apresentação ao
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

Após autorização posterior do usuário, passaram 69 testes automatizados,
typecheck/build Web, build isolado, verificação de 34 arquivos de referência e
28 verificações de navegador. As transições da fila foram extraídas para
`session.js`, que delega ao mesmo reducer demonstrativo, para regressões de
cancelamento, serialização e falha sem mutação do estado anterior.
[Evidências, comandos e limites](../../../../docs/evidence/store-preview-2026-10-14/README.md).
A validação dos mocks não homologa instalações nem a experiência de produção.
A integração atual usa o mesmo renderer com lifecycle montável e CSS encapsulado,
sem iframe nem alteração do hash do sistema. O catálogo real continua separado.
A escolha de material no Web integrado segue as Preferências; somente a página
isolada mantém escolha local de apresentação. Mocks não viram inventário oficial.
