# Política de Privacidade OrdaX — MINUTA PARA REVISÃO

**NÃO VIGENTE · NÃO APROVADA · NÃO PUBLICAR COMO POLÍTICA FINAL**

Esta minuta é uma base para avaliação jurídica e de produto, não comprovação
de adequação à LGPD. A fonte pública em `/privacidade/` permanece página de
preparação até aprovação documentada e publicação versionada.

## 1. Identificação do responsável

Controlador/responsável pelo tratamento: **[PENDENTE: razão social ou
identificação jurídica efetiva]**.

CNPJ (quando aplicável): **[PENDENTE]**.

Endereço ou canal institucional: **[PENDENTE]**.

Contato específico para privacidade e direitos dos titulares:
**[PENDENTE: canal funcional e testado]**.

Encarregado, se aplicável, ou canal equivalente: **[PENDENTE: definição]**.

Não substituir esses dados pelo proprietário do repositório ou por um nome de
domínio sem comprovação de que é a entidade controladora.

## 2. Âmbito

A Conta OrdaX é **opcional** para o uso local do produto, conforme contrato
`docs/contracts/account-lifecycle.json`. Esta minuta abrange o cadastro e
acesso pelo portal `ordax.com.br`, recuperação de acesso, sessões e recursos
associados à Conta; não afirma que todos os módulos do sistema operacional
utilizam os mesmos dados, nem que a sincronização esteja liberada.

## 3. Dados tratados e finalidades previstas

| Categoria | Finalidade prevista | Fonte de verificação |
| --- | --- | --- |
| E-mail e credenciais de autenticação | Cadastro, confirmação de e-mail, autenticação e recuperação | Gateway de Conta e Supabase Auth |
| Identificador da conta, tokens e cookies seguros | Sessões e proteção de acesso | Gateway e contrato de ciclo da conta |
| Versões e aceite de documentos de cadastro | Provar a aceitação inequívoca e associá-la à política vigente | Trigger e recibo legal imutável no PostgreSQL |
| Metadados de espaço, preferências e sincronização **quando habilitados** | Continuidade entre dispositivos/instâncias autorizadas | Contrato de ciclo da conta |
| Endereço IP e indicadores mínimos de segurança | Proteção contra abuso, limites de tentativa e investigação de incidentes | Gateways e rate limit |

**PENDENTE:** mapear todos os campos efetivamente persistidos, responsáveis
pelos logs, bases legais específicas para cada finalidade, coleta de dados de
menores, eventual coleta futura por apps, ads e outros módulos; não afirmar
essas finalidades como presentes em produção sem prova.

## 4. Fundamentos legais

A equipe responsável e a revisão jurídica deverão atribuir a cada operação
a hipótese legal específica prevista na LGPD — por exemplo, execução de
contrato, obrigação legal/regulatória, legítimo interesse com avaliação
documentada ou consentimento quando aplicável. **O clique em “aceito os
termos” não constitui, por si só, consentimento genérico para todo
tratamento de dados.** O sistema deverá preservar meios de exercer direitos
inclusive quando a hipótese legal não for consentimento.

## 5. Prestadores de serviços e transferência internacional

A arquitetura atualmente utiliza Supabase para identidade/banco, Vercel
para o portal e Cloudflare Turnstile na proteção contra abuso. **PENDENTE:**
confirmar entidade contratada, regiões reais de processamento e backup,
subprocessadores, transferências internacionais, mecanismos de proteção e
links às políticas/documentos contratuais dos provedores. Não afirmar
localização exclusivamente no Brasil apenas pela região `sa-east-1` do banco.

## 6. Cookies e sessão

O backend prevê cookies HTTP-only, Secure, SameSite=Lax para acesso e
recuperação. Cookies de infraestrutura dos intermediários não equivalem a
cookies de autenticação OrdaX. **PENDENTE:** catálogo completo de cookies,
finalidades, prazo, terceiros e política de cookies não essenciais quando
houver. Não tratar cookies necessários à segurança como publicidade.

## 7. Retenção e exclusão

A Conta prevê exportação e encerramento sujeitos a autenticação adequada,
mas os recursos públicos estão desativados até homologação. **PENDENTE:**
prazos de retenção de registros de cadastro, logs, backups, comprovantes
legais imutáveis, sincronização e solicitações de titulares, bem como
exceções justificadas por obrigação legal ou defesa de direitos.

## 8. Direitos dos titulares

Após definir e testar os canais oficiais, explicar como solicitar
confirmação de tratamento, acesso, correção, anonimização/bloqueio/exclusão
quando aplicável, portabilidade, informação sobre compartilhamentos e
revisão/oposição conforme hipótese legal. **PENDENTE:** procedimento de
verificação de identidade, prazo aplicável, contato de atendimento e
encaminhamento de reclamações.

## 9. Segurança e incidentes

Há controles planejados/implementados de RLS, separação de credenciais,
proteção de sessão, rate limit e validação de origem. Não prometer ausência
de incidentes nem afirmar recursos ainda não homologados. **PENDENTE:**
fluxo de comunicação de incidentes, responsáveis, contatos e documentação
de respostas.

## 10. Alterações e vigência

Versão aprovada: **[PENDENTE]**. Data de vigência: **[PENDENTE]**.
Toda alteração material exige revisão, publicação versionada, registro de
hash SHA-256 dos bytes publicados e atualização do contrato canônico.
O aceite registrado deve se referir à versão vigente comprovada no servidor.

---

**Aprovação necessária:** responsável jurídico e de privacidade,
representante do produto, identificação do controlador e validação de
tratamentos reais. Até lá, esta minuta não produz autorização de cadastro.
