# OrdaX — conteúdo contextual, aprendizado e divulgação por perfil

**Status (08/10/2026):** fundação contratual de descoberta implementada; **nenhum catálogo patrocinado está publicado**, sem ingestão de provedores, cobrança, tracking, endpoint ou UI de anúncios em produção. Este documento não libera monetização.

## Visão de produto

O usuário pode descobrir conteúdos úteis **no perfil que escolheu**: cursos, receitas, guias, artigos, recursos, eventos e ofertas. Exemplo: `pizzaria-br@1` pode descobrir aulas de fermentação, guias sanitários verificados, fornecedores e equipamentos. `impressao-3d-br@1` pode descobrir cursos de modelagem, fichas de materiais e capacitação. O recurso deve ser expansível para centenas de perfis usando o **Profile Pack já existente**, sem duplicar runtime/loja/perfil.

No futuro o layout do Space poderia incluir seções claramente diferenciadas:

- **Aprender e explorar**: cursos, receitas, guias e materiais editoriais.
- **Ofertas de parceiros**: patrocinados sinalizados visual e semanticamente como **Patrocinado**, com nome do patrocinador.
- **Meu conhecimento**: Knowledge Packs verificados e Memory do Space, **fora** do catálogo de publicidade.

Conteúdo comercial **não é instrução de sistema**, não pode alterar resposta de IA, classificação de fonte, memória, treinamento, permissões, resultados de busca técnica ou conhecimento verificado sem passar pelo pipeline editorial próprio. Nunca deve ser disfarçado de resposta do Jarvis.

## Owner canônico e SSOT

| Domínio | Proprietário |
| --- | --- |
| Perfil, slug, versão, composição e compatibilidade | `system/profile-packs` |
| Catálogo editorial de cursos/receitas/ofertas do perfil | Futuro serviço de descoberta; contrato `system/contracts/profile-discovery.mjs` |
| Filtragem de perfil/versão/país/idioma e separação orgânico/pago | `system/services/profile-packs/discovery.mjs` |
| Artefato assinado e confiança do editor | Infra de publicação/Trust do OrdaX, **a implementar** |
| Dados particulares dos usuários | Memory/Spaces, nunca o anunciante |
| Instalação/atualização de apps | Loja OrdaX existente; descoberta não instala nem substitui a Store |
| Respostas e acesso a conhecimento | Intelligence/Knowledge/Memory; publicidade não é um contexto automático |

O catálogo editorial possui `schema` e `revision`, entradas limitadas, `profileSlug@profileVersion`, idioma e país, URI HTTPS, editor, fonte e revisão, janela de validade e `commercial.kind` explícito. O identificador comercial não pode existir como patrocínio oculto dentro de item orgânico.

A **verificação criptográfica de publicação é obrigatória** antes de conectar a projeção a uma tela. `verifyPublication` é uma interface para esse futuro owner; uma flag de metadados recebida de fonte não confiável não prova assinatura. Sem verificador conectado, o retorno é `unavailable` sem itens exibidos. A base atual não inventa cursos e não faz chamadas externas.

## Privacidade, transparência e confiança

1. **Contextual por perfil escolhido**, não por histórico de conversas, prompt, documento, contatos, preço de clientes, registro de Memory, credencial ou comportamento entre Spaces. O contrato atual tem somente perfil/versão, país e idioma como filtros.
2. Patrocínio desabilitado por padrão no componente de projeção. Introduzir futuramente uma **preferência explícita e revogável** no owner canônico de preferências antes de habilitar uma UI.
3. Se autorizado, conteúdos patrocinados devem ocupar área **separada** do conteúdo editorial, com rótulo visível "Patrocinado", identificação do anunciante, URL destino identificável e controle para ocultar. Nada de anúncios camuflados em receitas ou conselhos da IA.
4. Não compartilhar Memory, conteúdo de conversas, arquivos, interesses inferidos ou IDs persistentes com anunciantes. Sem pixel de rastreamento, fingerprint, leilão de dados de Space ou métricas por pessoa no MVP. O contrato inicial exige URLs HTTPS canônicas sem parâmetros de consulta nem fragmentos, para bloquear identificadores de rastreamento em links; redirecionamentos externos futuros exigem auditoria adicional. Métricas agregadas e privadas requerem projeto separado e avaliação jurídica/privacidade.
5. Selecionar outro Space não significa conceder permissão publicitária. Preferências comerciais não substituem autenticação; nenhuma action/policy é ampliada.
6. Em perfis sensíveis ou regulados, aplicar gate adicional de publicação. Conteúdo patrocinado nunca pode elevar recomendações médicas/jurídicas/financeiras, ocultar fontes nem transformar conteúdo pago em aconselhamento.
7. Divulgação de parceiros deve passar por revisão editorial, regras de publicidade aplicáveis (inclusive publicidade identificável), consentimento quando necessário, política de conteúdo, denúncia, expiração e revogação.
8. Sem dependência de Internet para iniciar o OrdaX, executar IA local ou abrir Spaces; se o catálogo não estiver disponível, só a seção de descoberta fica indisponível.

## Atualizações sem duplicação

Editor aprova uma revisão de catálogo assinada → publicação versionada → cliente verifica integridade e autoria → projeta itens adequados ao Profile Pack ativo → separa organic/sponsored → Surface exibe cartões com controles. O conteúdo do perfil e a Memory continuam independentes da revisão de anúncios.

Trocar o Profile Pack de `pizzaria-br@1` para outra versão reavalia elegibilidade sem transferir qualquer dado do Space ao publisher. Expiração/revogação remove a divulgação sem desinstalar Profile ou apagar memória. Este caminho **não ativa** automaticamente apps ou Knowledge Packs e não injeta publicidade na IA.

## Próximos gates necessários

- Publicador/editor verificado (trust root, assinaturas, revisão, revogação e política de URLs), owner e endpoint próprios; usar infraestrutura de trust, não store paralelo.
- Preferência real `mostrar conteúdos patrocinados` (desabilitada inicialmente) e UI separada com aviso, rótulo, anunciante, proveniência e opção de esconder.
- Moderação, denúncias, requisitos de publicidade e privacidade, país/idade quando aplicável, e pagamentos/contabilidade se houver modelo comercial.
- Testes de troca de Profile, catálogo vencido, ads opt-out, publicação falsa, URLs maliciosas, injeção de prompt e não correlação com Memory/conta.
- Somente após esses gates promover o recurso. A fundação atual fornece contratos/testes, **não** uma rede publicitária operacional.
