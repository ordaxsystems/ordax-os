# Baseline de Lançamento — OrdaX

Status: CANÔNICO PARA ESCOPO DE LANÇAMENTO

> Compatibilidade documental: o arquivo continua se chamando `MVP.md` porque esse caminho é referenciado por agentes, contratos, documentação e histórico. **“MVP” não é mais a estratégia ativa de produto.** Quando documentos antigos, nomes de profiles, contratos ou identificadores técnicos usarem `MVP`/`stable-mvp`, leia-os como nomenclatura histórica ou identificador de compatibilidade até uma migração específica, e não como autorização para reduzir o produto a um conjunto mínimo.

Este arquivo define **o que pertence ao ciclo de lançamento do OrdaX**. Leia-o antes de trabalhar em lançamento, USB, Creator, Native, Surface, apps, Conta, Spaces, Intelligence, Studio, Runtime, Web, Mobile, Platform, distribuição ou monetização.

`docs/CURRENT-STATE.md`, manifests, owners e contratos machine-readable continuam descrevendo **o que existe, está habilitado e foi provado hoje**. Este arquivo define escopo e política; ele não transforma implementação incompleta em `PASS`.

## 1. Princípio central

O OrdaX não está mais sendo desenvolvido segundo a lógica de “produto mínimo”.

A regra de lançamento é:

> **Tudo que já foi efetivamente iniciado, incorporado ao produto, exposto ao usuário ou assumido como parte necessária de um fluxo do OrdaX deve ser levado a um estado funcional, seguro, integrado e coerente.**

Isso não significa esperar indefinidamente por toda ideia futura antes de lançar.

Também não significa cortar funcionalidades já iniciadas apenas para reduzir escopo.

O equilíbrio obrigatório é:

- concluir o que já faz parte do produto;
- não criar versões falsas ou reduzidas apenas para “caber no lançamento”;
- não transformar ideias ainda não iniciadas em bloqueadores automáticos;
- não manter mocks permanentes no lugar de capacidades que o produto realmente precisa;
- não atrasar um canal funcional por outra capacidade independente que ainda esteja em homologação;
- preservar segurança, integridade, privacidade, recovery e autoridade dos owners como gates reais.

## 2. Regra de inclusão no Baseline de Lançamento

Uma capacidade pertence ao Baseline de Lançamento quando pelo menos uma das condições abaixo for verdadeira:

1. existe implementação efetivamente iniciada no owner canônico;
2. a capacidade já aparece em um fluxo real entregue ou em construção para o usuário;
3. outra capacidade já iniciada depende dela para funcionar corretamente;
4. já foi assumida como parte do produto em contrato, owner, Surface, app, Creator, Runtime, Platform ou documentação canônica;
5. sua ausência deixaria um fluxo iniciado incompleto, enganoso, inseguro ou estruturalmente provisório;
6. uma referência de produto aprovada revela a necessidade de uma capacidade coerente com o OrdaX e a decisão de produto é incorporá-la ao sistema real.

Quando uma capacidade entrar por esses critérios, a resposta padrão não é “pós-MVP”. A resposta é **integrar corretamente ou registrar um bloqueio técnico real com próximo gate explícito**.

## 3. O que não entra automaticamente

Não são bloqueadores automáticos do lançamento:

- ideias somente conceituais que nunca foram iniciadas;
- expansões futuras sem dependência de um fluxo atual;
- polimento ilimitado depois que a experiência já está correta, acessível e consistente;
- integrações de terceiros ainda não assumidas pelo produto;
- variantes adicionais de uma capability que já possui uma versão segura e funcional;
- features experimentais que não foram reconciliadas com contratos e arquitetura do OrdaX.

Esses itens podem ser planejados, mas não devem transformar o lançamento em uma meta infinitamente móvel.

## 4. Implementado, integrado, homologado e disponível não são sinônimos

Toda capacidade deve preservar estados de maturidade explícitos:

```text
conceito
 -> contrato/owner
 -> implementação
 -> testes
 -> integração
 -> homologação no host/canal
 -> disponibilidade autorizada
```

Ter UI, código, contrato, branch, ícone, endpoint, build ou CI verde isoladamente não significa que a funcionalidade esteja disponível ao usuário.

