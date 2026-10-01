# PLANO-08 — OrdaX Network, Comunidades e Mensagens

Status: CANÔNICO PARA ESCOPO MVP

A OrdaX Network é uma capacidade horizontal da plataforma. Ela não pertence ao Profile Pizzaria, não cria uma segunda identidade e não transforma Profile Packs em redes sociais isoladas.

## 1. Modelo

```text
Account
  -> Space
      -> Profile Pack(s)
      -> Network identity
          -> Directory
          -> Communities
              -> Groups
          -> Conversations
```

- **Account** autentica a pessoa.
- **Space** é a identidade contextual/profissional que participa da rede.
- **Profile Pack** compõe ferramentas e pode recomendar comunidades relevantes.
- **Network** é infraestrutura compartilhada por todos os Profiles.
- **Messages** é infraestrutura comum para conversa 1:1 e em grupo.

O cliente nunca é autoridade para identidade, membership, role, moderação ou entrega de mensagem.

## 2. Princípio de produto

Profiles podem declarar afinidade com comunidades, categorias e diretórios, mas associação e visibilidade exigem decisão explícita do usuário/Space.

```text
pizzaria-br@1
  -> sugere industry.food.pizzeria.br
  -> não entra automaticamente
  -> não torna o Space público automaticamente
```

A remoção de um Profile não apaga mensagens, grupos, contatos ou identidade Network. Sair de comunidade é uma ação separada.

## 3. Fatia obrigatória do MVP

O MVP público inclui:

1. **Diretório profissional por Space**
   - nome público do Space;
   - imagem/logo opcional;
   - descrição curta;
   - região ampla opcional;
   - categorias/tags;
   - descoberta somente para Spaces com visibilidade explicitamente habilitada.

2. **Comunidades**
   - comunidades canônicas por segmento;
   - entrada voluntária;
   - hub da comunidade;
   - membros visíveis conforme policy;
   - busca básica.

3. **Grupos**
   - grupos dentro de comunidade;
   - público para membros ou privado por convite;
   - roles server-authoritative;
   - criação, entrada, saída e remoção governadas por policy.

4. **Mensagens**
   - conversa 1:1 entre Spaces autorizados;
   - conversa de grupo;
   - histórico paginado;
   - texto e referências/links seguros;
   - anexos binários somente depois de pipeline dedicado de malware/content safety/storage.

5. **Trust & Safety mínimo**
   - bloquear Space;
   - denunciar Space, grupo ou mensagem;
   - sair de conversa/grupo;
   - rate limit e antispam;
   - trilha administrativa de moderação;
   - isolamento multi-tenant provado.

## 4. Fora do MVP inicial da Network

Não bloqueiam o primeiro lançamento:

- feed algorítmico infinito;
- anúncios;
- marketplace;
- ranking de popularidade;
- recomendação comportamental opaca;
- stories/reels;
- voz/vídeo;
- pagamentos;
- bots com authority;
- federação aberta;
- promessa de criptografia ponta a ponta sem protocolo implementado, revisado e provado.

## 5. Privacidade e identidade

A identidade pública profissional é o **Space**, não a conta pessoal.

Regras:

- descoberta é opt-in;
- membership é opt-in;
- e-mail e perfil pessoal não são publicados por padrão;
- localização exata é proibida no diretório padrão;
- bloqueio impede novas interações conforme policy;
- Profile Pack não publica o Space;
- exclusão/desativação do Profile não apaga a identidade Network;
- exclusão de conta/Space usa política explícita de retenção/tombstone;
- usuário sem conta continua usando o OrdaX localmente; Network fica indisponível de forma honesta.

## 6. Boundary técnico

Network não usa account sync como event bus e não usa Memory como banco de chat.

```text
Surface / Web / Mobile
        |
        v
OrdaX Network API
        |
        +-- directory
        +-- communities
        +-- memberships
        +-- groups
        +-- conversations
        +-- messages
        +-- moderation
```

Account sync transporta estado portátil elegível. Network possui estado colaborativo próprio. Memory nunca ingere conversas automaticamente. Intelligence somente consulta/resume conteúdo com autorização e escopo explícitos.

## 7. Segurança obrigatória

Antes de exposição pública:

