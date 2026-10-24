# OrdaX — legal e Conta: desenvolvimento separado da publicação

Estado observado em 2026-10-10. Este documento descreve a operação, sem
substituir os owners em `docs/contracts/public-legal-readiness.json`,
`docs/contracts/public-identity.json`, `MVP.md` e os controles do servidor.

## Regra principal

**A revisão jurídica não é um bloqueio do desenvolvimento do OrdaX OS.**
O código do sistema, boot USB, instalador Native, Studio, apps, Inteligência,
Web, testes e builds podem avançar na `main` sem qualquer comprovação jurídica
externa. Um problema no site publicado não invalida uma compilação local.

Há três fronteiras distintas:

1. **Desenvolvimento e integração:** testes determinísticos de fonte, schemas,
   contratos e APIs simuladas, sem exigir disponibilidade do Supabase nem
   igualdade entre os hashes jurídicos do site atual e uma política anterior.
   O CI de candidato do site deve validar os arquivos que vai construir, mas
   nunca exigir aprovação jurídica para compilar ou entregar um preview.
2. **Autenticação experimental:** `auth-only` usa o mesmo gateway e modelo de
   sessão do produto, com login/cadastro limitados. Para apresentar *aceite
   público real*, o frontend exige política ativa do servidor, URLs seguras
   e verificação dos documentos servidos. Se houver inconsistência, **apenas
   novas inscrições públicas** permanecem desabilitadas, não login, boot,
   testes, desenvolvimento ou demais aplicativos. Não criar provedor paralelo
   ou aceitar versões jurídicas inventadas pelo cliente.
3. **Homologação pública:** a verificação jurídica real, assinaturas/release e
   requisitos de segurança são gates exclusivos da capacidade/canal anunciado.
   Em caso de falha, o diagnóstico permanece visível, mas só aquela
   publicação/funcionalidade deixa de ser aprovada.

O USB pode iniciar e funcionar sem conta; **a falta de homologação da Conta
online não bloqueia desenvolvimento nem testes locais de boot USB**. O escopo
funcional de cadastro/login E2E continua em `MVP.md`, sem ser falsamente
marcado como concluído.

## Estado técnico atual

- `https://ordax.com.br` publica a UI com login e cadastro em modo
  `auth-only`; `account_activation_ready=false` mantém recursos completos,
  recuperação pública e sincronização fechados.
- O destino Supabase canônico `ordax-platform` tinha uma política ativa
  `2026.10.09` e **dois usuários e dois recibos agregados** no momento da
  inspeção. A declaração de que não há usuários de produção comercial é
  compatível com haver contas técnicas/de teste; não atribuir titularidade
  sem evidência.
- Os digests SHA-256 nessa política **não correspondem** ao HTML entregue
  atualmente em `/privacidade/` e `/termos/`. A evidência objetiva consta de
  `docs/evidence/public-legal-integrity-2026-10-10.md`.
- Essa divergência não impede o build independente de Dev (`ordax-site/scripts/build.py check`); `auth_activation_preflight.py check` indica
  `AUTH_ONLY_SOURCE_CANDIDATE`. A avaliação de publicação jurídica
  continua a falhar, corretamente.
- A origem do descompasso arquitetural é associar digests imutáveis de
  consentimento aos **bytes completos de páginas HTML passíveis de
  redesenho**. Para publicações jurídicas futuras, preservar um snapshot
  canônico da versão aprovada independentemente do layout em evolução; não
  reescrever hashes de políticas já aceitas nem duplicar o owner de Conta.

## Fluxos e verificações oficiais

**Build/preview durante o desenvolvimento:**
```bash
\# Execute no checkout ordax-site para validar a apresentação:
python3 scripts/build.py check
\# Execute separadamente no checkout ordax-os para validar os gates do OS:
python3 tools/public-site/auth_activation_preflight.py check
```

**Comprovação independente da produção, quando for homologar a Conta:**
```bash
python tools/public-site/probe_public_network.py --legal-consistency
python tools/public-site/prove_deployment.py --origin https://ordax.com.br
python tools/public-site/auth_activation_preflight.py require-ready
```

- `.github/workflows/public-site-candidate.yml`: testa fonte e gera preview
  determinístico; **não** depende de aprovação da política legal em produção.