Da mesma forma, uma capacidade ainda não homologada publicamente **não sai do escopo de desenvolvimento** apenas por ainda não poder ser exposta.

Nunca alterar um gate para fazer uma UI parecer funcional.

## 5. Um produto, múltiplos modos

O OrdaX é um produto com modos de capacidade compartilhando o mesmo domínio e owners:

```text
OrdaX Web
OrdaX Mobile
OrdaX Desktop
OrdaX OS — USB
OrdaX OS — Nativo (SSD/HD/NVMe)
```

Não criar forks permanentes, backends paralelos ou domínios distintos para resolver diferenças de ambiente.

Diferenças legítimas pertencem a adapters, capabilities, profiles, configuração, canal de distribuição e políticas de autorização.

Uma modalidade não precisa bloquear outra quando são independentes. Exemplo: o USB pode ser lançado quando seus próprios gates passarem mesmo que Native em disco ainda esteja em homologação. Isso não retira Native do Baseline de Lançamento se sua implementação já foi iniciada.

## 6. Owner / Development e Stable

### Owner / Development

Pode usar ferramentas de engenharia necessárias ao desenvolvimento, incluindo checkout Git e diagnóstico detalhado, desde que essas ferramentas não se tornem dependências ocultas do produto final.

### Stable

O usuário não depende de Git operacional, shell, Codex, ferramenta do desenvolvedor ou conhecimento interno para usar, atualizar ou recuperar o OrdaX.

Stable usa releases verificadas, health, conhecido-bom e rollback/recovery conforme os owners e contratos correspondentes.

Identificadores legados como `stable-mvp` podem continuar existindo tecnicamente até migração segura. O nome não redefine o escopo atual.

## 7. Regra para interfaces e concepts — incluindo Meridian

Referências visuais e concepts devem ser reconciliados com o produto real, não tratados apenas como decoração.

Para cada elemento ou funcionalidade presente em uma referência aprovada, classifique:

### A. Capacidade já existente

Conectar a UI ao owner, contrato, service, adapter e persistência canônicos existentes.

Não duplicar lógica.

### B. Capacidade ainda inexistente, mas coerente com o produto

Não apagar automaticamente a função do layout e não manter mock permanente.

Definir o owner correto e implementar a capacidade real, preferencialmente no fluxo:

```text
contrato/domínio
 -> owner/service
 -> adapter/persistência/backend quando necessário
 -> UI
 -> testes
```

Uma capability criada a partir dessa análise passa a integrar o Baseline de Lançamento quando for assumida pelo produto e iniciada no owner canônico.

### C. Capacidade válida, mas dependente de infraestrutura ainda bloqueada

Preservar a intenção de produto e apresentar estado honesto quando necessário. Não simular sucesso.

Registrar a dependência e o gate real. A capacidade continua no inventário e pode continuar sendo desenvolvida sem ser exposta antes da homologação.

### D. Elemento experimental que não pertence ao OrdaX

Não implementar apenas para copiar uma referência. Documentar a decisão quando necessário.

### Regra Meridian

Meridian é referência visual/produto conforme sua proveniência e decisões vigentes, **não uma segunda arquitetura**.

Não criar runtime, store, lifecycle, identidade, rede, preferências ou backend “do Meridian”.

Se a evolução do produto tornar um gate documental Meridian obsoleto, o correto é **atualizar/revalidar o gate e a documentação canônica na mesma frente**, e não ignorá-lo silenciosamente nem deixar um documento antigo bloquear indefinidamente uma decisão atual de produto.

## 8. Mocks e lacunas de backend

Mocks são permitidos em testes, previews e experimentos explicitamente identificados.

No produto real:

- não fingir login;
- não fingir conexão de rede;
- não fingir persistência;
- não fingir sync;
- não fingir instalação;
- não fingir conclusão de fluxo;
- não fingir disponibilidade de backend.

Quando a UI necessita de uma capacidade que ainda não existe, decidir primeiro se essa capacidade pertence ao produto.

Se pertence, implementar no owner correto.

Se depende de infraestrutura ainda não autorizada, mostrar estado indisponível/pendente de forma honesta e continuar a implementação no lugar correto quando possível.

## 9. Critério de bloqueio do lançamento

Uma capacidade bloqueia um canal/release quando sua ausência ou falha:

