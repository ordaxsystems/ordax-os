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
- Isso não bloqueia builds: `python tools/public-site/build.py check`
  passa e `auth_activation_preflight.py check` indica
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
python tools/public-site/build.py check
python tools/public-site/auth_activation_preflight.py check
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
