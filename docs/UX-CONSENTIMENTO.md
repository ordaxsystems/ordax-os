# OrdaX — consentimento e permissões sem repetição

Fonte de verdade de experiência: `docs/contracts/user-consent-experience.json`.  
Este documento especifica **quem pede o quê**, não altera por si só os direitos do Windows, do servidor de contas ou dos provedores de OAuth.

## Regra de produto

Uma decisão humana só pode ser solicitada quando tem significado próprio para o usuário. Assinatura, identidade da mídia, geometria, readback, estado do serviço, provas do release e verificações internas são automáticas. Nenhuma delas constitui um segundo aceite de termos.

### Creator (Windows, pendrive)

Fluxo normal: abrir o Creator → selecionar USB removível → **Criar OrdaX** → **um único aviso de apagamento** com nome/serial/número e capacidade do dispositivo, com opção negativa padrão → gravação → readback → resultado.

- A tela anterior apenas permite conferir o destino: ela não é outro pedido de aceite nem repete o diálogo.
- A confirmação destrutiva é específica do dispositivo escolhido e vale para **essa tentativa**; a troca ou reenumeração do alvo invalida seu token interno.
- O Windows controla a elevação administrativa. Se o processo não tiver token suficiente, o Windows pode solicitar UAC, como também ocorre com outras ferramentas que formatam USB. **UAC não é aceite OrdaX; não é lícito suprimi-lo por artifícios de bypass**.
- O Creator nunca pede frase de operador, hash, chave privada, login para gravar, nem termo legal só por criar o USB. Os gates físicos e a assinatura da release ficam internos.
- Os discos internos permanecem excluídos e a conclusão depende de readback real.

### Conta OrdaX

O aceite ocorre **na criação da conta**, com a versão e a integridade dos Termos de Uso e com ciência da Política de Privacidade. O servidor valida os documentos oficiais e grava um comprovante de cadastro. Iniciar sessão no site, no OS ou no plugin reutiliza a identidade e o comprovante aplicável, sem novo checkbox dos mesmos documentos.

- O navegador e o OOBE possuem o checkbox de cadastro; nenhuma interface deve simular aceite.
- O cadastro depende de política legal vigente publicada pelo serviço, nunca de texto provisório nem de apenas uma flag enviada pelo cliente.
- Mudanças materiais de termos podem exigir uma nova concordância quando aplicável; isso deve ser vinculado à **nova versão**, e não disparado a cada login.
- As finalidades de tratamento de dados pessoais e as respectivas bases legais devem ser descritas separadamente de termos contratuais; o aceite do contrato não é consentimento genérico e ilimitado para tratamento de dados.

### Primeiro uso / instalação do OrdaX OS

A intenção é apresentar os **termos próprios do sistema** uma única vez na conclusão da primeira instalação/configuração local, **mesmo para quem usa o OS sem conta**. Eles devem estar disponíveis offline, ter versão e digest fixados e gerar um comprovante local durável. Reabertura do OS ou conexão do plugin não repete o diálogo.

**Limite atual:** o OOBE possui a página informativa de privacidade, mas **não possui ainda o documento de instalação separado nem o comprovante versionado**. Os termos publicados em `/termos/` tratam principalmente da **Conta OrdaX**; não devemos rebatizá-los como uma licença de instalação. A criação do documento próprio, a revisão jurídica e a ligação à persistência canônica do primeiro uso são necessárias antes de declarar esse aceite implementado. Não bloquear o modo USB offline com um contrato inexistente ou inventar prova de aceite.

### Plugin / apps

O plugin autentica pela **Conta OrdaX existente**. Quem já está autenticado e tem comprovante válido não aceita termos gerais novamente; quem não possui conta segue para cadastro e faz o aceite ali.

Permissões para ler dados, controlar computadores, agir em apps ou conceder escopos OAuth **não são termos de uso** e continuam exigindo as autorizações específicas que seus respectivos serviços necessitam. Login não equivale a acesso irrestrito ao dispositivo. Os contratos e confirmações particulares ao recurso pertencem ao owner do app/gateway, não a uma nova política paralela de identidade.

## Separação da cerimônia física do primeiro MVP

A autorização de operador em `tools/creator/authorize_physical_write.py` vincula uma release controlada, o código do gravador e o contexto exato da prova física. Ela **não é outro aceite na interface do Creator**. Continua necessária ao teste inicial governado enquanto esse canal estiver fechado, independentemente da quantidade de telas do produto. A confirmação destrutiva específica do USB e a elevação do Windows são etapas posteriores, com propósitos diferentes.

## Definição de pronto

- **Em fonte:** confirmação única e textos do Creator; cadastro com política de identidade server-authoritative e comprovante real; SSOT declarativo que separa os quatro fluxos.
- **Ainda necessário:** documento offline e comprovante local próprio do aceite da instalação; validar login/escopos no plugin conectado; revisão e homologação do Creator no Windows físico.
- **Não comprovado por esta regra:** autorização física registrada, escrita no Lidermix, readback físico, boot ou assinatura Authenticode pública.

Referências externas de comportamento do Windows: documentação Microsoft de UAC/elevação administrativa e FAQ oficial do Rufus sobre privilégios para escrita de mídias removíveis.