- impede o fluxo anunciado daquele canal;
- causa risco crítico de segurança ou privacidade;
- ameaça dados do usuário;
- viola integridade, assinatura ou autorização;
- impede boot, first-run, uso essencial, atualização ou recovery daquele modo;
- deixa uma funcionalidade explicitamente prometida naquele release falsamente funcional;
- quebra um contrato canônico necessário para o modo anunciado.

Uma capacidade independente em desenvolvimento **não bloqueia automaticamente** outro canal que já esteja completo e seguro.

Assim, o objetivo é evitar os dois extremos:

```text
ERRADO: cortar o produto até sobrar um MVP artificialmente pequeno.
ERRADO: adiar o lançamento até toda ideia futura estar pronta.
CERTO: concluir o produto já iniciado e liberar cada capacidade/canal quando seus gates reais passarem.
```

## 10. Primeiro uso, Conta e sessão local

A jornada de primeiro uso deve usar owners reais e só concluir quando seu owner canônico confirmar a conclusão.

Conta OrdaX e proteção local são responsabilidades distintas:

- **Conta OrdaX**: identidade online, autenticação, sessão, recuperação, sync e serviços autorizados;
- **sessão/bloqueio local**: proteção daquele dispositivo/sessão e funcionamento local/offline.

Não reutilizar senha da Conta como senha/PIN local por conveniência arquitetural.

A disponibilidade de uma Conta real não deve criar uma segunda identidade local paralela.

Quando o produto permitir uso offline, a indisponibilidade da nuvem não pode transformar o sistema em inutilizável.

Fluxos de login, cadastro, recuperação, PIN/senha local, privacidade, idioma, teclado, região e rede que já estiverem iniciados devem ser concluídos nos owners correspondentes, e não removidos para reduzir escopo.

## 11. USB, Native e Creator

O USB é um modo de produto utilizável e não deve ser tratado apenas como instalador transitório.

O Creator continua sendo o caminho normal de preparação do USB Stable e deve operar sobre releases verificadas conforme os contratos atuais.

Native em SSD/NVMe/HD permanece parte do Baseline de Lançamento porque sua implementação já foi iniciada, mas sua **disponibilidade pública** depende de provas reais de seleção segura de alvo, escrita, boot, criptografia quando aplicável, persistência, atualização, rollback e recovery.

Nunca usar uma opção de UI ou mudança documental para contornar gates destrutivos de disco.

Dual boot, resize automático e preservação de instalações existentes só entram quando houver decisão explícita, contratos e provas correspondentes; não são inferidos pela existência do modo Native.

## 12. Surface, Apps, Intelligence, Spaces, Studio, Runtime e Platform

Tudo que já foi efetivamente iniciado nesses domínios deve ser inventariado e reconciliado com seus owners atuais.

Isso inclui, quando já iniciado ou assumido pelos owners atuais:

- Surface e experiência visual;
- apps first-party;
- OrdaX Intelligence e IA local;
- Conta e identidade;
- Spaces e Profile Packs;
- Store/distribuição;
- Network e colaboração;
- Studio;
- Runtime/Device Host;
- ferramentas e ações governadas;
- Web/Desktop/Mobile;
- serviços Platform e control plane;
- atualização, distribuição e recovery;
- segurança e privacidade.

A presença nesta lista **não declara que tudo está público hoje**. Disponibilidade continua capability-driven e baseada em prova.

Também não autoriza criar implementações duplicadas para “fechar rapidamente” uma feature.

## 13. Segurança e integridade

Não são negociáveis para acelerar lançamento:

- autenticação e autorização corretas;
- isolamento entre usuários/Spaces;
- proteção de secrets e credenciais;
- consentimento para ações destrutivas;
- integridade e assinatura de artefatos onde exigidas;
- fail-closed para capacidades sensíveis;
- rollback/recovery onde o modo exigir;
- proteção contra conclusão falsa de operações;
- logs e diagnósticos sem vazar secrets;
- source authority e owners únicos.

“Lançar sem atrasar” nunca significa aceitar uma gambiarra de segurança.

## 14. Atualizações e evolução depois do lançamento

O lançamento não congela o OrdaX.

Uma capacidade pode receber melhorias posteriores sem que isso signifique que estava incompleta no lançamento, desde que a versão publicada já seja funcional, segura, coerente e honesta sobre seus limites.

