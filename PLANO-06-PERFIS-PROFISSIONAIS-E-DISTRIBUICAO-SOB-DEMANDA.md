# OrdaX — parte 6: Profiles profissionais e distribuição sob demanda

**Estado:** fundação MVP em implementação.  
**Decisão canônica:** o pendrive Stable não carrega todos os Profiles profissionais. Ele carrega o Runtime único, Intelligence, Memory, apps essenciais e um catálogo leve. Conteúdo profissional é provisionado sob demanda e, depois de instalado, deve continuar utilizável offline dentro de suas capacidades locais.

## 1. Princípio

```text
Profissão é composição.
Runtime é único.
Dados do usuário pertencem ao Space/Memory, não ao Profile.
```

Um Profile profissional é um **Profile Pack versionado aplicado a um Space**. Ele não cria outra conta, outro sistema operacional nem outro runtime.

O Profile pode compor:

- apps;
- templates;
- Knowledge Packs;
- Skill Packs;
- conectores;
- políticas de Intelligence;
- políticas de contexto/memória;
- dependências de componentes.

O Profile solicita capacidades. Runtime e Policy decidem. Usuário autoriza quando necessário.

## 2. O que fica no pendrive inicial

A imagem Stable deve permanecer pequena e previsível:

```text
Stable USB
├── OrdaX Base
├── Surface
├── Intelligence
├── Memory
├── Model Router
├── navegador / arquivos / notas / ajustes / conta / sistema
├── updater / rollback / recovery
└── Profile Catalog leve
```

O catálogo pode conter título, categoria, versão, compatibilidade, disponibilidade e composição declarada. Isso não significa que o payload pesado esteja pré-instalado.

Não colocar na imagem inicial todos os Knowledge Packs, modelos, apps verticais e assets de todos os domínios.

## 3. Distribuição

Há quatro classes distintas:

```text
Profile Pack   -> composição do ambiente profissional
App            -> software executável
Knowledge Pack -> conhecimento versionado/proveniente
Skill Pack     -> workflow/instruções/capacidades cognitivas
```

Model Packs e Connectors permanecem tipos separados quando necessários.

A instalação de um Profile é um **plano de provisionamento**, não um arquivo monolítico:

1. selecionar Profile;
2. validar Space;
3. validar compatibilidade;
4. resolver dependências;
5. identificar o que já está instalado;
6. baixar somente o que falta;
7. verificar hash/assinatura/proveniência;
8. stage;
9. instalar/registrar componentes;
10. health check;
11. ativar;
12. manter rollback/receipt.

Instalar não significa ativar automaticamente.

## 4. Offline-first

Depois de instalado, um Profile deve continuar funcionando offline para tudo que estiver localmente disponível.

- catálogo remoto pode ficar indisponível;
- Profile já instalado continua registrado;
- apps locais continuam funcionando;
- Memory/Space permanecem locais;
- Knowledge Pack local continua consultável;
- recursos que dependem de cloud degradam explicitamente;
- atualização pode esperar a rede voltar.

Nenhuma conexão cloud é requisito para simplesmente abrir um Profile já instalado.

## 5. Dados e atualização

Profile nunca é dono dos dados do usuário.

```text
Space
├── Profile ativo
├── Memory
├── Projects/Objects
├── Documents
└── Settings
```

Atualizar, desativar ou remover um Profile não apaga Memory, documentos, projetos ou objetos do Space.

Knowledge, Skills, apps e modelos são atualizados independentemente. Trocar um Knowledge Pack não exige reinstalar o Profile inteiro. Trocar um modelo não muda a identidade da Memory.

## 6. MVP

O MVP deve provar o mecanismo antes de abrir uma Store pública.

### Já existente

- `ordax.profile-pack/1`;
- runtime de Profile Pack;
- catálogo read-only;
- Spaces;
- entitlements;
- Memory/Context;
- Developer Profile como prova interna;
- Legal-BR draft e fail-closed.

### Implementação desta etapa

- contrato `ordax.profile-provisioning/1`;
- catálogo local de distribuição leve;
- planner que calcula componentes presentes/ausentes;
- download somente do que falta;
- metadados de offline/cache;
- estado installable/blocked explícito;
- nenhum download sem artifact identity + SHA-256 + assinatura exigida;
- nenhum Profile pode conceder privilégio ao ser provisionado.

### Ainda bloqueado

- Store pública;
- instalação arbitrária de terceiros;
- Legal-BR público;
- Knowledge jurídico real sem pipeline de fontes oficiais;
- billing;
- downloads reais de payload sem trust/publicação canônica.

## 7. Perfis iniciais

### Developer

Serve como prova da composição e pode continuar interno no MVP enquanto apps/capabilities reais são conectados.

### Legal BR / Advocacia Brasil

O catálogo pode conhecer o Profile, mas a ativação pública permanece bloqueada até existir:

- pipeline de fontes oficiais;
- freshness/versionamento;
- citations/proveniência;
- Knowledge Pack assinado;
- validação profissional;
- policy de dados/confidencialidade.

O modelo de IA nunca é fonte jurídica autoritativa.

## 8. Evolução

Depois da prova MVP:

1. Knowledge Pack contract/runtime;
2. Skill Pack contract/runtime;
3. Profile provisioning persistente no Native;
4. Store/catalog remoto assinado;
5. downloads transacionais;
6. Profile Stack;
7. UI de escolha no primeiro uso/Conta;
8. atualização independente por componente;
9. compartilhamento de Spaces;
10. packs adicionais: Comércio, Clínica administrativa, Educação, Creator etc.

## 9. Regras invariantes

- Runtime único.
- Base pequena.
- Profile não concede privilégio.
- Dados sobrevivem à remoção do Profile.
- Download somente após verificação.
- Componentes compartilhados não são duplicados.
- Perfil instalado pode funcionar offline.
- Falha de Profile não impede boot.
- Profile incompatível entra em disabled-safe.
- Nenhum Profile exige reinstalar o pendrive para atualização normal.
- Nenhum domínio regulado ganha autonomia irrestrita da IA.

## 10. Origem da decisão

A referência legada foi consultada diretamente no repositório
`washingtonmsdj/novo-ordax-os`, default branch `main`, snapshot observado no
commit `49fe41fa67d9032f2e349e86592304e64d6c2d88`.

Documentos de referência principais:

- `rfcs/RFC-0009-ordax-profiles.md`;
- `docs/PROFESSIONAL-RUNTIME.md`;
- `docs/STORE-VISION.md`;
- `docs/ECOSYSTEM.md`;
- `docs/ORDAX-CONSTITUTION.md`;
- `docs/USER-JOURNEYS.md`.

Os invariantes reaproveitados são:

- Runtime único;
- Profiles instaláveis, alternáveis e combináveis;
- Adaptive Workspace;
- Profile Stack;
- Store/Package Platform;
- instalação com resolução de dependências;
- stage, health, rollback e receipts;
- Profile solicita capacidades, Runtime/Policy decidem e usuário autoriza;
- remover Profile não apaga automaticamente objetos do usuário.

O runtime legado não é copiado. Os conceitos são reimplementados sobre os contratos atuais do
`prototipo-ordax-os`, com USB-only MVP, component slots, assinatura, Spaces,
Memory e Intelligence provider-neutral.