- `.github/workflows/public-legal-integrity.yml`: testa invariantes em
  alterações do código; em execução agendada ou manual faz prova HTTP real,
  estrita, sinalizando divergências. A falha remota não veta pushes na
  `main` nem impede trabalho nos demais módulos.
- `.github/workflows/public-legal-policy-activation.yml`: **único**
  procedimento de ativação de uma versão efetivamente aprovada, quando houver
  necessidade de publicar novas inscrições públicas. Não é um passo de
  instalação de dependências nem requisito para rodar o OrdaX OS offline.

## Correção definitiva antes de liberar novos aceites públicos

Publicar uma nova versão jurídica imutável pelo owner e vincular sua política
aos exatos documentos daquela versão, preservando o histórico. É inadequado
corrigir divergências por atualizações diretas dos hashes em registros já
referenciados por aceites. O frontend pode ser redesenhado enquanto isso sem
paralisar o sistema. Antes de anunciar cadastro liberado, testar aceitação,
confirmação por e-mail, sessão, logout, revogação e recuperação contra o
servidor real.

**Não há razão técnica para apagar os dois usuários ou recibos existentes a
fim de continuar programando o OS.** Qualquer limpeza intencional de ambiente
de testes deve ser uma operação separada, precisamente escopada, e nunca uma
consequência automática do build.

## Arquitetura de snapshots de consentimento (11/10/2026)

**Separação que evita a causa da divergência:** as rotas
`/privacidade/` e `/termos/` continuam páginas de apresentação que podem
receber melhorias visuais. Elas não devem ser usadas como novo documento de
aceite após a política histórica `2026.10.09`. Para uma nova versão
aprovada, a identidade da política aponta para:

```text
/legal/<versao>/privacidade/
/legal/<versao>/termos/
```

Cada página acima é **uma publicação imutável de bytes HTML**. Ela é servida
na mesma origem HTTPS. A versão na URL, a versão do documento retornada pelo
servidor e a versão registrada pela política devem coincidir exatamente.
O cliente, o verificador público e a ativação compartilham esse protocolo;
uma URL dinâmica ou de outra origem é recusada. O construtor do site **não
injeta folhas de estilo nem altera links/cache busting** nessas cópias.

A revisão de cada par de snapshots entra no livro de hashes
`docs/contracts/public-legal-snapshots.json`, conferido por
`tools/public-site/legal_snapshots.py`. Ele define version/kind, tamanho e
SHA-256 dos bytes do arquivo publicado. O build falha se arquivos forem
mudados, removidos, acrescidos sem aprovação, renomeados ou se o hash divergir.
O owner da política **ativa** e dos recibos permanece na Platform/Supabase;
este livro é só a identidade dos arquivos estáticos arquivados.

Procedimento de lançamento de **nova** versão jurídica:

1. Revisar e aprovar o conteúdo legal final de ambos os documentos, incluindo
   versão e data efetiva. Criar um par novo em
   `sites/public/legal/<versao>/privacidade/index.html` e
   `sites/public/legal/<versao>/termos/index.html`, sem alterar versões já
   aprovadas. Registrar SHA-256/tamanho exatos no livro versionado.
2. Ajustar `docs/contracts/public-legal-readiness.json` para os novos
   caminhos, versão, data e estado revisado pelo responsável. Executar
   `python3 scripts/build.py check` no checkout Site e o CI jurídico do OS.
3. Publicar os snapshots no site HTTPS antes de ativar a política, verificar
   os bytes efetivamente servidos e executar o ativador canônico separado.
   O ativador recusa arquivos não fixados no livro ou URLs divergentes.
4. Com a política oficial do servidor atualizada, testar cadastro, aceite
   registrado, login/logout, revogação e recuperação, e executar novamente
   `python tools/public-site/probe_public_network.py --legal-consistency`.

**Estado atual:** o livro está vazio porque nenhuma nova versão foi aprovada/
publicada nesta alteração. A política histórica `2026.10.09` e seus recibos
foram preservados, inclusive a divergência live já detectada. Nenhum novo
aceite foi ativado e nenhum teste de cadastro real foi declarado aprovado.
Este trabalho corrige o mecanismo para a próxima publicação jurídica, sem
mascarar a falha que já existe em produção nem bloquear boot offline.