Depois do lançamento, novas capacidades continuam entrando por owners canônicos e atualizações verificadas.

Não usar “vamos atualizar depois” para justificar fluxo quebrado, mock permanente, perda de dados, falsa autenticação ou feature iniciada sem implementação mínima coerente.

## 15. Monetização

Monetização não deve ser inventada apenas para fechar o lançamento.

Preço, tiers, quotas e limites comerciais exigem decisão própria.

A arquitetura pode possuir entitlements e capacidades premium sem que exemplos ou defaults internos se tornem automaticamente política comercial pública.

Perfil da conta, Space, Profile Pack e entitlement continuam conceitos diferentes e não devem ser fundidos por conveniência de UI.

## 16. Regra para documentação e planos antigos

Documentos e planos históricos que usam as expressões:

- `MVP`;
- `pré-MVP`;
- `pós-MVP`;
- `MVP-only`;
- `depois do MVP`;

não têm autoridade para retirar automaticamente uma capacidade já iniciada do Baseline de Lançamento.

Ao tocar uma frente afetada:

1. compare o texto antigo com este documento, `docs/CURRENT-STATE.md`, owners e contratos;
2. preserve evidência histórica;
3. atualize a documentação ativa quando houver conflito real;
4. não faça limpeza massiva de nomes/IDs técnicos sem necessidade, para evitar regressão;
5. não mantenha uma restrição antiga apenas porque ainda existe a palavra `MVP` em algum arquivo.

## 17. Regras para agentes e próximos chats

- `main` é a source authority;
- ler `AGENTS.md` e a documentação obrigatória antes de alterar;
- não duplicar owner, backend, store, adapter ou fluxo;
- concluir capacidades já iniciadas em vez de descartá-las por “escopo de MVP”;
- não transformar toda ideia futura em requisito de lançamento;
- não reduzir front-end para esconder backend incompleto quando a capacidade deve existir;
- implementar backend/owner correto quando uma capability válida estiver faltando;
- mocks somente em teste/preview explicitamente identificado;
- preservar gates técnicos reais e fail-closed;
- não anunciar função futura como disponível;
- não declarar prova física quando houve somente CI/emulação;
- não reconstruir kernel ou artefatos não afetados sem dependência real;
- mudanças de UI não devem disparar builds de Base/kernel sem motivo técnico;
- preservar SSOT e evitar documentos paralelos;
- preferir solução estrutural limpa a paliativo;
- quando uma decisão de produto tornar uma restrição documental obsoleta, reconciliar a documentação canônica em vez de ignorá-la.

## 18. Critério prático de encerramento do Baseline de Lançamento

O Baseline de Lançamento está suficientemente fechado quando:

1. os fluxos anunciados para cada canal publicado funcionam ponta a ponta;
2. capacidades iniciadas não permanecem como shells vazios ou mocks de produção;
3. capacidades ainda não publicáveis possuem implementação isolada e gate real conhecido, sem mentir para o usuário;
4. segurança, privacidade, atualização e recovery dos modos publicados estão provados;
5. não existem duas autoridades para a mesma responsabilidade;
6. documentação, contratos e source não contradizem materialmente o produto entregue;
7. itens futuros ainda não iniciados podem continuar evoluindo sem impedir a publicação do que já está completo.

## 19. Autoridades relacionadas

Consultar sempre, conforme a frente:

- `AGENTS.md`;
- `docs/CURRENT-STATE.md`;
- `docs/README.md`;
- `docs/ARCHITECTURE.md`;
- `docs/PRODUCT-MODES.md`;
- `docs/PROMOTION-GATES.md`;
- `docs/DECISIONS.md`;
- `docs/ACCOUNT-SYNC-AND-PLANS.md`;
- `docs/NATIVE-INSTALLATION.md`;
- `docs/PHYSICAL-MEDIA.md`;
- `docs/PUBLIC-SITE.md`;
- contratos machine-readable correspondentes em `docs/contracts/`.

Este arquivo é o **SSOT de escopo do Baseline de Lançamento**. Estado atual, flags, versões, disponibilidade e provas permanecem nos owners, manifests, contratos e `docs/CURRENT-STATE.md` correspondentes.