- autenticação real e sessão revogável;
- autorização server-side em toda leitura e mutação;
- RLS/ABAC equivalente por Account/Space/membership;
- IDs opacos e não enumeráveis como única referência pública;
- checagem de ownership/membership dentro da mesma transação da mutação;
- idempotency key nas mutações críticas;
- constraints de unicidade e integridade no banco;
- paginação limitada e limites de payload;
- texto armazenado como texto estruturado/sanitizado, nunca HTML confiado do cliente;
- links tratados como conteúdo não confiável;
- rate limit por actor, Space e operação;
- proteção contra spam, scraping e enumeração de diretório;
- auditoria de mudanças de role, ban, report e decisões de moderação;
- mensagens não concedem capability, entitlement ou autoridade de sistema;
- tokens/segredos nunca entram no conteúdo sincronizado ou no JavaScript privilegiado;
- testes negativos entre duas contas e múltiplos Spaces;
- fail-closed: ausência de policy/role/membership resulta em negação;
- nenhuma falha da Network pode impedir boot, Surface ou apps locais.

Nenhum cliente pode escrever diretamente em tabelas de outro tenant fora das policies canônicas.

## 8. Contratos v1

A autoridade machine-readable é `docs/contracts/network-foundation.json`.

Entidades lógicas:

- `network_space_profile`;
- `network_community`;
- `network_membership`;
- `network_group`;
- `network_group_membership`;
- `network_conversation`;
- `network_conversation_member`;
- `network_message`;
- `network_block`;
- `network_report`;
- `network_audit_event`.

Nomes físicos de tabelas e fornecedor de backend não fazem parte do contrato público.

## 9. Profiles e afinidades

O vínculo Profile -> Network fica em `system/network/profile-affiliations.json`, separado do manifest do Profile.

Isso garante:

- Profile não é dono do domínio social;
- membership continua voluntário;
- comunidade pode existir sem Profile;
- uma comunidade pode atender vários Profiles;
- vários Profiles reutilizam o mesmo Network.

Primeira afinidade:

```text
pizzaria-br@1 -> industry.food.pizzeria.br
```

É recomendação de descoberta, nunca auto-join.

## 10. UX mínima

Dentro de um Space profissional:

```text
Rede
  -> Descobrir
  -> Comunidades
  -> Grupos
  -> Mensagens
```

O Profile Pizzaria pode exibir “Rede de Pizzarias”, mas abre a superfície compartilhada **Rede** com o Space remetente explícito.

Trocar de Space nunca retargeta silenciosamente conversa ou mensagem em composição.

## 11. Gate do MVP público

Para declarar a Network MVP:

- diretório opt-in funcional;
- join/leave de comunidade;
- grupos e roles;
- chat 1:1 e grupo com paginação;
- bloqueio e denúncia;
- rate limits;
- sanitização e limites;
- tombstones/retention definidos;
- teste de isolamento entre tenants;
- UI identifica claramente o Space remetente;
- observabilidade sem registrar corpo de mensagem ou segredo por padrão;
- revisão de segurança antes de promoção.

A Network é gate do **MVP público online**, mas não é gate de boot do USB. Falha ou ausência de internet degrada para indisponível sem impedir o produto local.

## 12. Integrações externas

Produtos OrdaX ou parceiros não leem tabelas internas. Integração ocorre por API/capability autenticada e scopes mínimos.

Um produto como Achegue-se pode usar:

- Sign in with OrdaX;
- Space autorizado;
- deep link para comunidade/conversa;
- criação de conversa mediante consentimento;
- diretório segmentado conforme policy.

Achegue-se continua dono de Mapa, Empresas e Perto de mim. OrdaX continua dono de Account, Space, Network e Messages. Não há foreign keys nem acesso SQL cruzado entre produtos.

## 13. Ordem de implementação

1. contrato e catálogo de afinidades;
2. threat model e matriz de autorização;
3. schema/migrations + RLS/policies;
4. API de diretório/comunidade;
5. memberships/grupos;
6. conversations/messages;
7. block/report/rate limits/auditoria;
8. app Rede na Surface;
9. card contextual no Profile Pizzaria;
10. prova E2E com duas contas e múltiplos Spaces;
11. revisão de segurança;
12. integração do Achegue-se por boundary público.
