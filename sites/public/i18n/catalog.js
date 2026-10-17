(() => {
  "use strict";

  const SOURCE_LOCALE = "pt-BR";
  const SUPPORTED_LOCALES = Object.freeze(["pt-BR", "en-US"]);

  const STATIC_PAIRS = [
    ["Acessar OrdaX Web", "Open OrdaX Web"],
    ["OrdaX Web", "OrdaX Web"],
    ["OrdaX OS", "OrdaX OS"],
    ["Espaço pessoal OrdaX", "OrdaX personal space"],
    ["/ não disponível", "/ unavailable"],
    ["ESPAÇO PESSOAL", "PERSONAL SPACE"],
    ["Buscar na minha conta", "Search my account"],
    ["Todos os seus mundos.", "All your worlds."],
    ["O seu universo começa aqui.", "Your universe begins here."],
    ["Sua conta OrdaX", "Your OrdaX account"],
    ["Pessoal", "Personal"],
    ["Mais possibilidades.", "More possibilities."],
    ["Um só lugar.", "One place."],
    ["Seu plano e seus benefícios ficam disponíveis aqui.", "Your plan and benefits will appear here."],
    ["Ver assinatura", "View subscription"],
    ["Seus recursos, na medida do seu universo.", "Your resources, tailored to your universe."],
    ["Aguardando dados de consumo", "Awaiting usage data"],
    ["Nenhuma informação de cobrança conectada.", "No billing information connected."],
    ["Uma visão dos seus recursos ao longo do tempo.", "A view of your resources over time."],
    ["Inteligência artificial", "Artificial intelligence"],
    ["Explorar consumo", "Explore usage"],
    ["Gerenciar segurança", "Manage security"],
    ["Seu acesso. Seu controle.", "Your access. Your control."],
    ["Mantenha sua identidade protegida em todos os seus dispositivos.", "Keep your identity protected across all your devices."],
    ["Verificação em duas etapas", "Two-step verification"],
    ["Sessões e dispositivos", "Sessions and devices"],
    ["Ctrl K", "Ctrl K"],
    ["A edição de nome, foto e outros dados exige o serviço oficial de perfil, ainda não disponível nesta página.", "Editing your name, photo, and other details requires the official profile service, which is not yet available on this page."],
    ["Recolher navegação", "Collapse navigation"],
    ["Expandir navegação", "Expand navigation"],
    ["Localização na conta", "Account location"],
    ["Informação da sessão autenticada", "Verified session information"],
    ["Informações disponíveis da conta", "Available account information"],
    ["Identidade", "Identity"],
    ["Conta OrdaX", "OrdaX Account"],
    ["Plano atual", "Current plan"],
    ["Não confirmado", "Not confirmed"],
    ["Não verificados", "Not verified"],
    ["Seu universo em resumo", "Your universe at a glance"],
    ["Visão geral da conta", "Account overview"],
    ["SEU UNIVERSO, CONECTADO", "YOUR UNIVERSE, CONNECTED"],
    ["Sua identidade, assinatura e recursos. Tudo em um só lugar.", "Your identity, subscription and resources. All in one place."],
    ["Sua identidade e seus recursos.", "Your identity and resources."],
    ["UMA CONTA. TODOS OS SEUS MUNDOS.", "ONE ACCOUNT. ALL YOUR WORLDS."],
    ["Atividade de consumo: dados não disponíveis", "Usage activity: data unavailable"],
    ["Atividade de consumo", "Usage activity"],
    ["Este mês", "This month"],
    ["Seu consumo aparecerá aqui", "Your usage will appear here"],
    ["Nenhuma medição confirmada", "No confirmed measurements"],
    ["Gerencie sua conta", "Manage your account"],
    ["Seu perfil, suas conexões e suas preferências.", "Your profile, connections, and preferences."],
    ["Fechar menu", "Close menu"],
    ["Buscar dados, assinatura, consumo...", "Search data, subscription, usage..."],
    ["CENTRAL DE CONTA", "ACCOUNT CENTER"],
    ["Sua conta. Seu espaço.", "Your account. Your space."],
    ["Uma identidade para acessar e gerenciar seus serviços OrdaX.", "One identity to access and manage your OrdaX services."],
    ["Ver dados pessoais", "View personal details"],
    ["ASSINATURA ORDAX", "ORDAX SUBSCRIPTION"],
    ["Uma experiência que evolui com você.", "An experience that evolves with you."],
    ["Assinaturas pagas em preparação", "Paid subscriptions in preparation"],
    ["Conheça as opções de assinatura disponíveis no catálogo.", "Discover the subscription options in the catalog."],
    ["FATURAMENTO DA CONTA", "ACCOUNT BILLING"],
    ["Sem cobrança confirmada", "No confirmed charges"],
    ["Pagamentos e faturas aparecerão quando o serviço estiver disponível.", "Payments and invoices will appear when the service is available."],
    ["IA, armazenamento e serviços em um só lugar.", "AI, storage, and services in one place."],
    ["Dados pessoais e informações da conta", "Personal information and account details"],
    ["Proteção, senha e sessões autorizadas", "Protection, password and authorized sessions"],
    ["Vínculos e sessões da identidade", "Identity device links and sessions"],
    ["Controle das informações da conta", "Control over your account information"],
    ["Conexões e autorizações", "Connections and authorizations"],
    ["Idioma e comunicações", "Language and communications"],
    ["Avisos e eventos confirmados", "Confirmed notices and events"],
    ["Uso e sincronização de dados", "Data usage and synchronization"],
    ["Informações e orientações", "Information and guidance"],
    ["Meu perfil", "My profile"],
    ["Meus dispositivos", "My devices"],
    ["Minha Conta OrdaX: dados pessoais, assinatura, consumo, pagamentos, segurança e privacidade.", "My OrdaX Account: personal details, subscriptions, usage, payments, security and privacy."],
    ["Minha Conta", "My Account"],
    ["CONTA ORDA X / IDENTIDADE", "ORDA X ACCOUNT / IDENTITY"],
    ["Seu espaço começa pela sua identidade.", "Your space starts with your identity."],
    ["Consulte sua Conta OrdaX com sessão verificada pelo servidor. A página pública e o OrdaX Web permanecem experiências separadas.", "Access your OrdaX Account with a server-verified session. The public website and OrdaX Web remain separate experiences."],
    ["Minha Conta OrdaX", "My OrdaX Account"],
    ["Verificando sua sessão", "Verifying your session"],
    ["Consultando o serviço oficial de identidade.", "Checking the official identity service."],
    ["Sessão autenticada", "Authenticated session"],
    ["SESSÃO AUTENTICADA", "AUTHENTICATED SESSION"],
    ["E-mail da conta", "Account email"],
    ["Sua sessão é validada no servidor. Senhas e tokens não são apresentados nesta página.", "Your session is verified on the server. Passwords and tokens are never displayed on this page."],
    ["Encerrar sessão", "Sign out"],
    ["Sair da conta", "Sign out of account"],
    ["Opções da conta", "Account options"],
    ["Sua sessão não está ativa. Entre para acessar os dados da sua conta.", "Your session is not active. Sign in to access your account details."],
    ["Entrar na Conta OrdaX", "Sign in to your OrdaX Account"],
    ["Não foi possível verificar sua sessão. Nenhum dado pessoal será exibido até a conexão ser restabelecida.", "We could not verify your session. No personal data will be shown until the connection is restored."],
    ["Tentar novamente", "Try again"],
    ["Outros recursos em desenvolvimento", "More features in development"],
    ["OrdaX Web, dispositivos, sincronização, backup e continuidade não são ativados por este portal de identidade.", "OrdaX Web, devices, synchronization, backup, and continuity are not enabled by this identity portal."],
    ["Voltar ao site da OrdaX", "Return to the OrdaX website"],
    ["E-mail confirmado. Entre na sua Conta OrdaX para continuar.", "Email confirmed. Sign in to your OrdaX Account to continue."],
    ["O link de confirmação expirou ou já foi usado. Entre normalmente se seu e-mail já estiver confirmado.", "This confirmation link has expired or was already used. Sign in normally if your email is already confirmed."],
    ["Não foi possível verificar o e-mail agora. Tente novamente mais tarde.", "We could not verify your email right now. Please try again later."],
    ["A verificação de segurança não foi concluída. Refaça a verificação e tente entrar novamente.", "Security verification was not completed. Repeat the check and try signing in again."],
    ["A verificação de segurança está temporariamente indisponível. Tente novamente mais tarde.", "Security verification is temporarily unavailable. Please try again later."],
    ["A verificação de segurança não foi concluída. Refaça a verificação antes de criar sua conta.", "Security verification was not completed. Repeat the check before creating your account."],
    ["A verificação de segurança falhou. Tente novamente.", "Security verification failed. Please try again."],
    ["Entre na sua Conta OrdaX com autenticação segura.", "Sign in to your OrdaX Account securely."],
    ["Entre com sua identidade OrdaX. A segurança da sessão é validada pelo serviço oficial; novos recursos serão disponibilizados gradualmente.", "Sign in with your OrdaX identity. Session security is verified by the official service; more features will become available gradually."],
    ["Privacidade e controle", "Privacy and control"],
    ["Informe seu e-mail e senha para continuar. A disponibilidade do serviço é verificada automaticamente.", "Enter your email and password to continue. Service availability is verified automatically."],
    ["Verificando conexão segura", "Checking secure connection"],
    ["Consultando o serviço de identidade OrdaX.", "Contacting the OrdaX identity service."],
    ["Conclua a verificação de segurança para habilitar o botão.", "Complete the security check to enable the button."],
    ["Crie sua Conta OrdaX.", "Create your OrdaX Account."],
    ["Crie sua Conta OrdaX com segurança.", "Create your OrdaX Account securely."],
    ["Comece com seu e-mail e uma senha segura. Leia os documentos vigentes antes de criar a conta.", "Start with your email and a secure password. Read the current documents before creating your account."],
    ["Consultando o serviço de identidade e a política de cadastro.", "Checking the identity service and registration policy."],
    ["Seu espaço.", "Your space."],
    ["Sua identidade.", "Your identity."],
    ["Sua Conta OrdaX reúne identidade e continuidade em um só lugar. O estado do acesso é verificado nesta página antes de liberar qualquer formulário.", "Your OrdaX Account brings identity and continuity into one place. Access status is checked on this page before any form is enabled."],
    ["Recursos planejados para a Conta OrdaX", "Features planned for the OrdaX Account"],
    ["01 / ACESSO", "01 / ACCESS"],
    ["Uma identidade para seus projetos", "One identity for your projects"],
    ["02 / SEGURANÇA", "02 / SECURITY"],
    ["Sessão protegida pelo servidor", "Server-protected session"],
    ["03 / CONTROLE", "03 / CONTROL"],
    ["Recuperação e privacidade", "Recovery and privacy"],
    ["Atalhos para sua conta", "Account shortcuts"],
    ["Recuperar acesso", "Recover access"],
    ["A disponibilidade é confirmada pelo serviço real antes que você possa informar e-mail e senha.", "Availability is confirmed by the real service before you can enter your email and password."],
    ["Uma conta.", "One account."],
    ["Novas possibilidades.", "New possibilities."],
    ["Seu acesso começa com um cadastro verificável: documentos vigentes, proteção contra abuso e uma sessão real. Sem contas simuladas.", "Your access begins with verifiable registration: current documents, abuse protection, and a real session. No simulated accounts."],
    ["Proteções necessárias para criar uma conta", "Protection required to create an account"],
    ["01 / IDENTIDADE", "01 / IDENTITY"],
    ["E-mail e senha protegidos", "Protected email and password"],
    ["02 / CONFIANÇA", "02 / TRUST"],
    ["Documentos vigentes e aceite informado", "Current documents and informed consent"],
    ["03 / SEGURANÇA", "03 / SECURITY"],
    ["Verificação contra abuso", "Abuse-prevention verification"],
    ["Já tenho uma conta", "I already have an account"],
    ["Os campos aparecem somente após a confirmação da identidade, da segurança e das políticas de cadastro.", "The fields appear only after identity, security, and registration policies have been verified."],
    ["Ir para o conteúdo", "Skip to content"],
    ["OrdaX — início", "OrdaX — home"],
    ["Navegação principal", "Primary navigation"],
    ["Rodapé", "Footer"],
    ["Início", "Home"],
    ["Experiência", "Experience"],
    ["Sistema", "System"],
    ["Dispositivos", "Devices"],
    ["Intelligence", "Intelligence"],
    ["Entrar", "Sign in"],
    ["Download", "Download"],
    ["Criar conta", "Create account"],
    ["Licenças", "Licenses"],
    ["Privacidade", "Privacy"],
    ["Termos", "Terms"],
    ["Conheça o OrdaX", "Discover OrdaX"],
    ["Conhecer o USB", "Learn about USB"],
    ["OrdaX — ideias organizam realidades", "OrdaX — ideas organize realities"],
    ["OrdaX — um sistema pensado para manter arquivos, apps, atualizações e recuperação em uma experiência simples.", "OrdaX — a system designed to keep files, apps, updates, and recovery in one simple experience."],
    ["ORDA X · EM DESENVOLVIMENTO", "ORDA X · IN DEVELOPMENT"],
    ["Seu trabalho.", "Your work."],
    ["Em outra dimensão.", "In another dimension."],
    ["Projetos, contexto e inteligência. Um espaço para pensar além.", "Projects, context, and intelligence. A space to think beyond."],
    ["Explorar a experiência", "Explore the experience"],
    ["Conhecer o OrdaX OS — USB", "Discover OrdaX OS — USB"],
    ["Demonstração com dados de exemplo. Sem instalar.", "Demo with sample data. No installation required."],
    ["UM OLHAR PARA O ORDA X", "A LOOK AT ORDA X"],
    ["Não é só para olhar.", "It is not just for looking."],
    ["Explore.", "Explore."],
    ["Do contexto à decisão. Explore um projeto com Intelligence.", "From context to decision. Explore a project with Intelligence."],
    ["Área de trabalho", "Workspace"],
    ["01 · Projetos", "01 · Projects"],
    ["02 · Intelligence", "02 · Intelligence"],
    ["03 · Contexto", "03 · Context"],
    ["01 / NOTEBOOK", "01 / NOTEBOOK"],
    ["02 / MOBILE", "02 / MOBILE"],
    ["Conceito · Em breve", "Concept · Coming soon"],
    ["Explore o projeto Aurora e prepare uma análise de exemplo.", "Explore the Aurora project and prepare a sample analysis."],
    ["Ampliar notebook", "Expand notebook"],
    ["↻ Recomeçar", "↻ Restart"],
    ["Demonstração conceitual com dados fictícios e respostas de IA predefinidas; não executa inferência. Sincronização simulada nesta prévia. Mobile está em desenvolvimento.", "Concept demo with fictional data and predefined AI responses; no inference is executed. Synchronization is simulated in this preview. Mobile is in development."],
    ["Explore a área de trabalho", "Explore the workspace"],
    ["Em telas pequenas, deslize na horizontal para explorar o notebook.", "On small screens, swipe horizontally to explore the notebook."],
    ["Fechar ×", "Close ×"],
    ["Ative JavaScript para explorar a demonstração.", "Enable JavaScript to explore the demo."],
    ["Conheça o caminho USB do MVP.", "Learn about the MVP USB path."],
    ["ESPAÇO PARA O QUE IMPORTA", "SPACE FOR WHAT MATTERS"],
    ["Menos dispersão.", "Less distraction."],
    ["Mais intenção.", "More intention."],
    ["Um ambiente para organizar o trabalho, desenvolver ideias e encontrar o próximo passo.", "An environment to organize work, develop ideas, and find the next step."],
    ["01 / ORGANIZAR", "01 / ORGANIZE"],
    ["Projetos com contexto.", "Projects with context."],
    ["Objetivos, referências e próximos passos reunidos. Explore essa visão no projeto de exemplo.", "Goals, references, and next steps together. Explore this view in the sample project."],
    ["Arquivos", "Files"],
    ["Notas", "Notes"],
    ["02 / EXPLORAR", "02 / EXPLORE"],
    ["Inteligência perto do trabalho.", "Intelligence close to the work."],
    ["Ordax Intelligence é parte do MVP USB, com inferência local. Aqui você explora uma simulação consultiva, sem executar modelos.", "OrdaX Intelligence is part of the USB MVP with local inference. Here you explore a consultative simulation without running models."],
    ["Internet", "Internet"],
    ["Ajustes", "Settings"],
    ["03 / CONTINUAR", "03 / CONTINUE"],
    ["Uma base para seguir em frente.", "A foundation to keep moving forward."],
    ["Atualizações oficiais e recuperação fazem parte do caminho do MVP. A validação física está em andamento.", "Official updates and recovery are part of the MVP path. Physical validation is in progress."],
    ["Recuperação", "Recovery"],
    ["COMEÇA PELO USB", "IT STARTS WITH USB"],
    ["Seu computador.", "Your computer."],
    ["Uma nova perspectiva.", "A new perspective."],
    ["O primeiro OrdaX Stable/MVP é pensado para rodar diretamente pelo pendrive. O OrdaX Creator prepara o USB, e você inicia o sistema por ele.", "The first OrdaX Stable/MVP is designed to run directly from a USB drive. OrdaX Creator prepares the USB, and you boot the system from it."],
    ["Conhecer a preparação do USB", "Learn how to prepare the USB"],
    ["Downloads públicos aparecem somente quando uma release autorizada estiver disponível.", "Public downloads appear only when an authorized release is available."],
    ["OrdaX OS — USB", "OrdaX OS — USB"],
    ["Foco do Stable/MVP", "Stable/MVP focus"],
    ["Em preparação", "In preparation"],
    ["OrdaX Web e OrdaX Mobile", "OrdaX Web and OrdaX Mobile"],
    ["Continuidade entre telas", "Continuity across screens"],
    ["Em breve", "Coming soon"],
    ["OrdaX Desktop", "OrdaX Desktop"],
    ["Mais um modo de acesso", "Another access mode"],
    ["Futuro", "Future"],
    ["OrdaX OS — Nativo", "OrdaX OS — Native"],
    ["Instalação no disco interno", "Installation on the internal drive"],
    ["pós-MVP", "post-MVP"],
    ["IDEIAS ORGANIZAM REALIDADES", "IDEAS ORGANIZE REALITIES"],
    ["O próximo espaço", "The next space"],
    ["é o seu.", "is yours."],
    ["Voltar à experiência", "Back to the experience"],
    ["Um sistema em construção. Uma visão em movimento.", "A system under construction. A vision in motion."],
    ["ORDA X · PROTÓTIPO", "ORDA X · PROTOTYPE"],

    ["Download — OrdaX", "Download — OrdaX"],
    ["Conheça o OrdaX Creator e o caminho para preparar seu pendrive com uma release Stable autorizada.", "Learn about OrdaX Creator and the path to prepare your USB drive with an authorized Stable release."],
    ["OrdaX Creator e disponibilidade", "OrdaX Creator and availability"],
    ["Downloads públicos autorizados", "Authorized public downloads"],
    ["Antes de preparar", "Before preparing"],
    ["ORDA X / PREPARAR USB", "ORDA X / PREPARE USB"],
    ["Seu OrdaX", "Your OrdaX"],
    ["começa no USB.", "starts on USB."],
    ["Baixe o Creator. Prepare uma mídia verificada.", "Download Creator. Prepare verified media."],
    ["Inicie o sistema pelo pendrive.", "Boot the system from the USB drive."],
    ["Conhecer a preparação", "Learn about preparation"],
    ["STABLE/MVP · EM PREPARAÇÃO", "STABLE/MVP · IN PREPARATION"],
    ["Imagem conceitual", "Concept image"],
    ["O PRIMEIRO PASSO", "THE FIRST STEP"],
    ["OrdaX Creator", "OrdaX Creator"],
    ["Um app para preparar seu USB.", "An app to prepare your USB drive."],
    ["O Creator seleciona uma release Stable autorizada, verifica seus arquivos e prepara o pendrive para iniciar o OrdaX.", "Creator selects an authorized Stable release, verifies its files, and prepares the USB drive to boot OrdaX."],
    ["Consultando disponibilidade pública", "Checking public availability"],
    ["Os downloads aparecem aqui quando houver uma publicação autorizada.", "Downloads appear here when an authorized publication is available."],
    ["Ative JavaScript para consultar o catálogo. Nenhum download pode ser exibido sem verificar sua disponibilidade.", "Enable JavaScript to check the catalog. No download can be shown without verifying its availability."],
    ["Compatibilidade, tamanho e integridade acompanham cada arquivo publicado.", "Compatibility, size, and integrity information accompany every published file."],
    ["A release Stable", "The Stable release"],
    ["vai dentro do Creator.", "is selected inside Creator."],
    ["Uma preparação guiada, do arquivo oficial ao primeiro boot.", "A guided preparation flow, from the official file to the first boot."],
    ["Origem verificada", "Verified origin"],
    ["A assinatura da release é conferida antes da preparação.", "The release signature is checked before preparation."],
    ["Integridade conferida", "Integrity verified"],
    ["Os arquivos e a mídia preparada passam por verificação.", "The files and prepared media are verified."],
    ["O sistema roda pelo USB", "The system runs from USB"],
    ["No MVP, você usa o OrdaX diretamente pelo pendrive.", "In the MVP, you use OrdaX directly from the USB drive."],
    ["EM TRÊS PASSOS", "IN THREE STEPS"],
    ["Do download ao primeiro boot.", "From download to first boot."],
    ["SIMPLES. SEGURO. PORTÁTIL.", "SIMPLE. SECURE. PORTABLE."],
    ["Baixar o Creator", "Download Creator"],
    ["Quando disponível, baixe o Creator compatível com seu computador pelo catálogo oficial.", "When available, download the Creator version compatible with your computer from the official catalog."],
    ["Os detalhes do arquivo acompanham a publicação.", "File details accompany the publication."],
    ["Conferir e preparar o USB", "Verify and prepare the USB"],
    ["Abra o Creator, selecione a release e confira a identidade e a capacidade do pendrive.", "Open Creator, select the release, and verify the USB drive identity and capacity."],
    ["A preparação apaga o conteúdo do USB escolhido. Confirme somente o dispositivo correto.", "Preparation erases the contents of the selected USB drive. Confirm only the correct device."],
    ["Iniciar e usar pelo pendrive", "Boot and use from the USB drive"],
    ["Depois da gravação e verificação, reinicie o computador e selecione o USB no menu de boot.", "After writing and verification, restart the computer and select the USB drive from the boot menu."],
    ["O primeiro uso oferece conta e rede opcionais.", "First use offers optional account and network setup."],
    ["A preparação apaga o pendrive escolhido.", "Preparation erases the selected USB drive."],
    ["Salve seus arquivos antes. O Creator não oferece instalação no disco interno; a preparação não altera o SSD/NVMe/HD interno.", "Back up your files first. Creator does not offer installation to the internal drive; preparation does not modify the internal SSD/NVMe/HDD."],
    ["Entrar é opcional", "Signing in is optional"],
    ["Download e primeiro uso não exigem conta online.", "Download and first use do not require an online account."],
    ["Conhecer o acesso à conta ↗", "Learn about account access ↗"],
    ["Integridade antes da gravação", "Integrity before writing"],
    ["Assinatura, SHA-256 e tamanho vinculam a release aos arquivos oficiais. O Creator verifica esses dados antes de preparar o USB.", "Signature, SHA-256, and size bind the release to the official files. Creator verifies this data before preparing the USB."],
    ["Licenças e código-fonte", "Licenses and source code"],
    ["Seu sistema. Novas possibilidades.", "Your system. New possibilities."],

    ["Entrar — OrdaX", "Sign in — OrdaX"],
    ["Acesso seguro à Conta OrdaX.", "Secure access to your OrdaX Account."],
    ["Modos do produto", "Product modes"],
    ["Documentação da conta", "Account documentation"],
    ["CONTA ORDA X", "ORDA X ACCOUNT"],
    ["Um acesso.", "One sign-in."],
    ["Seu OrdaX inteiro.", "Your entire OrdaX."],
    ["Quando o acesso público for ativado, sua identidade poderá acompanhar projetos, preferências e dispositivos pelos modos OrdaX.", "When public access is enabled, your identity can follow projects, preferences, and devices across OrdaX modes."],
    ["Web", "Web"],
    ["Mobile", "Mobile"],
    ["USB", "USB"],
    ["Uma identidade, com controle seu.", "One identity, under your control."],
    ["Privacidade, sessão e recuperação seguem o mesmo contrato seguro em todos os modos.", "Privacy, sessions, and recovery follow the same secure contract across all modes."],
    ["ACESSO SEGURO", "SECURE ACCESS"],
    ["Entrar na", "Sign in to your"],
    ["Conta OrdaX.", "OrdaX Account."],
    ["Continue de onde parou quando o acesso público estiver disponível.", "Continue where you left off when public access becomes available."],
    ["Acesso temporariamente indisponível", "Sign-in temporarily unavailable"],
    ["Não foi possível liberar o acesso agora. Tente novamente mais tarde.", "Sign-in could not be enabled right now. Please try again later."],
    ["E-mail", "Email"],
    ["Senha", "Password"],
    ["Esqueci minha senha", "Forgot my password"],
    ["Entrar com segurança", "Sign in securely"],
    ["Verificação anti-automação", "Anti-automation verification"],
    ["Esta página não coleta credenciais enquanto o serviço real de identidade não estiver conectado.", "This page does not collect credentials until the real identity service is connected."],
    ["NOVO NA ORDAX?", "NEW TO ORDAX?"],
    ["Prepare sua futura conta.", "Prepare your future account."],
    ["Conhecer o cadastro", "Learn about registration"],
    ["Seu sistema. Sua identidade.", "Your system. Your identity."],
    ["voce@exemplo.com", "you@example.com"],
    ["Sua senha", "Your password"],

    ["Criar conta — OrdaX", "Create account — OrdaX"],
    ["Criação da futura Conta OrdaX.", "Create your future OrdaX Account."],
    ["Crie uma senha", "Create a password"],
    ["CONTA ORDA X / PRIMEIRO PASSO", "ORDA X ACCOUNT / FIRST STEP"],
    ["Comece pelo", "Start with"],
    ["seu espaço.", "your space."],
    ["Uma futura identidade para organizar projetos, preferências e acesso aos modos OrdaX quando o serviço público estiver pronto.", "A future identity to organize projects, preferences, and access to OrdaX modes when the public service is ready."],
    ["Uma conta para os modos do produto.", "One account for product modes."],
    ["Sessão e recuperação sob o mesmo contrato.", "Session and recovery under the same contract."],
    ["Seu acesso começa com clareza.", "Your access starts with clarity."],
    ["O portal só cria contas quando a identidade real e os documentos públicos estiverem prontos.", "The portal creates accounts only when the real identity service and public documents are ready."],
    ["NOVA CONTA", "NEW ACCOUNT"],
    ["Crie sua", "Create your"],
    ["Registre seu acesso quando o cadastro público estiver disponível.", "Register your access when public registration becomes available."],
    ["Cadastro temporariamente indisponível", "Registration temporarily unavailable"],
    ["Não foi possível liberar o cadastro agora. Tente novamente mais tarde.", "Registration could not be enabled right now. Please try again later."],
    ["Use pelo menos 12 caracteres.", "Use at least 12 characters."],
    ["Leia os Termos e a Política de Privacidade antes de criar sua conta:", "Read the Terms and Privacy Policy before creating your account:"],
    ["Li e aceito os Termos de Uso e a Política de Privacidade.", "I have read and accept the Terms of Use and Privacy Policy."],
    ["Criar conta com segurança", "Create account securely"],
    ["O portal não cria usuários apenas no navegador. Seus dados só serão enviados ao serviço aprovado.", "The portal does not create users only in the browser. Your data will be sent only to the approved service."],
    ["JÁ TEM UMA CONTA?", "ALREADY HAVE AN ACCOUNT?"],
    ["Entre e continue sua experiência.", "Sign in and continue your experience."],
    ["Ir para entrar", "Go to sign in"],

    ["Conta — OrdaX", "Account — OrdaX"],
    ["Área autenticada da Conta OrdaX.", "Authenticated OrdaX Account area."],
    ["Sua área OrdaX fica aqui, não na página inicial pública.", "Your OrdaX area lives here, not on the public landing page."],
    ["Esta rota é reservada à experiência autenticada do usuário. Perfil e sessão só aparecem quando os serviços reais estiverem habilitados. Web, Mobile, sincronização, backup e continuidade permanecem “Em breve”.", "This route is reserved for the authenticated user experience. Profile and session appear only when the real services are enabled. Web, Mobile, sync, backup, and continuity remain “Coming soon”."],
    ["ACESSO PROTEGIDO", "PROTECTED ACCESS"],
    ["Área da conta ainda indisponível", "Account area is not available yet"],
    ["Sessão real obrigatória", "Real session required"],
    ["O portal não simula dados de usuário, dispositivos, sincronização, assinatura ou uma sessão local. Enquanto a identidade pública não estiver pronta, esta área permanece fechada.", "The portal does not simulate user data, devices, synchronization, subscriptions, or a local session. Until public identity is ready, this area remains closed."],
    ["OrdaX Web, Mobile, sincronização, backup e continuidade entre dispositivos serão ativados somente quando os serviços reais existirem.", "OrdaX Web, Mobile, synchronization, backup, and continuity across devices will be enabled only when the real services exist."],
    ["Sem preços ou planos definidos", "No pricing or plans defined"],
    ["O MVP não implementa cobrança, tiers comerciais nem limite comercial de dispositivos. A arquitetura fica preparada para serviços futuros sem cobrar arbitrariamente pelo segundo dispositivo.", "The MVP does not implement billing, commercial tiers, or commercial device limits. The architecture remains ready for future services without arbitrarily charging for a second device."],
    ["Ir para Entrar", "Go to Sign in"],
    ["Voltar para a landing page", "Back to the landing page"],
    ["A raiz pública continua sendo a landing page.", "The public root remains the landing page."],

    ["Recuperar conta — OrdaX", "Recover account — OrdaX"],
    ["Recuperação da Conta OrdaX.", "OrdaX Account recovery."],
    ["Recupere o acesso sem expor sua sessão ao navegador.", "Recover access without exposing your session to the browser."],
    ["O pedido é enviado ao owner real de identidade. A conclusão usa uma sessão de recuperação protegida pelo servidor.", "The request is sent to the real identity owner. Completion uses a server-protected recovery session."],
    ["RECUPERAÇÃO", "RECOVERY"],
    ["Solicitar recuperação", "Request recovery"],
    ["Recuperação temporariamente indisponível", "Recovery temporarily unavailable"],
    ["Não foi possível liberar a recuperação agora. Tente novamente mais tarde.", "Recovery could not be enabled right now. Please try again later."],
    ["Enviar instruções", "Send instructions"],
    ["Lembrou a senha?", "Remembered your password?"],
    ["Voltar para entrar", "Back to sign in"],
    ["Documentação de conta:", "Account documentation:"],
    ["Recuperação sem tokens de sessão no JavaScript.", "Recovery without session tokens in JavaScript."],

    ["Nova senha — OrdaX", "New password — OrdaX"],
    ["Definição de nova senha da Conta OrdaX.", "Set a new OrdaX Account password."],
    ["Defina uma nova senha para sua conta.", "Set a new password for your account."],
    ["Esta etapa só funciona depois que o servidor valida o link enviado por e-mail e cria uma sessão de recuperação curta e protegida.", "This step works only after the server validates the emailed link and creates a short, protected recovery session."],
    ["NOVA SENHA", "NEW PASSWORD"],
    ["Atualizar senha", "Update password"],
    ["Alteração de senha indisponível", "Password change unavailable"],
    ["Não foi possível liberar a alteração de senha agora. Tente novamente mais tarde.", "Password changes could not be enabled right now. Please try again later."],
    ["Nova senha", "New password"],
    ["Confirmar nova senha", "Confirm new password"],
    ["Salvar nova senha", "Save new password"],
    ["O link expirou?", "Did the link expire?"],
    ["Solicitar novamente", "Request again"],
    ["Sessão de recuperação curta e server-side.", "Short, server-side recovery session."],

    ["Licenças e código aberto — OrdaX", "Licenses and open source — OrdaX"],
    ["Licenças, componentes de terceiros e código-fonte de conformidade das releases OrdaX.", "Licenses, third-party components, and compliance source code for OrdaX releases."],
    ["Conformidade de releases públicas", "Public release compliance"],
    ["LICENÇAS · CÓDIGO ABERTO", "LICENSES · OPEN SOURCE"],
    ["Transparência por release, sem transformar todo o OrdaX em uma licença só.", "Transparency by release, without treating all of OrdaX as a single license."],
    ["Cada release pública deverá trazer seu inventário de software, avisos de terceiros e o pacote de código-fonte exigido pelos componentes distribuídos. Esses artefatos são vinculados à mesma release por tamanho e SHA-256.", "Each public release must include its software inventory, third-party notices, and the source-code package required by distributed components. These artifacts are bound to the same release by size and SHA-256."],
    ["Verificando releases públicas", "Checking public releases"],
    ["Consultando o mesmo catálogo usado pela página de download.", "Checking the same catalog used by the download page."],
    ["SBOM", "SBOM"],
    ["O que foi enviado", "What was shipped"],
    ["O inventário da release descreve os componentes efetivamente distribuídos, em vez de assumir que todo o repositório possui a mesma licença.", "The release inventory describes the components actually distributed instead of assuming that the entire repository has the same license."],
    ["SOURCE COMPLIANCE", "SOURCE COMPLIANCE"],
    ["Código-fonte aplicável", "Applicable source code"],
    ["Quando uma licença de componente exigir disponibilização de fonte, o pacote correspondente aparece junto daquela release. Isso não implica abrir automaticamente o código proprietário do produto OrdaX.", "When a component license requires source availability, the corresponding package appears with that release. This does not automatically open proprietary OrdaX product code."],
    ["Protótipo OrdaX · conformidade vinculada por release.", "OrdaX Prototype · compliance bound per release."],

    ["Privacidade — OrdaX", "Privacy — OrdaX"],
    ["Estado de preparação da política de privacidade do portal OrdaX.", "Readiness status of the OrdaX portal privacy policy."],
    ["PRIVACIDADE · PREPARAÇÃO", "PRIVACY · READINESS"],
    ["A política final ainda não está publicada.", "The final policy has not been published yet."],
    ["Esta página registra o estado técnico atual do protótipo. Ela não é uma política de privacidade final nem declara uma conta pública ativa.", "This page records the current technical state of the prototype. It is not a final privacy policy and does not declare an active public account service."],
    ["Conta pública ainda desativada", "Public accounts are still disabled"],
    ["Login e cadastro permanecem indisponíveis até existir um serviço real de identidade e documentação jurídica final aprovada.", "Sign-in and registration remain unavailable until a real identity service and approved final legal documentation exist."],
    ["BASELINE TÉCNICO", "TECHNICAL BASELINE"],
    ["O portal não precisa fingir uma política para avançar.", "The portal does not need to pretend a policy exists in order to move forward."],
    ["Sem formulário de senha", "No password form"],
    ["O site estático não coleta credenciais enquanto o gateway de identidade não estiver configurado.", "The static site does not collect credentials while the identity gateway is not configured."],
    ["Sem analytics no baseline", "No analytics in the baseline"],
    ["A fonte atual do portal não carrega JavaScript, CSS ou fontes de terceiros para analytics ou publicidade.", "The current portal source does not load third-party JavaScript, CSS, or fonts for analytics or advertising."],
    ["Documentação antes da ativação", "Documentation before activation"],
    ["Versão, data de vigência, identidade do responsável, retenção e demais regras ainda precisam de revisão antes da conta pública ser habilitada.", "Version, effective date, controller identity, retention, and other rules still require review before public accounts are enabled."],
    ["Documento de preparação · não vigente.", "Readiness document · not in force."],

    ["Termos — OrdaX", "Terms — OrdaX"],
    ["Estado de preparação dos termos do portal OrdaX.", "Readiness status of the OrdaX portal terms."],
    ["TERMOS · PREPARAÇÃO", "TERMS · READINESS"],
    ["Os termos finais de conta ainda não estão vigentes.", "The final account terms are not yet in force."],
    ["O portal está preparado para receber termos revisados antes da ativação do cadastro. Nenhum aceite jurídico fictício é solicitado nesta fase.", "The portal is prepared to receive reviewed terms before registration is enabled. No fictitious legal acceptance is requested at this stage."],
    ["Cadastro permanece fechado", "Registration remains closed"],
    ["Os termos finais, sua versão e sua data de vigência precisam ser publicados antes de a conta OrdaX ser habilitada para usuários.", "The final terms, their version, and effective date must be published before OrdaX accounts are enabled for users."],
    ["GATE DE ATIVAÇÃO", "ACTIVATION GATE"],
    ["Conta real só depois de responsabilidades reais.", "Real accounts only after real responsibilities are defined."],
    ["Versão estável", "Stable version"],
    ["O documento final deverá ter uma versão identificável e uma data de vigência.", "The final document must have an identifiable version and an effective date."],
    ["Ciclo da conta", "Account lifecycle"],
    ["Criação, sessão, exportação, exclusão, suporte e revogação precisam ter owners e regras definidos.", "Creation, session, export, deletion, support, and revocation need defined owners and rules."],
    ["Sem checkbox decorativo", "No decorative checkbox"],
    ["O protótipo não apresenta aceite de termos enquanto não existir um documento final aplicável ao fluxo real.", "The prototype does not present terms acceptance until a final document applicable to the real flow exists."],

    ["Explorar a demonstração", "Explore the demo"],
    ["Área de trabalho de demonstração no notebook", "Demo workspace on notebook"],
    ["Conceito de demonstração no telefone", "Demo concept on phone"],
    ["Recomeçar demonstração", "Restart demo"],
    ["Fechar demonstração ampliada", "Close expanded demo"],
    ["Disponibilidade dos modos OrdaX", "OrdaX mode availability"],
    ["A demonstração está indisponível enquanto a fixture pública é atualizada.", "The demo is unavailable while the public fixture is being updated."],
    ["Uma ideia começa aqui", "An idea starts here"],
    ["Um espaço para pensar com calma.\n\nEscreva algo aqui e veja sua ideia aparecer na outra tela.", "A space to think calmly.\n\nWrite something here and watch your idea appear on the other screen."],
    ["Contexto", "Context"],
    ["Boas-vindas.txt", "Welcome.txt"],
    ["Meu projeto.txt", "My project.txt"],
    ["Referências.txt", "References.txt"],
    ["Seu espaço começa com uma ideia.\n\nEsta é uma demonstração interativa do OrdaX. Explore as pastas, escreva uma nota e escolha seu tema. Nada aqui acessa os arquivos do seu dispositivo.", "Your space starts with an idea.\n\nThis is an interactive OrdaX demo. Explore folders, write a note, and choose your theme. Nothing here accesses files on your device."],
    ["Um projeto, muitas possibilidades.\n\n1. Guardar referências\n2. Escrever a primeira ideia\n3. Escolher o próximo passo", "One project, many possibilities.\n\n1. Save references\n2. Write the first idea\n3. Choose the next step"],
    ["Referências de exemplo\n\nLuz natural. Materiais simples. Espaço para criar.\n\nNo OrdaX, a visão é aproximar conteúdo e contexto de trabalho.", "Sample references\n\nNatural light. Simple materials. Space to create.\n\nIn OrdaX, the vision is to bring content and work context closer together."],
    ["Aplicativos principais", "Main applications"],
    ["DEMONSTRAÇÃO", "DEMO"],
    ["Dados de exemplo", "Sample data"],
    ["ESPAÇO CRIATIVO / PROJETO DE EXEMPLO", "CREATIVE SPACE / SAMPLE PROJECT"],
    ["Direção criativa", "Creative direction"],
    ["Projetos que conectam pessoas e futuros.", "Projects that connect people and futures."],
    ["CONCEITO INTERATIVO", "INTERACTIVE CONCEPT"],
    ["Exemplo fictício · IA predefinida · Nenhum modelo está sendo executado.", "Fictional example · Predefined AI · No model is being executed."],
    ["Visão geral", "Overview"],
    ["Ideias", "Ideas"],
    ["em movimento", "in motion"],
    ["para um amanhã", "for a tomorrow"],
    ["mais humano.", "more human."],
    ["DIREÇÃO CRIATIVA · EXEMPLO", "CREATIVE DIRECTION · SAMPLE"],
    ["Brief do projeto", "Project brief"],
    ["Explorar uma nova linguagem visual para a Aurora, conectando tecnologia, natureza e pessoas em uma mesma narrativa.", "Explore a new visual language for Aurora, connecting technology, nature, and people in one narrative."],
    ["Marcos principais", "Key milestones"],
    ["Pesquisa e referências", "Research and references"],
    ["Concluído no exemplo", "Completed in the sample"],
    ["Em andamento", "In progress"],
    ["Validar contraste da paleta", "Validate palette contrast"],
    ["Apresentação conceitual", "Concept presentation"],
    ["Próximo passo", "Next step"],
    ["Análise de exemplo", "Sample analysis"],
    ["A direção está clara.", "The direction is clear."],
    ["Falta validar.", "Validation is still needed."],
    ["O conceito comunica os pilares do projeto. Antes da entrega, vale revisar o contraste e a legibilidade nas aplicações.", "The concept communicates the project's pillars. Before delivery, review contrast and legibility across applications."],
    ["Pontos de atenção", "Points to review"],
    ["Verificar contraste da paleta", "Check palette contrast"],
    ["Revisar hierarquia tipográfica", "Review typographic hierarchy"],
    ["Validar a mensagem", "Validate the message"],
    ["Uma perspectiva para o projeto.", "A perspective for the project."],
    ["A decisão continua com você.", "The decision remains yours."],
    ["Revisar sugestão ↗", "Review suggestion ↗"],
    ["O contexto vem primeiro.", "Context comes first."],
    ["Uma análise consultiva parte de referências explícitas. Abra os documentos deste exemplo.", "A consultative analysis starts from explicit references. Open the documents in this example."],
    ["Objetivo, público e critérios", "Goal, audience, and criteria"],
    ["Direção visual", "Visual direction"],
    ["Paleta, materiais e tipografia", "Palette, materials, and typography"],
    ["Revisão de entrega", "Delivery review"],
    ["Pendências e critérios de aceite", "Open items and acceptance criteria"],
    ["Objetivo: tornar a Aurora reconhecível e acessível. Público: estúdios independentes. Critério: legibilidade em telas pequenas.", "Goal: make Aurora recognizable and accessible. Audience: independent studios. Criterion: legibility on small screens."],
    ["Direção: mineral, grafite e cobre. Usar espaços generosos e testar contraste antes de fechar a paleta.", "Direction: mineral, graphite, and copper. Use generous spacing and test contrast before finalizing the palette."],
    ["Aceite: confirmar contraste, aprovar duas aplicações e registrar a decisão final. Nenhuma entrega aprovada neste exemplo.", "Acceptance: confirm contrast, approve two applications, and record the final decision. No delivery is approved in this example."],
    ["Selecione uma referência para consultar seu conteúdo.", "Select a reference to view its content."],
    ["ORDA X INTELLIGENCE", "ORDA X INTELLIGENCE"],
    ["Uma perspectiva.", "A perspective."],
    ["Você decide.", "You decide."],
    ["Analise o contexto do projeto e revise a sugestão antes de levá-la ao seu plano.", "Analyze the project context and review the suggestion before adding it to your plan."],
    ["3 referências de exemplo", "3 sample references"],
    ["ANÁLISE ILUSTRATIVA", "ILLUSTRATIVE ANALYSIS"],
    ["CONSULTA DE EXEMPLO", "SAMPLE QUERY"],
    ["A direção está clara. Falta validar.", "The direction is clear. Validation is still needed."],
    ["O que merece atenção antes da entrega?", "What deserves attention before delivery?"],
    ["O brief pede legibilidade, mas a direção visual ainda não registra uma verificação de contraste. Essa é a primeira pendência a revisar.", "The brief calls for legibility, but the visual direction does not yet record a contrast check. That is the first open item to review."],
    ["Explore como o contexto poderia orientar uma resposta consultiva. Esta prévia usa uma resposta predefinida.", "Explore how context could guide a consultative response. This preview uses a predefined response."],
    ["Compare texto, fundo e elementos interativos antes de aprovar as aplicações.", "Compare text, background, and interactive elements before approving the applications."],
    ["Referências: Brief do projeto · Direção visual", "References: Project brief · Visual direction"],
    ["Adicionado ao plano de exemplo ✓", "Added to the sample plan ✓"],
    ["Adicionar ao plano de exemplo", "Add to the sample plan"],
    ["Explorar análise de exemplo →", "Explore sample analysis →"],
    ["MEU ESPAÇO / NOTA PESSOAL", "MY SPACE / PERSONAL NOTE"],
    ["Título da nota no telefone", "Note title on phone"],
    ["Título da nota no notebook", "Note title on notebook"],
    ["Uma ideia, nas duas telas", "One idea, on both screens"],
    ["Texto da nota no telefone", "Note text on phone"],
    ["Texto da nota no notebook", "Note text on notebook"],
    ["Experimentar algo novo hoje", "Try something new today"],
    ["↔ Compartilhado nesta demonstração", "↔ Shared in this demo"],
    ["APARÊNCIA", "APPEARANCE"],
    ["Do seu jeito.", "Your way."],
    ["Uma pequena mudança faz diferença. Escolha a luz do seu espaço.", "A small change makes a difference. Choose the light for your space."],
    ["O tema muda nas duas telas.", "The theme changes on both screens."],
    ["Esta área é uma demonstração local do app principal.", "This area is a local demo of the main app."],
    ["Volte à Home para continuar explorando.", "Return to Home to keep exploring."],
    ["Meu espaço", "My space"],
    ["← Voltar aos arquivos", "← Back to files"],
    ["Documentos", "Documents"],
    ["Projetos", "Projects"],
    ["Alteração no telefone refletida nas duas telas. Simulação local.", "Change on phone reflected on both screens. Local simulation."],
    ["Alteração no notebook refletida nas duas telas. Simulação local.", "Change on notebook reflected on both screens. Local simulation."],
    ["Análise de exemplo disponível. Resposta predefinida, sem inferência real.", "Sample analysis available. Predefined response, with no real inference."],
    ["Sugestão adicionada ao plano fictício do projeto Aurora.", "Suggestion added to the fictional Aurora project plan."],
    ["Demonstração reiniciada. Os dados de exemplo foram restaurados.", "Demo restarted. Sample data has been restored."],
    ["A Home do OrdaX reúne seus apps e espaços de trabalho.", "OrdaX Home brings together your apps and workspaces."],
    ["Projeto Aurora: objetivos, referências e próximos passos de exemplo.", "Aurora project: sample goals, references, and next steps."],
    ["Explore uma análise predefinida. Esta página não executa inferência.", "Explore a predefined analysis. This page does not run inference."],
    ["Consulte as referências fictícias que sustentam a análise.", "Review the fictional references that support the analysis."],
    ["Área 01", "Area 01"],
    ["Seu espaço", "Your space"],
    ["Conta", "Account"],
    ["Organize documentos, imagens, downloads e conteúdo persistente do usuário.", "Organize documents, images, downloads, and persistent user content."],
    ["Organize projetos locais, conexões e continuidade entre dispositivos.", "Organize local projects, connections, and continuity across devices."],
    ["Acesse seus projetos e confira a integração do Studio com este host.", "Access your projects and check Studio integration with this host."],
    ["Seu espaço de escrita", "Your writing space"],
    ["Escrita local, projetos, tarefas e referências disponíveis offline.", "Local writing, projects, tasks, and references available offline."],
    ["Conversa local com a OrdaX Intelligence, sem autoridade implícita para executar ações.", "Local conversation with OrdaX Intelligence, without implicit authority to execute actions."],
    ["Trabalho explícito do Personal OrdaX, com progresso e resultados visíveis.", "Explicit Personal OrdaX work, with visible progress and results."],
    ["Entrega, atualizações, conectividade e recursos desta execução do OrdaX.", "Delivery, updates, connectivity, and resources for this OrdaX run."],
    ["Consultar referências", "Review references"],
    ["☀ Claro", "☀ Light"],
    ["☾ Escuro", "☾ Dark"],
    ["Tudo tem seu lugar.", "Everything has its place."],
    ["Tema alterado nas duas telas.", "Theme changed on both screens."],
    ["NAVEGAÇÃO", "BROWSING"],
    ["CONTINUIDADE", "CONTINUITY"],
    ["ESTADO DO SISTEMA", "SYSTEM STATUS"],
    ["telefone", "phone"],
    ["notebook", "notebook"],
    ["Apps no telefone", "Apps on phone"],
    ["Apps no notebook", "Apps on notebook"],
    ["Seu trabalho", "Your work"],
    ["Navegue, organize referências e conecte pesquisa ao seu trabalho.", "Browse, organize references, and connect research to your work."],
    ["Preferências do OrdaX", "OrdaX preferences"],
    ["Preferências compartilhadas, aparência e rede do OrdaX.", "Shared OrdaX preferences, appearance, and network."],
    ["Identidade, acesso e continuidade segura entre os modos do OrdaX.", "Identity, access, and secure continuity across OrdaX modes."],
    ["Aplicativos OrdaX", "OrdaX applications"],
    ["Descubra aplicativos verificados e solicite instalação pelo lifecycle da plataforma.", "Discover verified apps and request installation through the platform lifecycle."],
    ["Como a Conta OrdaX utiliza e protege dados pessoais.", "How the OrdaX Account uses and protects personal information."],
    ["Política de Privacidade — OrdaX", "Privacy Policy — OrdaX"],
    ["CONTA ORDA X · DOCUMENTO VIGENTE", "ORDA X ACCOUNT · CURRENT DOCUMENT"],
    ["Política de Privacidade", "Privacy Policy"],
    ["Versão:", "Version:"],
    ["A Conta OrdaX é inicialmente operada por Washington Jesus, pessoa física no Brasil. Para dúvidas, direitos relativos a dados pessoais, correções e pedidos de exclusão, escreva para", "The OrdaX Account is initially operated by Washington Jesus, an individual in Brazil. For questions, personal-data rights, corrections or deletion requests, write to"],
    ["2. Dados e finalidades", "2. Data and purposes"],
    ["No cadastro são tratados e-mail, identificador de conta e credenciais gerenciadas pelo Supabase Auth. Senhas não são exibidas publicamente nem devem ser enviadas ao suporte. O serviço também usa dados de sessão, informações técnicas necessárias à segurança, proteção contra abuso e versão/data do aceite dos documentos.", "Registration processes your email address, account identifier and credentials managed through Supabase Auth. Passwords are not displayed publicly and must not be sent to support. The service also uses session data, technical security information, abuse-prevention data, and the version/date of accepted documents."],
    ["3. Por que usamos esses dados", "3. Why we use this information"],
    ["E-mail e dados de autenticação permitem criar, confirmar e proteger a conta e recuperar o acesso. Cookies técnicos de sessão permitem manter a autenticação. Logs e limites de tentativa auxiliam na prevenção de fraude e incidentes. O tratamento se apoia em hipóteses aplicáveis da LGPD, como execução do serviço, cumprimento de obrigações legais e proteção legítima contra abuso, conforme cada finalidade; o aceite dos Termos não constitui consentimento genérico para qualquer tratamento.", "Email and authentication information are used to create, confirm and protect accounts and restore access. Essential session cookies maintain authentication. Logs and rate limits help prevent fraud and incidents. Processing relies on applicable Brazilian data-protection legal bases, including service performance, compliance with legal duties and legitimate security interests, according to purpose; accepting the Terms does not constitute blanket consent for all processing."],
    ["4. Prestadores de serviços", "4. Service providers"],
    ["São utilizados Supabase para autenticação e infraestrutura de dados, Vercel para hospedagem do portal e Cloudflare Turnstile para proteção contra automação. Esses provedores podem processar dados técnicos e operar infraestrutura fora do Brasil, de acordo com as configurações e contratos aplicáveis. Não vendemos dados pessoais de cadastro a anunciantes.", "We use Supabase for authentication and data infrastructure, Vercel for site hosting and Cloudflare Turnstile for bot prevention. These providers may process technical data and operate infrastructure outside Brazil under their applicable settings and agreements. We do not sell registration data to advertisers."],
    ["5. Cookies e segurança", "5. Cookies and security"],
    ["A conta utiliza cookies essenciais de sessão protegidos por atributos HttpOnly, Secure e SameSite. Cookies de segurança da infraestrutura podem existir separadamente. Não é necessária a autorização de cookies de publicidade para criar uma conta.", "The account uses essential session cookies protected with HttpOnly, Secure and SameSite attributes. Separate security cookies may be issued by infrastructure providers. Advertising-cookie consent is not required to create an account."],
    ["6. Conservação e exclusão", "6. Retention and deletion"],
    ["Os dados de conta são conservados enquanto necessários à prestação do serviço e à manutenção da segurança, observadas obrigações legais aplicáveis. Registros indispensáveis para segurança, comprovação de aceites ou cumprimento legal podem ser conservados por prazo justificado mesmo após o encerramento. Backups seguem ciclos técnicos de descarte. Para solicitar acesso, exportação, correção ou encerramento, utilize os controles disponíveis da conta ou o canal de contato.", "Account data are retained as necessary to operate the service and maintain security, subject to applicable legal duties. Records needed for security, proof of agreement or legal compliance may be retained for a justified period after closure. Backups follow technical deletion cycles. To request access, export, correction or account closure, use the available account controls or contact channel."],
    ["Você pode solicitar informações sobre o tratamento, acesso, correção, exclusão quando aplicável, portabilidade quando cabível e esclarecimentos sobre compartilhamentos, nos termos da LGPD. Pedidos podem exigir confirmação proporcional da identidade para evitar entrega de dados a terceiros. Contato: ordaxos@gmail.com.", "Under Brazilian data-protection law, you may request processing information, access, correction, deletion when applicable, portability when available, and explanations of data sharing. Requests may require proportionate identity verification to prevent disclosure to others. Contact: ordaxos@gmail.com."],
    ["8. Alterações", "8. Changes"],
    ["Mudanças relevantes serão publicadas nesta página com versão e data de vigência atualizadas. O registro de aceite de cadastro fica vinculado à versão aplicável; alterações futuras não modificam retroativamente os registros antigos.", "Material changes will be published on this page with updated version and effective date. Registration acceptance records are linked to the applicable version; later changes do not retroactively alter earlier records."],
    ["Washington Jesus, pessoa física. E-mail de suporte e privacidade:", "Washington Jesus, individual operator. Support and privacy email:"],
    ["Versão 2026.10.09 · vigente desde 2026-10-09.", "Version 2026.10.09 · effective since 2026-10-09."],
    ["Termos de Uso", "Terms of Use"],
    ["Cadastro", "Registration"],
    ["Condições de utilização da Conta OrdaX.", "OrdaX Account terms and conditions."],
    ["Termos de Uso — OrdaX", "Terms of Use — OrdaX"],
    ["Este serviço de Conta OrdaX é oferecido inicialmente por Washington Jesus, pessoa física, com contato em", "This OrdaX Account service is initially offered by Washington Jesus, an individual, contactable at"],
    [". O uso local do OrdaX OS pode ocorrer sem conta. A conta serve para identificação, sessões e recursos de conta disponibilizados pelo portal; funcionalidades ainda não lançadas não são garantidas.", ". Local use of OrdaX OS is possible without an account. The account provides identity, sessions and account features made available on the website; features not yet released are not guaranteed."],
    ["2. Cadastro e aceite", "2. Registration and acceptance"],
    ["Para criar uma Conta OrdaX, informe um e-mail acessível, escolha uma senha e confirme sua concordância com estes Termos e a leitura da Política de Privacidade na versão apresentada. A confirmação do e-mail pode ser exigida para ativar o acesso. O aceite é feito pelo próprio usuário durante o cadastro e registrado no servidor.", "To create an OrdaX Account, provide an accessible email address, choose a password, and confirm your acceptance of these Terms and acknowledgment of the displayed Privacy Policy. Email verification may be required before access is activated. The user accepts these documents during registration and the server records that acceptance."],
    ["3. Credenciais e segurança", "3. Credentials and security"],
    ["Mantenha sua senha em sigilo e informe possíveis acessos indevidos. Podemos impor limites de tentativas, solicitar confirmação de e-mail e suspender ações que ameacem a segurança, observando critérios proporcionais. Nunca informe códigos de recuperação ou senhas por e-mail ao suporte.", "Keep your password confidential and report suspected unauthorized access. We may rate-limit attempts, require email verification and suspend security-threatening actions using proportionate measures. Never email passwords or recovery codes to support."],
    ["Não tente acessar contas alheias, explorar vulnerabilidades, interferir no funcionamento do serviço, utilizar automação abusiva ou violar direitos de terceiros. O serviço poderá restringir usos ilícitos ou que comprometam a operação.", "Do not access other users' accounts, exploit vulnerabilities, disrupt the service, use abusive automation or infringe the rights of others. Unlawful or disruptive use may be restricted."],
    ["5. Disponibilidade e evolução", "5. Availability and updates"],
    ["O OrdaX pode receber atualizações e melhorias. Recursos experimentais ou em desenvolvimento podem não estar disponíveis para todos. Interrupções pontuais e manutenções poderão ocorrer; comunicaremos mudanças relevantes pelos canais do produto quando possível.", "OrdaX may receive updates and improvements. Experimental or in-development features may not be available to everyone. Temporary interruptions and maintenance may occur; we will communicate material changes through product channels where possible."],
    ["6. Privacidade e terceiros", "6. Privacy and third parties"],
    ["O tratamento de dados pessoais é descrito na", "Personal data processing is described in the"],
    [". A autenticação utiliza infraestrutura de terceiros identificada naquela página. O aceite destes Termos não substitui os direitos previstos na LGPD.", ". Authentication uses third-party infrastructure listed there. Accepting these Terms does not replace rights under Brazilian data-protection law."],
    ["7. Conta e encerramento", "7. Accounts and closure"],
    ["O usuário poderá solicitar acesso aos próprios dados, recuperação ou encerramento da conta pelos canais disponibilizados. O encerramento pode exigir reautenticação e não apaga automaticamente projetos/arquivos armazenados apenas localmente. Certos registros podem ser retidos quando houver obrigação legal ou necessidade legítima justificada.", "Users may request access to their information, account recovery or closure through the available channels. Closure may require reauthentication and does not automatically delete projects or files stored only on the user's device. Certain records may be retained when required by law or justified legitimate interests."],
    ["8. Preços e aplicativos", "8. Pricing and applications"],
    ["Este documento não constitui contratação de planos pagos. Eventuais compras, planos, loja de aplicativos, serviços empresariais ou assinaturas exigirão apresentação das respectivas condições antes da contratação. Não há obrigação de adquirir produto pago para aceitar estes Termos.", "This document does not constitute a paid-plan purchase. Future purchases, plans, app stores, business services or subscriptions will require their own terms before purchase. You do not have to buy a paid product to accept these Terms."],
    ["9. Atualizações e direitos legais", "9. Updates and legal rights"],
    ["A versão aplicável ao cadastro é a exibida pelo serviço e permanece associada ao registro de aceite. Alterações materiais poderão exigir novo aceite quando necessário. Aplicam-se as leis brasileiras e os direitos legalmente assegurados ao consumidor e aos titulares de dados.", "The version applicable to registration is shown by the service and linked to the acceptance record. Material changes may require renewed acceptance when appropriate. Brazilian law and statutory consumer and data-subject rights apply."],
    ["Minha Conta OrdaX: sessão, serviços e acesso ao OrdaX Web.", "My OrdaX Account: session, services and access to OrdaX Web."],
    ["Minha conta — OrdaX", "My account — OrdaX"],
    ["CONTA ORDAX", "ORDAX ACCOUNT"],
    ["Seções da conta", "Account sections"],
    ["Visão geral", "Overview"],
    ["Identidade e segurança", "Identity and security"],
    ["Plano e serviços", "Plan and services"],
    ["Acessar OrdaX Web", "Access OrdaX Web"],
    ["Seu acesso ao ecossistema OrdaX.", "Your access to the OrdaX ecosystem."],
    ["SEU ESPAÇO", "YOUR SPACE"],
    ["Gerencie sua sessão e acompanhe os serviços da sua Conta OrdaX.", "Manage your session and view your OrdaX Account services."],
    ["ORDAX NO NAVEGADOR", "ORDAX IN YOUR BROWSER"],
    ["Seu próximo espaço de trabalho.", "Your next workspace."],
    ["Acesse o OrdaX Web e continue com os recursos disponíveis para sua conta.", "Access OrdaX Web and continue with the features available for your account."],
    ["IDENTIDADE", "IDENTITY"],
    ["Sua conta, com acesso seguro.", "Your account, with secure access."],
    ["Conexão neste navegador", "Connection in this browser"],
    ["Encerrar esta sessão não exclui sua conta nem os arquivos dos seus dispositivos.", "Signing out of this session does not delete your account or files on your devices."],
    ["ECOSSISTEMA", "ECOSYSTEM"],
    ["PLANOS", "PLANS"],
    ["Uma estrutura para crescer.", "Room to grow."],
    ["Free, Personal, Professional e Team compõem a estrutura de planos OrdaX. Assinaturas pagas ainda não estão disponíveis.", "Free, Personal, Professional and Team make up the OrdaX plan structure. Paid subscriptions are not available yet."],
    ["Seu plano e seus limites serão exibidos quando o serviço da conta estiver disponível.", "Your plan and limits will appear when the account service is available."],
    ["ARMAZENAMENTO", "STORAGE"],
    ["Seus arquivos, seu controle.", "Your files, your control."],
    ["O armazenamento na nuvem está em preparação. Seus arquivos locais continuam nos seus dispositivos.", "Cloud storage is being prepared. Your local files stay on your devices."],
    ["Não há uso ou capacidade de armazenamento verificados para exibir nesta página.", "There is no verified storage usage or capacity to display on this page."],
    ["DISPOSITIVOS", "DEVICES"],
    ["Conexões com permissão.", "Connections with permission."],
    ["Dispositivos e conexões de IA terão controles próprios. Entrar na conta não autoriza acesso aos seus arquivos ou equipamentos.", "Devices and AI connections will have their own controls. Signing in does not authorize access to your files or equipment."],
    ["O gerenciamento de dispositivos ainda não está disponível neste portal.", "Device management is not available in this portal yet."],
    ["Uma conta. Seu espaço de trabalho.", "One account. Your workspace."],
    ["Informações do site", "Website information"],
    ["Acesso ao OrdaX Web pela sua Conta OrdaX.", "Access to OrdaX Web through your OrdaX Account."],
    ["OrdaX Web — acessar", "OrdaX Web — access"],
    ["ORDAX WEB", "ORDAX WEB"],
    ["Seu sistema.", "Your system."],
    ["Um novo ponto de acesso.", "A new point of access."],
    ["Entre no seu espaço OrdaX pelo navegador, com a mesma identidade e os recursos disponíveis para sua conta.", "Enter your OrdaX workspace in your browser with the same identity and the features available for your account."],
    ["Uma identidade", "One identity"],
    ["A mesma Conta OrdaX, sem um cadastro separado para o Web.", "The same OrdaX Account, without a separate Web registration."],
    ["Recursos do seu espaço", "Your workspace features"],
    ["Cada serviço mantém suas permissões e sua disponibilidade.", "Each service keeps its own permissions and availability."],
    ["Trabalho conectado", "Connected work"],
    ["Operações em arquivos locais exigem um dispositivo autorizado e online.", "Operations on local files require an authorized online device."],
    ["SEU ACESSO", "YOUR ACCESS"],
    ["Abrir OrdaX Web", "Open OrdaX Web"],
    ["Verificando disponibilidade", "Checking availability"],
    ["Consultando sua sessão e o acesso ao OrdaX Web.", "Checking your session and access to OrdaX Web."],
    ["Abrir meu espaço", "Open my workspace"],
    ["Acesso ao Web não dá controle automático sobre seus dispositivos.", "Web access does not automatically grant control over your devices."],
    ["Ir para Minha conta", "Go to My account"],
    ["Minha Conta OrdaX: identidade, segurança, planos, dispositivos e acesso Web.","My OrdaX Account: identity, security, plans, devices, and Web access."],
    ["SUA CONTA","YOUR ACCOUNT"],
    ["SEU ESPAÇO ORDAX","YOUR ORDAX SPACE"],
    ["Buscar na conta","Search your account"],
    ["Plano","Plan"],
    ["Sua experiência. Em todos os lugares.","Your experience. Everywhere."],
    ["Buscar configurações, dispositivos, integrações...","Search settings, devices, integrations..."],
    ["Plano e assinatura","Plan and subscription"],
    ["Segurança","Security"],
    ["Dispositivos e sessões","Devices and sessions"],
    ["Armazenamento e sincronização","Storage and synchronization"],
    ["Aplicativos e integrações","Apps and integrations"],
    ["Preferências","Preferences"],
    ["Atividade e notificações","Activity and notifications"],
    ["Atividade","Activity"],
    ["Pagamento e faturamento","Payment and billing"],
    ["Dados e privacidade","Data and privacy"],
    ["SUPORTE","SUPPORT"],
    ["Ajuda e suporte","Help and support"],
    ["Conta, serviços e preferências. Tudo no seu espaço.","Account, services, and preferences. All in your workspace."],
    ["← Visão geral","← Overview"],
    ["IDENTIDADE ORDAX","ORDAX IDENTITY"],
    ["Seu espaço começa com você.","Your workspace starts with you."],
    ["Uma conta para o seu ecossistema.","One account for your ecosystem."],
    ["Seu perfil é apresentado a partir da sessão confirmada. Edição de nome e foto ainda não está disponível no portal.","Your profile reflects the verified session. Name and photo editing are not yet available in this portal."],
    ["Entre para acessar os dados confirmados da sua conta.","Sign in to access verified information about your account."],
    ["Nenhum dado pessoal será exibido até que sua sessão possa ser confirmada.","No personal information will be shown until your session can be verified."],
    ["Conheça a estrutura de planos OrdaX.","Explore the OrdaX plan structure."],
    ["Assinaturas pagas ainda não estão disponíveis.","Paid subscriptions are not yet available."],
    ["Seu plano e seus limites precisam ser confirmados pelo serviço da conta. Nenhum plano é atribuído por esta página.","Your plan and limits must be verified by the account service. This page does not assign a plan."],
    ["Revise sua sessão e os métodos de acesso.","Review your session and sign-in methods."],
    ["Sessão","Session"],
    ["Sessão neste navegador","Session in this browser"],
    ["Verificar sessão","Check session"],
    ["Autenticação em duas etapas","Two-factor authentication"],
    ["Sem informação confirmada","No verified information"],
    ["Passkeys e métodos de entrada","Passkeys and sign-in methods"],
    ["Indisponíveis no portal","Unavailable in this portal"],
    ["Recuperação de acesso segue o serviço oficial de identidade. A página de recuperação informa sua disponibilidade.","Account recovery uses the official identity service. The recovery page reports its availability."],
    ["Recuperar acesso","Recover access"],
    ["Computadores e celulares vinculados à sua conta.","Computers and phones linked to your account."],
    ["Não há um catálogo de dispositivos disponível neste portal.","A device catalog is not available in this portal."],
    ["Estar logado não autoriza controle remoto. Vínculos, permissões e revogação pertencem ao serviço de dispositivos.","Signing in does not authorize remote control. Links, permissions, and revocation are managed by the device service."],
    ["Seus arquivos e a continuidade entre dispositivos.","Your files and continuity across devices."],
    ["Uso e limite da nuvem","Cloud usage and capacity"],
    ["Não verificados","Not verified"],
    ["Sincronização e backup","Synchronization and backup"],
    ["Seus arquivos locais permanecem nos seus dispositivos. Pausar a sincronização e gerenciar cópias exigem o serviço autorizado do sistema.","Your local files remain on your devices. Pausing synchronization and managing copies require the authorized system service."],
    ["Controle as conexões com seu espaço OrdaX.","Manage connections to your OrdaX workspace."],
    ["O catálogo de aplicativos e as conexões de IA ainda não estão disponíveis nesta área da conta.","The app catalog and AI connections are not yet available in this account area."],
    ["O Studio e o plugin usam as permissões do OrdaX. Uma conexão não concede acesso automático a todos os arquivos e dispositivos.","Studio and the plugin use OrdaX permissions. A connection does not automatically grant access to all files and devices."],
    ["Conhecer o acesso Web","Explore Web access"],
    ["Personalize a apresentação deste portal.","Customize this portal's presentation."],
    ["Idioma da interface","Interface language"],
    ["A escolha fica neste navegador.","Your choice stays in this browser."],
    ["Identidade visual","Visual identity"],
    ["Meia-noite · OrdaX","Midnight · OrdaX"],
    ["Preferências do sistema, acessibilidade e notificações são gerenciadas pelo OrdaX. O idioma deste portal não altera a configuração dos seus dispositivos.","System preferences, accessibility, and notifications are managed by OrdaX. This portal's language does not change your device settings."],
    ["Acompanhe eventos confirmados da sua conta.","Follow verified account events."],
    ["O histórico de acessos e as notificações da conta ainda não estão disponíveis no portal.","Sign-in history and account notifications are not yet available in this portal."],
    ["Nenhum evento, alerta ou atividade é inferido do histórico deste navegador.","No event, alert, or activity is inferred from this browser's history."],
    ["Assinaturas, cobranças e documentos.","Subscriptions, charges, and documents."],
    ["Assinaturas pagas","Paid subscriptions"],
    ["Indisponíveis","Unavailable"],
    ["Preços e limites comerciais","Prices and commercial limits"],
    ["Em definição","Being defined"],
    ["Não há cobrança, cartão cadastrado ou renovação confirmada para mostrar. Métodos de pagamento, recibos e notas fiscais dependerão do serviço de faturamento.","No verified charge, saved card, or renewal is available to display. Payment methods, receipts, and invoices require the billing service."],
    ["Entenda e gerencie os dados da sua conta.","Understand and manage your account data."],
    ["Exportar dados da conta","Export account data"],
    ["Indisponível no portal","Unavailable in this portal"],
    ["Excluir conta","Delete account"],
    ["Exportação e exclusão precisam de autenticação, confirmação e autorização do serviço responsável. Encerrar uma sessão não exclui sua conta nem arquivos locais.","Export and deletion require authentication, confirmation, and authorization by the responsible service. Ending a session does not delete your account or local files."],
    ["Seu próximo ponto de acesso ao sistema.","Your next point of access to the system."],
    ["A mesma identidade OrdaX, com recursos e permissões do seu espaço.","The same OrdaX identity, with your workspace's features and permissions."],
    ["A página de acesso verifica a sessão e informa a disponibilidade do sistema Web. Arquivos locais exigem um dispositivo autorizado e online.","The entry page verifies your session and reports Web availability. Local files require an authorized online device."],
    ["Encontre informações para continuar.","Find information to continue."],
    ["Downloads e preparação do OrdaX","OrdaX downloads and setup"],
    ["Licenças e conformidade","Licenses and compliance"],
    ["Conhecer o ecossistema OrdaX","Explore the OrdaX ecosystem"],
    ["Atendimento e canais de contato serão exibidos quando estiverem disponíveis.","Support and contact channels will be shown when available."],
    ["Nenhuma seção encontrada","No section found"],
    ["Tente buscar por plano, segurança, dispositivos ou privacidade.","Try searching for plans, security, devices, or privacy."],
    ["Conta","Account"],
    ["Mais","More"],
    ["Dados, assinatura, pagamentos e consumo em um só lugar.", "Your data, subscription, payments and usage in one place."],
    ["Seus dados, planos e consumo.", "Your data, plans and usage."],
    ["GERENCIAR CONTA", "MANAGE ACCOUNT"],
    ["Resumo", "Overview"],
    ["Dados pessoais", "Personal information"],
    ["Consumo e limites", "Usage and limits"],
    ["Pagamentos e faturas", "Payments and invoices"],
    ["Segurança e acesso", "Security and access"],
    ["Integrações autorizadas", "Authorized integrations"],
    ["Preferências da conta", "Account preferences"],
    ["Atividade da conta", "Account activity"],
    ["AJUDA", "HELP"],
    ["IDENTIDADE ORDAX", "ORDAX IDENTITY"],
    ["Seu perfil, suas escolhas.", "Your profile, your choices."],
    ["Gerencie seus dados e a proteção da sua conta em um único lugar.", "Manage your details and account security in one place."],
    ["Consulte os planos disponíveis e a situação da sua assinatura.", "View available plans and your subscription status."],
    ["Métodos de pagamento, cobranças e documentos da conta.", "Payment methods, charges and account documents."],
    ["Acompanhe os recursos associados à sua conta.", "Track resources linked to your account."],
    ["Uso de IA", "AI usage"],
    ["Não disponível", "Unavailable"],
    ["Não verificado", "Not verified"],
    ["APIs e serviços", "APIs and services"],
    ["Os consumos, quotas, créditos e limites são mostrados somente quando confirmados pelos serviços responsáveis. Este portal não estima nem simula métricas.", "Usage, quotas, credits and limits are shown only when verified by the responsible services. This portal does not estimate or simulate metrics."],
    ["Identidade e informações cadastrais.", "Identity and registration details."],
    ["Seu e-mail pode ser consultado na sessão autenticada. A edição de nome, foto e outros dados exige o serviço oficial de perfil, ainda não disponível nesta página.", "Your email can be viewed in the authenticated session. Editing your name, photo or other details requires the official profile service, which is not yet available on this page."],
    ["Consultar sessão verificada", "View verified session"],
    ["Atalhos da Minha Conta", "My Account shortcuts"],
    ["Assinatura", "Subscription"],
    ["Consumo", "Usage"],
    ["O gerenciamento das conexões autorizadas ainda não está disponível nesta área da conta.", "Managing authorized connections is not yet available in this account area."],
    ["MINHA CONTA", "MY ACCOUNT"],
    ["CENTRAL DA CONTA", "ACCOUNT CENTER"],
    ["ASSINATURA", "SUBSCRIPTION"],
    ["SUA ASSINATURA ORDAX", "YOUR ORDAX SUBSCRIPTION"],
    ["Sua conta", "Your account"],
    ["Meu perfil", "My profile"],
    ["Conta autenticada", "Authenticated account"],
    ["Sessão verificada", "Verified session"],
    ["Verificar sessão", "Verify session"],
    ["Sessão neste navegador", "Session in this browser"],
    ["Esta consulta confirma apenas a sessão atual. Não lista outros dispositivos.", "This check only confirms the current session. It does not list other devices."],
    ["Para encerrar esta sessão, abra seu perfil no cabeçalho e escolha Sair da conta.", "To end this session, open your profile in the header and choose Sign out of account."],
    ["Recursos pendentes", "Pending features"],
    ["Conexão parcial", "Partial connection"],
    ["Verificado", "Verified"],
    ["O serviço de notificações ainda não está conectado.", "The notification service is not connected yet."],
    ["As notificações serão exibidas quando o serviço oficial estiver disponível.", "Notifications will appear when the official service is available."],
    ["A seção Plano e assinatura reunirá seu plano e seus benefícios quando o serviço oficial estiver disponível.", "Plan and subscription will bring together your plan and benefits when the official service is available."],
    ["Os filtros da seção Consumo e limites já estão disponíveis para avaliação. Os valores dependem do serviço oficial de medição de uso.", "Filters in Usage and limits are available for evaluation. Values depend on the official usage metering service."],
    ["Segurança e acesso confirma a sessão deste navegador. Senha, verificação em duas etapas e lista de dispositivos aguardam serviços públicos específicos.", "Security and access confirms this browser session. Password, two-step verification and device list await specific public services."],
    ["Alguns recursos desta seção ainda dependem de serviços públicos OrdaX. Assinatura, pagamentos e consumo não são presumidos.", "Some features in this section still depend on OrdaX public services. Subscription, payments and usage are not assumed."],
    ["Sua identidade e seus serviços.", "Your identity and your services."],
    ["A sessão usa o serviço oficial de identidade. Perfil completo, assinatura e consumo aguardam suas integrações.", "The session uses the official identity service. Full profile, subscription and usage await their integrations."],
    ["A sessão atual não identifica todos os dispositivos. A lista depende do serviço público de dispositivos OrdaX.", "The current session does not identify all devices. The list depends on the OrdaX public device service."],
    ["Sua identidade OrdaX", "Your OrdaX identity"],
    ["Uma conta. Todos os seus mundos.", "One account. All your worlds."],
    ["Uma identidade para todo o seu universo.", "One identity for your entire universe."],
    ["Uma identidade em todo o ecossistema OrdaX.", "One identity across the OrdaX ecosystem."],
    ["Sua identidade, assinatura e recursos.", "Your identity, subscription and resources."],
    ["Sua identidade, assinatura e recursos em um só lugar.", "Your identity, subscription and resources in one place."],
    ["Tudo em um só lugar.", "All in one place."],
    ["Paisagem OrdaX com montanhas e um planeta luminoso", "OrdaX landscape with mountains and a luminous planet"],
    ["Montanhas sob um planeta azul", "Mountains beneath a blue planet"],
    ["Universo OrdaX", "OrdaX universe"],
    ["Símbolo OrdaX", "OrdaX symbol"],
    ["Expandir menu", "Expand menu"],
    ["Recolher menu", "Collapse menu"],
    ["Menu da conta", "Account menu"],
    ["Navegação móvel", "Mobile navigation"],
    ["Mais opções", "More options"],
    ["Precisa de ajuda?", "Need help?"],
    ["Notificações", "Notifications"],
    ["Ajuda", "Help"],
    ["Seu perfil e suas informações cadastrais.", "Your profile and registration information."],
    ["Seu plano, benefícios e opções de assinatura.", "Your plan, benefits and subscription options."],
    ["Acompanhe seus recursos em todo o ecossistema OrdaX.", "Track your resources across the OrdaX ecosystem."],
    ["Métodos de pagamento, cobranças e documentos fiscais.", "Payment methods, charges and tax documents."],
    ["Proteja sua identidade e controle o acesso à sua conta.", "Protect your identity and control access to your account."],
    ["Dispositivos e sessões vinculados à sua conta.", "Devices and sessions linked to your account."],
    ["Seus dados, suas escolhas. Você está no controle.", "Your data, your choices. You are in control."],
    ["Personalize a experiência da sua conta.", "Customize your account experience."],
    ["Histórico de acesso e alterações importantes.", "Sign-in history and important changes."],
    ["Encontre respostas e cuide da sua experiência OrdaX.", "Find answers and manage your OrdaX experience."],
    ["Seu plano", "Your plan"],
    ["Seu plano e seus benefícios", "Your plan and benefits"],
    ["ficam disponíveis aqui.", "will be available here."],
    ["Ver perfil", "View profile"],
    ["Membro desde", "Member since"],
    ["Aguardando conexão", "Awaiting connection"],
    ["Status da conta", "Account status"],
    ["Não conectada", "Not connected"],
    ["Não conectado", "Not connected"],
    ["Conectado", "Connected"],
    ["Ativo", "Active"],
    ["Aguardando serviço", "Awaiting service"],
    ["Consumo de recursos", "Resource usage"],
    ["Ver consumo", "View usage"],
    ["Faturamento", "Billing"],
    ["Ver faturamento", "View billing"],
    ["Próxima cobrança", "Next charge"],
    ["Sua segurança", "Your security"],
    ["Ver segurança", "View security"],
    ["Mantenha sua identidade protegida", "Keep your identity protected"],
    ["em todos os seus dispositivos.", "across all your devices."],
    ["Todo o controle, em um lugar.", "All your controls in one place."],
    ["Seu próximo passo é conectar sua conta.", "Your next step is to connect your account."],
    ["Perfil, assinatura e consumo serão exibidos quando os serviços OrdaX estiverem integrados.", "Your profile, subscription and usage will appear when OrdaX services are integrated."],
    ["O seu universo está pronto", "Your universe is ready"],
    ["Encontre uma área da sua conta.", "Find an area of your account."],
    ["O que você está procurando?", "What are you looking for?"],
    ["Nenhuma área encontrada.", "No area found."],
    ["Nenhuma notificação disponível", "No notifications available"],
    ["Conta não conectada", "Account not connected"],
    ["Suas notificações aparecerão quando a conta estiver conectada.", "Your notifications will appear when your account is connected."],
    ["Seu perfil e sua sessão aparecerão aqui após a integração com os serviços OrdaX.", "Your profile and session will appear here after integration with OrdaX services."],
    ["Os serviços de identidade ainda não estão conectados.", "Identity services are not connected yet."],
    ["Os serviços da conta ainda não estão conectados. Nenhuma informação de assinatura, pagamento ou consumo está disponível.", "Account services are not connected yet. Subscription, payment and usage information is unavailable."],
    ["Identidade e conta OrdaX", "OrdaX identity and account"],
    ["Identidade OrdaX", "OrdaX identity"],
    ["Direitos e assinaturas OrdaX", "OrdaX entitlements and subscriptions"],
    ["Medição de uso OrdaX", "OrdaX usage metering"],
    ["Faturamento OrdaX", "OrdaX billing"],
    ["Sessões e dispositivos OrdaX", "OrdaX sessions and devices"],
    ["Privacidade OrdaX", "OrdaX privacy"],
    ["Auditoria da conta OrdaX", "OrdaX account audit"],
    ["Prontidão da integração", "Integration readiness"],
    ["FONTE OFICIAL DESTA SEÇÃO", "OFFICIAL SOURCE FOR THIS SECTION"],
    ["Perfil autenticado", "Authenticated profile"],
    ["Resumo do plano", "Plan summary"],
    ["Indicadores de consumo", "Usage indicators"],
    ["Leitura do perfil", "Profile access"],
    ["Edição de dados cadastrais", "Registration information editing"],
    ["Foto de perfil", "Profile photo"],
    ["Plano contratado", "Subscribed plan"],
    ["Catálogo oficial de planos", "Official plan catalog"],
    ["Alteração e cancelamento", "Changes and cancellation"],
    ["Créditos de IA", "AI credits"],
    ["Chamadas de API", "API calls"],
    ["Histórico por período", "History by period"],
    ["Métodos de pagamento", "Payment methods"],
    ["Faturas e recibos", "Invoices and receipts"],
    ["Dados fiscais", "Tax information"],
    ["Eventos de acesso", "Sign-in events"],
    ["Sessões ativas", "Active sessions"],
    ["Dispositivos OrdaX OS", "OrdaX OS devices"],
    ["Encerramento remoto", "Remote sign-out"],
    ["Exportação de dados", "Data export"],
    ["Consentimentos", "Consents"],
    ["Exclusão da conta", "Account deletion"],
    ["Alterações de conta", "Account changes"],
    ["Filtros por período", "Period filters"],
    ["Disponível após conectar a conta", "Available after connecting your account"],
    ["Seu perfil", "Your profile"],
    ["Sua imagem no OrdaX Web e OS.", "Your photo in OrdaX Web and OS."],
    ["Alterar foto", "Change photo"],
    ["Nome completo", "Full name"],
    ["Seu nome", "Your name"],
    ["Nome de exibição", "Display name"],
    ["Como você gostaria de ser chamado", "What would you like to be called?"],
    ["Seu e-mail", "Your email"],
    ["Telefone", "Phone"],
    ["Seu telefone", "Your phone number"],
    ["País ou região", "Country or region"],
    ["Documento fiscal", "Tax document"],
    ["Seus dados pessoais permanecem protegidos.", "Your personal information remains protected."],
    ["Salvar alterações", "Save changes"],
    ["Seu universo de possibilidades.", "Your universe of possibilities."],
    ["Informações de plano, benefícios e renovação", "Plan information, benefits and renewals"],
    ["estarão reunidas aqui.", "will be gathered here."],
    ["Informações de plano, benefícios e renovação estarão reunidas aqui.", "Plan information, benefits and renewals will be gathered here."],
    ["Plano não disponível", "Plan unavailable"],
    ["Detalhes da assinatura", "Subscription details"],
    ["Sem plano ou cobrança presumidos.", "No assumed plan or charges."],
    ["Ciclo de cobrança", "Billing cycle"],
    ["Próxima renovação", "Next renewal"],
    ["Valor da assinatura", "Subscription price"],
    ["Alterar plano", "Change plan"],
    ["Cancelar assinatura", "Cancel subscription"],
    ["Planos e benefícios", "Plans and benefits"],
    ["Catálogo de planos não conectado", "Plan catalog not connected"],
    ["A comparação de planos, preços e limites será exibida a partir do catálogo oficial OrdaX.", "Plan, price and limit comparisons will use the official OrdaX catalog."],
    ["Período de consumo", "Usage period"],
    ["Últimos 7 dias", "Last 7 days"],
    ["Últimos 30 dias", "Last 30 days"],
    ["Este ano", "This year"],
    ["Uso e limite indisponíveis", "Usage and limit unavailable"],
    ["Utilização", "Usage"],
    ["Sem dados conectados", "No connected data"],
    ["Exportar", "Export"],
    ["Os filtros alteram o período de consulta. Nenhuma métrica é estimada sem dados oficiais.", "Filters change the query period. No metric is estimated without official data."],
    ["Valor e data não disponíveis", "Amount and date unavailable"],
    ["Método de pagamento", "Payment method"],
    ["Nenhum método disponível para consulta.", "No payment method available to view."],
    ["Adicionar método", "Add method"],
    ["Histórico de faturamento", "Billing history"],
    ["Baixar faturas", "Download invoices"],
    ["Documento", "Document"],
    ["Data", "Date"],
    ["Valor", "Amount"],
    ["Nenhuma fatura disponível", "No invoices available"],
    ["Faturas, recibos e histórico de cobranças aparecerão após a conexão com o faturamento.", "Invoices, receipts and charge history will appear after billing is connected."],
    ["Nome ou razão social", "Personal or company name"],
    ["CPF ou CNPJ", "Brazilian individual or company tax ID"],
    ["Endereço de faturamento", "Billing address"],
    ["E-mail de faturamento", "Billing email"],
    ["Salvar dados fiscais", "Save tax information"],
    ["Senha de acesso", "Account password"],
    ["Altere a senha que protege sua conta.", "Change the password that protects your account."],
    ["Alterar senha", "Change password"],
    ["Uma camada extra de proteção para sua identidade.", "An extra layer of protection for your identity."],
    ["Status não disponível", "Status unavailable"],
    ["Configurar", "Configure"],
    ["Recuperação da conta", "Account recovery"],
    ["Gerencie o e-mail de recuperação da sua conta.", "Manage your account recovery email."],
    ["Gerenciar", "Manage"],
    ["Histórico de acesso", "Sign-in history"],
    ["Histórico de segurança não disponível", "Security history unavailable"],
    ["Os eventos de acesso serão consultados pelo serviço de identidade OrdaX.", "Sign-in events will be retrieved from the OrdaX identity service."],
    ["Dispositivos autorizados", "Authorized devices"],
    ["OrdaX OS, Web e dispositivos móveis.", "OrdaX OS, Web and mobile devices."],
    ["Encerrar outras sessões", "Sign out of other sessions"],
    ["Nenhuma sessão disponível para consulta", "No sessions available to view"],
    ["Não é possível identificar dispositivos conectados antes da integração com os serviços de autenticação.", "Connected devices cannot be identified before authentication services are integrated."],
    ["Privacidade e consentimentos", "Privacy and consent"],
    ["Dados essenciais", "Essential data"],
    ["Dados necessários para o funcionamento e a segurança da conta.", "Data required for account operation and security."],
    ["Análise de uso", "Usage analysis"],
    ["Consentimento para informações que ajudam a melhorar o OrdaX.", "Consent to information that helps improve OrdaX."],
    ["Comunicações personalizadas", "Personalized communications"],
    ["Preferências de comunicação vinculadas à sua identidade.", "Communication preferences linked to your identity."],
    ["Exportar meus dados", "Export my data"],
    ["Uma cópia das suas informações pessoais e do histórico da conta.", "A copy of your personal information and account history."],
    ["Solicitar exportação", "Request export"],
    ["A exclusão permanente requer autenticação e confirmação da sua identidade.", "Permanent deletion requires authentication and identity confirmation."],
    ["Excluir minha conta", "Delete my account"],
    ["Prévia de preferências nesta sessão. Alterações não são salvas na conta.", "Preferences preview in this session. Changes are not saved to your account."],
    ["Idioma e região", "Language and region"],
    ["Idioma preferido para sua conta, quando o serviço estiver conectado.", "Your preferred account language when the service is connected."],
    ["Idioma preferido", "Preferred language"],
    ["Aparência", "Appearance"],
    ["Identidade visual OrdaX.", "OrdaX visual identity."],
    ["Escuro", "Dark"],
    ["Notificações e comunicações", "Notifications and communications"],
    ["Segurança da conta", "Account security"],
    ["Alertas de acesso e alterações importantes.", "Alerts about sign-ins and important changes."],
    ["Consumo e assinatura", "Usage and subscription"],
    ["Atualizações de recursos, limites e faturamento.", "Updates on resources, limits and billing."],
    ["Novidades OrdaX", "OrdaX news"],
    ["Lançamentos e novidades do ecossistema.", "Ecosystem releases and news."],
    ["Prévia local · não persistida", "Local preview · not persisted"],
    ["Restaurar prévia", "Reset preview"],
    ["Histórico da conta", "Account history"],
    ["Período de atividade", "Activity period"],
    ["Nenhuma atividade disponível", "No activity available"],
    ["Como podemos ajudar?", "How can we help?"],
    ["Busque por assinatura, segurança, faturas...", "Search subscriptions, security, invoices..."],
    ["Buscar ajuda", "Search help"],
    ["Perguntas frequentes", "Frequently asked questions"],
    ["Nenhuma resposta encontrada. Tente outro termo.", "No answer found. Try another term."],
    ["Precisa de uma ajuda a mais?", "Need more help?"],
    ["Atendimento dedicado à sua conta OrdaX.", "Support for your OrdaX account."],
    ["Falar com o suporte", "Contact support"],
    ["Atendimento não conectado", "Support not connected"],
    ["O canal oficial de suporte ainda não foi configurado. Nenhuma solicitação foi enviada.", "The official support channel has not been configured yet. No request was sent."],
    ["Entendi", "Understood"],
    ["Onde encontro meu plano e minha assinatura?", "Where can I find my plan and subscription?"],
    ["A seção Plano e assinatura reúne o plano contratado, os benefícios e as opções de alteração. Essas informações dependem da conexão com o serviço de assinatura OrdaX.", "The Plan and subscription section brings together your subscribed plan, benefits and change options. This information requires a connection to the OrdaX subscription service."],
    ["Como acompanho meu consumo de IA?", "How can I track my AI usage?"],
    ["Na seção Consumo e limites, você pode filtrar o período e consultar inteligência artificial, armazenamento e APIs. Sem uma conexão com os serviços, nenhum valor é estimado ou inventado.", "In Usage and limits, you can filter the period and view AI, storage and APIs. Without connected services, no values are estimated or invented."],
    ["Como acesso minhas faturas?", "How can I access my invoices?"],
    ["Pagamentos e faturas reúne documentos fiscais e cobranças. Faturas e recibos poderão ser baixados quando o serviço de faturamento estiver integrado.", "Payments and invoices brings together tax documents and charges. Invoices and receipts can be downloaded when the billing service is integrated."],
    ["Como protejo minha conta?", "How can I protect my account?"],
    ["Em Segurança e acesso você encontra os controles de senha e verificação em duas etapas. Meus dispositivos permite consultar sessões autorizadas quando os serviços de identidade estiverem disponíveis.", "Security and access contains password and two-step verification controls. My devices lets you view authorized sessions when identity services are available."],
    ["Posso exportar ou excluir meus dados?", "Can I export or delete my data?"],
    ["Os controles ficam em Dados e privacidade. Para sua proteção, a exportação e a exclusão exigem uma conta autenticada e o serviço de privacidade conectado.", "These controls are in Data and privacy. For your protection, export and deletion require an authenticated account and a connected privacy service."],
    ["Prévia do novo layout da central Minha Conta OrdaX para avaliação.", "Preview of the new OrdaX My Account center layout for evaluation."],
    ["Minha Conta — Prévia 2 — OrdaX OS", "My Account — Preview 2 — OrdaX OS"],
    ["OrdaX OS — início", "OrdaX OS — home"],
    ["Navegação da conta", "Account navigation"],
    ["Localização", "Location"],
    ["Todas as áreas da conta", "All account areas"],
    ["Prévia 2 · Conta oficial", "Preview 2 · Official account"],
    ["Serviços não conectados", "Services not connected"],
    ["Abrir Conta oficial", "Open official account"],
    ["Esta prévia precisa de JavaScript para exibir as seções da conta.", "This preview requires JavaScript to display account sections."],
    ["Prévia 2", "Preview 2"],
    ["Armazenamento", "Storage"],
    ["Central de ajuda", "Help center"],
    ["IA", "AI"],
    ["APIs", "APIs"],
    ["English", "English"],
    ["Español", "Español"],
    ["Gerencie sua identidade, assinatura, segurança e preferências na Conta OrdaX.", "Manage your identity, subscription, security and preferences in your OrdaX Account."],
    ["Ative o JavaScript para acessar as seções da sua conta.", "Enable JavaScript to access your account sections."],
    ["Voltar ao site", "Return to site"],
    ["O idioma deste navegador é salvo pelas preferências oficiais do site.", "This browser language is saved by the official site preferences."],
    ["Preferências da conta estarão disponíveis quando o serviço oficial estiver conectado.", "Account preferences will be available when the official service is connected."],
    ["Contas conectadas e autorizações de aplicativos.", "Connected accounts and app authorizations."],
    ["Integrações OrdaX", "OrdaX integrations"],
    ["Conexões autorizadas", "Authorized connections"],
    ["Revogação de conexões", "Revoke connections"],
    ["Integrações não disponíveis", "Integrations unavailable"],
    ["As conexões autorizadas serão exibidas pelo serviço oficial de integrações.", "Authorized connections will be shown by the official integrations service."],
    ["Minha Conta — OrdaX OS", "My Account — OrdaX OS"],
    ["Integrações", "Integrations"],
  ];

  const SEMANTIC = Object.freeze({
    "account.usage.unavailablePeriod": ["Dados indisponíveis · {period}", "Data unavailable · {period}"],
    "account.activity.period": ["O histórico de “{period}” será exibido quando o serviço de atividade estiver conectado.", "History for “{period}” will appear when the activity service is connected."],
    "account.mobile.navigation": ["Navegação da conta no celular", "Mobile account navigation"],
    "account.search.matches": ["Seções encontradas: {count}.", "Sections found: {count}."],
    "web.entry.checking.title": ["Verificando disponibilidade", "Checking availability"],
    "web.entry.checking.detail": ["Consultando sua sessão e o acesso ao OrdaX Web.", "Checking your session and access to OrdaX Web."],
    "web.entry.anonymous.title": ["Entre para continuar", "Sign in to continue"],
    "web.entry.anonymous.detail": ["Use sua Conta OrdaX para consultar o acesso ao Web.", "Use your OrdaX Account to check Web access."],
    "web.entry.ready.title": ["Seu espaço está disponível", "Your workspace is available"],
    "web.entry.ready.detail": ["Abra o OrdaX Web para continuar. As permissões são verificadas pelo sistema.", "Open OrdaX Web to continue. The system verifies your permissions."],
    "web.entry.pending.title": ["OrdaX Web em preparação", "OrdaX Web is being prepared"],
    "web.entry.pending.detail": ["Sua sessão está ativa. A entrada do produto Web ainda não está disponível neste site.", "Your session is active. The Web product entry is not available on this website yet."],
    "web.entry.error.title": ["Não foi possível verificar o acesso", "We could not verify access"],
    "web.entry.error.detail": ["Tente novamente. Nenhum espaço ou dado pessoal será aberto sem verificação.", "Try again. No workspace or personal data will open without verification."],
    "account.navigation.account": ["Minha conta", "My account"],
    "playground.note.initialTitle": ["Uma ideia começa aqui", "An idea starts here"],
    "playground.note.initialBody": ["Um espaço para pensar com calma.\n\nEscreva algo aqui e veja sua ideia aparecer na outra tela.", "A space to think calmly.\n\nWrite something here and watch your idea appear on the other screen."],
    "playground.appsOnDevice": ["Apps no {device}", "Apps on {device}"],
    "playground.appOnDevice": ["{app} no {device}", "{app} on {device}"],
    "playground.noteTitleOnDevice": ["Título da nota no {device}", "Note title on {device}"],
    "playground.noteBodyOnDevice": ["Texto da nota no {device}", "Note text on {device}"],
    "playground.changeOnDevice": ["Alteração no {device} refletida nas duas telas. Simulação local.", "Change on {device} reflected on both screens. Local simulation."],
    "locale.selector.label": ["Idioma", "Language"],
    "locale.selector.pt-BR": ["Português (Brasil)", "Português (Brasil)"],
    "locale.selector.en-US": ["Inglês (EUA)", "English (US)"],
    "identity.login.ready.title": ["Acesso disponível", "Sign-in available"],
    "identity.login.ready.detail": ["Continue para o serviço seguro de identidade OrdaX.", "Continue to the secure OrdaX identity service."],
    "identity.login.gated.title": ["Acesso temporariamente indisponível", "Sign-in temporarily unavailable"],
    "identity.login.gated.detail": ["Não foi possível liberar o acesso agora. Tente novamente mais tarde.", "Sign-in could not be enabled right now. Please try again later."],
    "identity.register.ready.title": ["Cadastro disponível", "Registration available"],
    "identity.register.ready.detail": ["Continue para o serviço seguro de criação da conta OrdaX.", "Continue to the secure OrdaX account creation service."],
    "identity.register.gated.title": ["Cadastro temporariamente indisponível", "Registration temporarily unavailable"],
    "identity.register.gated.detail": ["Não foi possível liberar o cadastro agora. Tente novamente mais tarde.", "Registration could not be enabled right now. Please try again later."],
    "identity.recover.ready.title": ["Recuperação disponível", "Recovery available"],
    "identity.recover.ready.detail": ["Informe o e-mail da Conta OrdaX para receber as instruções de recuperação.", "Enter the OrdaX Account email to receive recovery instructions."],
    "identity.recover.gated.title": ["Recuperação temporariamente indisponível", "Recovery temporarily unavailable"],
    "identity.recover.gated.detail": ["Não foi possível liberar a recuperação agora. Tente novamente mais tarde.", "Recovery could not be enabled right now. Please try again later."],
    "identity.recoverComplete.ready.title": ["Sessão de recuperação validada", "Recovery session validated"],
    "identity.recoverComplete.ready.detail": ["Defina e confirme a nova credencial para concluir a recuperação.", "Set and confirm the new credential to complete recovery."],
    "identity.recoverComplete.gated.title": ["Alteração de senha indisponível", "Password change unavailable"],
    "identity.recoverComplete.gated.detail": ["Não foi possível liberar a alteração de senha agora. Tente novamente mais tarde.", "Password changes could not be enabled right now. Please try again later."],
    "account.session.checking.title": ["Verificando sua sessão", "Verifying your session"],
    "account.session.checking.detail": ["Consultando o serviço oficial de identidade.", "Checking the official identity service."],
    "account.session.active.title": ["Sessão ativa e verificada", "Active, verified session"],
    "account.session.active.detail": ["Sua Conta OrdaX está autenticada neste navegador.", "Your OrdaX Account is authenticated in this browser."],
    "account.session.anonymous.title": ["Sessão não iniciada", "Session not started"],
    "account.session.anonymous.detail": ["Entre na sua Conta OrdaX para continuar.", "Sign in to your OrdaX Account to continue."],
    "account.session.unavailable.title": ["Verificação de sessão indisponível", "Session verification unavailable"],
    "account.session.unavailable.detail": ["O serviço de autenticação não respondeu corretamente. Seus dados continuam protegidos.", "The authentication service did not respond correctly. Your data remains protected."],
    "account.session.emailUnavailable": ["E-mail não disponível", "Email unavailable"],
    "account.session.leaving.title": ["Saindo da conta", "Signing out"],
    "account.session.leaving.detail": ["Aguardando o serviço de identidade encerrar esta sessão.", "Waiting for the identity service to end this session."],
    "identity.unavailable.title": ["Indisponível", "Unavailable"],
    "identity.unavailable.detail": ["Este fluxo não está configurado.", "This flow is not configured."],
    "download.action": ["Baixar", "Download"],
    "compliance.open": ["Abrir", "Open"],
    "compliance.thirdParty.label": ["Avisos e licenças de terceiros", "Third-party notices and licenses"],
    "compliance.thirdParty.action": ["Avisos", "Notices"],
    "compliance.source.label": ["Pacote de código-fonte aplicável", "Applicable source-code package"],
    "compliance.source.action": ["Código-fonte", "Source code"],
    "compliance.heading": ["CONFORMIDADE DA RELEASE", "RELEASE COMPLIANCE"],
    "compliance.intro": ["Inventário, avisos e pacote de código-fonte vinculados aos mesmos bytes publicados.", "Inventory, notices, and source-code package bound to the same published bytes."],
    "release.public": ["release pública", "public release"],
    "download.empty.title": ["Nenhuma release pública disponível", "No public release available"],
    "download.empty.detail": ["O catálogo está ativo, mas nenhuma release passou ainda pelos gates de integridade, publicação e conformidade.", "The catalog is active, but no release has yet passed the integrity, publication, and compliance gates."],
    "download.ready.title": ["Releases públicas verificadas", "Verified public releases"],
    "download.ready.detail": ["Os downloads abaixo incluem integridade e material de conformidade vinculados à mesma release.", "The downloads below include integrity and compliance material bound to the same release."],
    "download.error.title": ["Catálogo temporariamente indisponível", "Catalog temporarily unavailable"],
    "download.error.detail": ["Nenhum download será oferecido até a fonte autorizada de releases responder corretamente.", "No download will be offered until the authorized release source responds correctly."],
    "compliance.empty.title": ["Nenhuma release pública ainda", "No public release yet"],
    "compliance.empty.detail": ["Quando a primeira release for autorizada, SBOM, avisos de terceiros e código-fonte aplicável aparecerão aqui.", "When the first release is authorized, its SBOM, third-party notices, and applicable source code will appear here."],
    "compliance.ready.title": ["Conformidade publicada por release", "Compliance published per release"],
    "compliance.ready.detail": ["Cada conjunto abaixo está vinculado por tamanho e SHA-256 à release pública correspondente.", "Each set below is bound by size and SHA-256 to the corresponding public release."],
    "compliance.error.title": ["Catálogo de conformidade indisponível", "Compliance catalog unavailable"],
    "compliance.error.detail": ["Nenhum material será anunciado até a fonte autorizada responder corretamente.", "No material will be announced until the authorized source responds correctly."]
  });

  const messages = {
    "pt-BR": Object.create(null),
    "en-US": Object.create(null),
  };
  const sourceIndex = Object.create(null);

  function register(id, ptBR, enUS) {
    if (messages["pt-BR"][id] !== undefined || messages["en-US"][id] !== undefined) {
      throw new Error(`duplicate-public-site-message-id:${id}`);
    }
    messages["pt-BR"][id] = ptBR;
    messages["en-US"][id] = enUS;
    if (sourceIndex[ptBR] === undefined) sourceIndex[ptBR] = id;
  }

  register("landing.navigation.control", "Controle e segurança", "Control and security");
  register("landing.navigation.questions", "Dúvidas", "Questions");

  register("identity.javascriptRequired", "Ative o JavaScript para acessar sua conta. Os links de privacidade e termos continuam disponíveis.", "Enable JavaScript to access your account. Privacy and terms links remain available.");
  register("identity.layoutPreview.title", "Prévia de layout", "Layout preview");
  register("identity.layoutPreview.detail", "Somente leitura. Nenhum dado é enviado e nenhuma sessão é iniciada.", "Read only. No data is sent and no session is started.");

  register("account.help.resultCount", "Resultados: {count}", "Results: {count}");
  register("account.help.channel", "Atendimento da conta", "Account support");
  register("account.help.intro", "Busque uma resposta ou vá direto à área da sua conta.", "Find an answer or go straight to the relevant account area.");
  register("account.help.shortcuts", "Atalhos de ajuda", "Help shortcuts");
  register("account.help.clear", "Limpar busca de ajuda", "Clear help search");
  register("account.help.empty", "Nenhuma resposta encontrada", "No answers found");
  register("account.help.emptyHint", "Tente buscar por plano, fatura, senha ou dados.", "Try searching for plan, invoice, password or data.");
  register("account.help.reset", "Ver todas as perguntas", "View all questions");
  register("account.help.support", "Atendimento OrdaX", "OrdaX support");
  register("account.help.pending", "O canal de atendimento ainda não está conectado. Por enquanto, nenhuma solicitação pode ser enviada por aqui.", "The support channel is not connected yet. For now, requests cannot be sent here.");
  register("account.help.availability", "Consultar atendimento", "Check support availability");
  register("account.help.usageAnswer", "Em Consumo e limites, escolha o recurso e o período que deseja consultar. Os valores serão exibidos quando a medição de uso estiver conectada.", "In Usage and limits, choose the resource and period you want to view. Values will appear when usage metering is connected.");
  register("account.help.securityAnswer", "Consulte a sessão deste navegador em Segurança e acesso. Alteração de senha, verificação em duas etapas e recuperação ainda aguardam integração.", "View this browser session in Security and access. Password changes, two-step verification and recovery still await integration.");
  register("account.activity.intro", "Acessos e alterações da sua conta, organizados por período.", "Account sign-ins and changes, organized by period.");
  register("account.activity.unavailable", "Histórico ainda não disponível", "History not yet available");
  register("account.activity.unknown", "Sem acesso ao histórico, não é possível confirmar a ausência de eventos neste período.", "Without access to the history, it is not possible to confirm that no events occurred during this period.");
  register("account.activity.related", "Acesso e proteção", "Access and protection");

  register("account.subscription.limitsTitle", "Limites da conta", "Account limits");
  register("account.subscription.preparation", "Em preparação", "In preparation");
  register("account.subscription.pricePending", "Preço não publicado", "Price not published");
  register("account.subscription.benefitsPending", "Os benefícios e limites comerciais ainda não estão disponíveis para consulta.", "Commercial benefits and limits are not yet available to view.");
  register("account.subscription.select", "Selecionar plano", "Select plan");
  register("account.subscription.currentPending", "Seu plano será exibido quando os dados da assinatura estiverem disponíveis.", "Your plan will appear when subscription details are available.");
  register("account.subscription.changesPending", "Alterações e cancelamento aguardam a conexão com o serviço de assinatura.", "Changes and cancellation await connection to the subscription service.");
  register("account.subscription.usageLink", "Ver consumo", "View usage");
  register("account.subscription.limitsIntro", "Consulte a capacidade disponível para cada recurso da sua conta.", "View the capacity available for each account resource.");
  register("account.subscription.limitsPending", "Os limites serão exibidos quando os benefícios da conta estiverem conectados.", "Limits will appear when account benefits are connected.");
  register("account.subscription.compareIntro", "Compare as opções quando o catálogo oficial estiver disponível.", "Compare the options when the official catalog is available.");
  register("account.subscription.related", "Consumo e faturamento", "Usage and billing");

  register("account.billing.summary", "Resumo de pagamento", "Payment summary");
  register("account.billing.amountUnavailable", "Valor não disponível", "Amount unavailable");
  register("account.billing.due", "Vencimento", "Due date");
  register("account.billing.methodsUnavailable", "Métodos não disponíveis", "Payment methods unavailable");
  register("account.billing.methodsPending", "Os métodos cadastrados aparecerão quando o serviço de pagamentos estiver conectado.", "Saved methods will appear when the payment service is connected.");
  register("account.billing.changesPending", "A consulta e as alterações de pagamento aguardam integração.", "Payment viewing and changes await integration.");
  register("account.billing.historyIntro", "Consulte e baixe suas faturas, recibos e documentos de cobrança.", "View and download your invoices, receipts and billing documents.");
  register("account.billing.documentsUnavailable", "Documentos ainda não disponíveis", "Documents not yet available");
  register("account.billing.historyUnknown", "O histórico indisponível não confirma a ausência de cobranças.", "Unavailable history does not confirm that there are no charges.");
  register("account.billing.taxIdentity", "Identificação fiscal", "Tax identification");
  register("account.billing.contactAddress", "Contato e endereço", "Contact and address");
  register("account.billing.related", "Assinatura e consumo", "Subscription and usage");

  register("account.profile.sessionEmail", "E-mail da sessão atual. A alteração ainda não está disponível.", "Email from the current session. Changes are not available yet.");
  register("account.profile.photoIntro", "Uma imagem para identificar seu perfil nos serviços OrdaX.", "An image to identify your profile across OrdaX services.");
  register("account.profile.photoPending", "A alteração da foto aguarda integração.", "Changing your photo awaits integration.");
  register("account.profile.identityIntro", "Como você se identifica nos serviços OrdaX.", "How you identify yourself across OrdaX services.");
  register("account.profile.displayNameHint", "Nome pelo qual você prefere ser chamado.", "The name you prefer to be called.");
  register("account.profile.contactIntro", "Seu e-mail de acesso e suas informações de contato.", "Your sign-in email and contact information.");
  register("account.profile.emailPending", "O e-mail será exibido quando a consulta da conta estiver disponível.", "Your email will appear when account details are available.");
  register("account.profile.phonePending", "A consulta e a edição do telefone aguardam integração.", "Viewing and editing your phone number await integration.");
  register("account.profile.editPending", "As alterações de perfil e contato ainda não estão disponíveis.", "Profile and contact changes are not available yet.");
  register("account.profile.related", "Segurança e privacidade do perfil", "Profile security and privacy");

  register("account.access.sessionScope", "Esta sessão não informa o estado da senha, da verificação em duas etapas ou de outros acessos.", "This session does not indicate the status of your password, two-step verification or other sign-ins.");
  register("account.access.protectionPending", "Os controles de proteção aguardam integração. Não é possível confirmar sua configuração atual.", "Protection controls await integration. Their current configuration cannot be confirmed.");
  register("account.access.relatedPrivacy", "Acesso e privacidade", "Access and privacy");
  register("account.access.devicesIntro", "Consulte os acessos vinculados à sua conta e gerencie outras sessões.", "View access linked to your account and manage other sessions.");
  register("account.access.deviceColumn", "Dispositivo", "Device");
  register("account.access.activityColumn", "Última atividade", "Last activity");
  register("account.access.devicesUnavailable", "Dispositivos ainda não disponíveis", "Devices not yet available");
  register("account.access.revokePending", "A lista e o encerramento remoto de sessões aguardam integração.", "The session list and remote sign-out await integration.");
  register("account.access.relatedHistory", "Proteção e histórico da conta", "Account protection and history");

  register("account.dataAccess.exportPending", "A solicitação de exportação aguarda integração.", "Data export requests await integration.");
  register("account.dataAccess.deletionPending", "A exclusão da conta ainda não está disponível.", "Account deletion is not available yet.");
  register("account.dataAccess.revocationDescription", "Controle o acesso de aplicativos e serviços à sua conta.", "Control how apps and services access your account.");
  register("account.dataAccess.revocationPending", "A revogação de conexões aguarda integração.", "Revoking connections awaits integration.");
  register("account.dataAccess.consentsUnknown", "Os estados de uso de dados ainda não estão disponíveis. Nenhuma escolha é alterada nesta tela.", "Data-use settings are not available yet. No choices are changed on this screen.");
  register("account.dataAccess.preferencesLink", "Ver preferências", "View preferences");
  register("account.dataAccess.manageData", "Gerenciar meus dados", "Manage my data");
  register("account.dataAccess.manageDataIntro", "Solicite uma cópia dos dados ou gerencie a exclusão da conta.", "Request a copy of your data or manage account deletion.");
  register("account.dataAccess.relatedPreferences", "Preferências e acesso aos dados", "Preferences and data access");
  register("account.dataAccess.connectionsIntro", "Consulte os aplicativos autorizados e as permissões de cada conexão.", "View authorized apps and the permissions for each connection.");
  register("account.dataAccess.appColumn", "Aplicativo ou serviço", "App or service");
  register("account.dataAccess.permissionsColumn", "Permissões", "Permissions");
  register("account.dataAccess.connectionsUnavailable", "Conexões ainda não disponíveis", "Connections not yet available");
  register("account.dataAccess.connectionsUnknown", "Sem a consulta, não é possível confirmar quais conexões estão autorizadas.", "Without the lookup, it is not possible to confirm which connections are authorized.");
  register("account.dataAccess.appsAccess", "Acesso dos aplicativos", "App access");
  register("account.dataAccess.relatedAccess", "Acesso e dados da conta", "Account access and data");

  register("account.usage.chartContext", "Histórico indisponível: {resource} · {period}", "History unavailable: {resource} · {period}");
  register("account.usage.related", "Plano e pagamentos", "Plan and payments");
  register("account.preferences.portal", "Preferências do portal", "Portal preferences");
  register("account.preferences.scope", "Idioma e aparência se referem ao navegador atual.", "Language and appearance refer to the current browser.");
  register("account.preferences.related", "Perfil e ajuda", "Profile and help");

  register("account.notifications.unavailable", "Notificações ainda não disponíveis", "Notifications not yet available");

  register("account.shared.verified", "Recursos verificados", "Verified features");
  register("account.shared.pending", "Os recursos marcados como pendentes ainda aguardam integração.", "Features marked as pending still await integration.");
  register("account.shared.locale", "Idioma do portal", "Portal language");
  register("account.shared.appearance", "Aparência do portal", "Portal appearance");
  register("account.shared.communications", "Preferências de comunicação", "Communication preferences");
  register("account.shared.browser", "Neste navegador", "In this browser");
  register("account.shared.local", "Preferências locais", "Local preferences");
  register("account.shared.preferencesOwner", "Preferências OrdaX", "OrdaX preferences");
  register("account.shared.availability", "Os recursos marcados como pendentes ainda aguardam integração. As preferências locais valem somente neste navegador.", "Features marked as pending still await integration. Local preferences apply only in this browser.");
  register("account.shared.accessTypes", "Tipos de acesso", "Access types");
  register("account.shared.mobile", "Dispositivos móveis", "Mobile devices");
  register("account.shared.consents", "Consulte suas escolhas de uso de dados e de comunicação.", "Review your data use and communication choices.");
  register("account.shared.languageHelp", "Escolha o idioma usado neste portal. Esta escolha vale para este navegador.", "Choose the language used in this portal. This choice applies to this browser.");
  register("account.shared.appearanceHelp", "Esta é a aparência atual deste portal.", "This is the current appearance of this portal.");
  register("account.shared.currentVisual", "Visual atual", "Current appearance");
  register("account.shared.connections", "Conexões da conta", "Account connections");
  register("account.shared.manageConnections", "Gerenciar conexões", "Manage connections");
  register("account.shared.revokeConnections", "Revogar conexões", "Revoke connections");

  register("account.details.exportUsage", "Exportação de consumo", "Usage export");
  register("account.details.currentSubscription", "Assinatura atual", "Current subscription");
  register("account.details.subscriptionIntro", "Consulte seu plano, o ciclo de cobrança e a próxima renovação.", "Check your plan, billing cycle, and next renewal.");
  register("account.details.catalogUnavailable", "Catálogo de planos indisponível", "Plan catalog unavailable");
  register("account.details.catalogPending", "Os planos e benefícios serão exibidos aqui quando o catálogo oficial estiver disponível.", "Plans and benefits will appear here when the official catalog is available.");
  register("account.details.resources", "Recursos da conta", "Account resources");
  register("account.details.resourceIntro", "Consulte o uso e os limites de cada recurso.", "Check usage and limits for each resource.");
  register("account.details.usageHistory", "Histórico de utilização", "Usage history");
  register("account.details.usagePending", "Selecione um recurso e um período. Os valores serão exibidos quando a medição estiver conectada.", "Select a resource and a period. Values will appear when usage metering is connected.");
  register("account.details.unverifiedSession", "Sessão não verificada", "Session not verified");
  register("account.details.password", "Senha usada para entrar na sua conta.", "Password used to sign in to your account.");
  register("account.details.protection", "Proteção da conta", "Account protection");
  register("account.details.fiscalIntro", "Informações usadas nos documentos de cobrança.", "Information used on billing documents.");

  register("account.structure.profilePending", "A edição dos dados e da foto ainda não está disponível.", "Profile and photo editing are not available yet.");
  register("account.structure.personalInfo", "Informações pessoais", "Personal information");
  register("account.structure.contact", "Contato", "Contact");
  register("account.structure.navAccount", "Minha conta", "My account");
  register("account.structure.navServices", "Plano e serviços", "Plan and services");
  register("account.structure.navSecurity", "Segurança e privacidade", "Security and privacy");
  register("account.structure.navPreferences", "Preferências e conexões", "Preferences and connections");
  register("account.structure.preview", "Somente visualização. Recursos pendentes estão sinalizados nas seções.", "View only. Pending features are identified in each section.");
  register("account.structure.intro", "Seu perfil, seus serviços e suas escolhas.", "Your profile, services, and choices.");
  register("account.structure.profile", "SEU PERFIL ORDAX", "YOUR ORDAX PROFILE");
  register("account.structure.email", "E-mail não disponível", "Email unavailable");
  register("account.structure.type", "Tipo de conta", "Account type");
  register("account.structure.oneAccount", "Uma conta.", "One account.");
  register("account.structure.services", "Plano e faturamento", "Plan and billing");
  register("account.structure.details", "Ver detalhes", "View details");
  register("account.structure.resource", "Recurso", "Resource");
  register("account.structure.use", "Uso", "Usage");
  register("account.structure.limit", "Limite", "Limit");
  register("account.structure.history", "Histórico de consumo", "Usage history");
  register("account.structure.access", "Acesso e preferências", "Access and preferences");
  register("account.structure.safety", "Cuide do acesso à sua conta e dos dispositivos conectados.", "Manage access to your account and connected devices.");
  register("account.structure.choices", "Preferências e dados", "Preferences and data");
  register("account.structure.help", "Encontre respostas sobre sua conta, assinatura e segurança.", "Find answers about your account, subscription, and security.");
  register("account.structure.back", "Voltar ao site", "Back to the website");
  register("account.structure.availability", "Disponibilidade dos recursos", "Feature availability");
  register("account.structure.areaHelp", "Dúvidas sobre esta área?", "Questions about this area?");

  register("account.refinement.searchClear", "Limpar busca", "Clear search");
  register("account.refinement.searchKeyboard", "Use as setas para navegar e Enter para abrir.", "Use the arrow keys to navigate and Enter to open.");
  register("account.refinement.searchSingle", "Área encontrada: {count}", "Area found: {count}");
  register("account.refinement.searchCount", "Áreas encontradas: {count}", "Areas found: {count}");
  register("account.refinement.searchHint", "Tente buscar por senha, faturas, perfil ou dispositivos.", "Try searching for password, invoices, profile, or devices.");
  register("account.refinement.searchAreas", "Áreas da conta", "Account areas");
  register("account.refinement.availability", "Consulte o que já está conectado e o que ainda aguarda integração. Os recursos pendentes permanecem nesta seção.", "See what is connected and what still awaits integration. Pending features remain in this section.");
  register("account.refinement.light", "Claro", "Light");
  register("account.refinement.pendingEdit", "A edição aguarda a integração deste recurso.", "Editing awaits integration of this feature.");
  register("account.refinement.state", "Estado da conta", "Account status");

  // Account presentation consumes the same Meridian identity tokens.
  register("account.meridian.sessionPreview", "A prévia não representa uma sessão autenticada.", "This preview does not represent an authenticated session.");
  register("account.meridian.001", "Prévia local da Conta", "Local Account preview");
  register("account.meridian.002", "Prévia da conta", "Account preview");
  register("account.meridian.003", "Explore as seções. Nenhuma sessão é simulada e nenhuma alteração é salva na conta. Recursos sem conexão permanecem sinalizados.", "Explore the sections. No session is simulated and no changes are saved to the account. Disconnected features remain identified.");
  register("account.meridian.004", "Ver tela de acesso", "View sign-in screen");
  register("account.meridian.005", "Somente leitura", "Read only");
  register("account.meridian.006", "RECURSOS DESTA SEÇÃO", "FEATURES IN THIS SECTION");
  register("account.meridian.007", "Novas possibilidades em evolução", "New possibilities in development");

  // Recovery pages reuse the public identity components and form preview.
  register("recovery.meridian.001", "Seu acesso.", "Your access.");
  register("recovery.meridian.002", "Um novo começo.", "A fresh start.");
  register("recovery.meridian.003", "Esqueceu a senha? A recuperação começa pelo e-mail cadastrado na sua Conta OrdaX.", "Forgot your password? Recovery starts with the email registered to your OrdaX Account.");
  register("recovery.meridian.004", "Recupere seu acesso.", "Recover your access.");
  register("recovery.meridian.005", "Informe o e-mail da sua conta para receber as instruções de recuperação.", "Enter your account email to receive recovery instructions.");
  register("recovery.meridian.006", "Recuperação temporariamente indisponível", "Recovery temporarily unavailable");
  register("recovery.meridian.007", "Não foi possível liberar a recuperação agora. Tente novamente mais tarde.", "Recovery could not be enabled right now. Please try again later.");
  register("recovery.meridian.008", "Um passo de cada vez.", "One step at a time.");
  register("recovery.meridian.009", "Solicite as instruções e use o link recebido para definir uma nova senha.", "Request the instructions and use the link you receive to set a new password.");
  register("recovery.meridian.010", "Um novo acesso.", "A fresh sign-in.");
  register("recovery.meridian.011", "A mesma conta.", "The same account.");
  register("recovery.meridian.012", "Escolha uma nova senha para continuar usando sua Conta OrdaX. A alteração depende de um link de recuperação válido.", "Choose a new password to continue using your OrdaX Account. A valid recovery link is required to make the change.");
  register("recovery.meridian.013", "Defina sua nova senha.", "Set your new password.");
  register("recovery.meridian.014", "Crie uma senha com pelo menos 12 caracteres e repita no campo de confirmação.", "Create a password with at least 12 characters and repeat it in the confirmation field.");
  register("recovery.meridian.015", "Alteração de senha indisponível", "Password change unavailable");
  register("recovery.meridian.016", "Não foi possível liberar a alteração de senha agora. Tente novamente mais tarde.", "Password changes could not be enabled right now. Please try again later.");
  register("recovery.meridian.017", "Cuide do seu acesso.", "Take care of your access.");
  register("recovery.meridian.018", "Não compartilhe sua senha nem os links de recuperação da sua conta.", "Do not share your password or your account recovery links.");
  register("recovery.meridian.019", "Sua nova senha", "Your new password");
  register("recovery.meridian.020", "Repita a nova senha", "Repeat your new password");

  // Registration uses the shared public identity presentation.
  register("register.meridian.001", "SEU PRIMEIRO PASSO", "YOUR FIRST STEP");
  register("register.meridian.002", "Crie sua identidade no OrdaX e escolha como fazer parte desse universo. Você continua no controle dos seus dados.", "Create your OrdaX identity and choose how to be part of this universe. You stay in control of your data.");
  register("register.meridian.003", "Sua nova Conta OrdaX", "Your new OrdaX Account");
  register("register.meridian.004", "Comece com seu e-mail", "Start with your email");
  register("register.meridian.005", "Conheça os termos antes de continuar", "Read the terms before continuing");
  register("register.meridian.006", "Proteção para o seu acesso", "Protection for your access");
  register("register.meridian.007", "Leia os Termos e a Política de Privacidade para entender como sua conta e seus dados são tratados.", "Read the Terms and Privacy Policy to understand how your account and data are handled.");
  register("register.meridian.008", "Crie sua Conta OrdaX.", "Create your OrdaX Account.");
  register("register.meridian.009", "Use seu e-mail e crie uma senha com pelo menos 12 caracteres. Leia os termos antes de confirmar.", "Use your email and create a password with at least 12 characters. Read the terms before confirming.");
  register("register.meridian.010", "O cadastro será liberado quando a conexão segura estiver disponível.", "Registration will be enabled when a secure connection is available.");

  // Login presentation; Identity behavior and readiness remain in site.js.
  register("login.meridian.001", "Seus mundos.", "Your worlds.");
  register("login.meridian.002", "Uma identidade.", "One identity.");
  register("login.meridian.003", "Acesse seus Spaces e gerencie sua identidade com a mesma Conta OrdaX.", "Access your Spaces and manage your identity with the same OrdaX account.");
  register("login.meridian.004", "Sua Conta OrdaX", "Your OrdaX Account");
  register("login.meridian.005", "Seu acesso ao universo OrdaX", "Your access to the OrdaX universe");
  register("login.meridian.006", "Proteção para o seu acesso", "Protection for your access");
  register("login.meridian.007", "Você escolhe o que compartilhar. Recursos conectados são liberados conforme ficam disponíveis.", "You choose what to share. Connected features are enabled as they become available.");
  register("login.meridian.008", "CONTA ORDAX", "ORDAX ACCOUNT");
  register("login.meridian.009", "Bem-vindo de volta.", "Welcome back.");
  register("login.meridian.010", "Entre com seu e-mail e senha para continuar.", "Sign in with your email and password to continue.");
  register("login.meridian.015", "O formulário de acesso será liberado quando a conexão segura estiver disponível.", "The sign-in form will be enabled when a secure connection is available.");
  register("login.meridian.016", "Seu universo começa aqui.", "Your universe begins here.");

  // Public landing narrative; same locale registry as the rest of the portal.
  register("landing.ecosystem.001", "OrdaX reúne sistema, apps, projetos e inteligência em um ambiente para sua vida e seu trabalho. Conheça a experiência e as formas de começar.", "OrdaX brings your system, apps, projects and intelligence together for life and work. Explore the experience and ways to get started.");
  register("landing.ecosystem.002", "EXPLORE POR DENTRO", "EXPLORE FROM WITHIN");
  register("landing.ecosystem.003", "Veja uma ideia ganhar contexto.", "See an idea gain context.");
  register("landing.ecosystem.004", "Abra o projeto Aurora, explore os arquivos e descubra como a inteligência pode participar do trabalho.", "Open the Aurora project, explore its files and discover how intelligence can help with your work.");
  register("landing.ecosystem.005", "Conheça o OrdaX OS — USB.", "Explore OrdaX OS — USB.");
  register("landing.ecosystem.006", "Experiência", "Experience");
  register("landing.ecosystem.007", "Espaços", "Spaces");
  register("landing.ecosystem.008", "Aplicativos", "Apps");
  register("landing.ecosystem.009", "Onde usar", "Where to use it");
  register("landing.ecosystem.010", "PESSOAS, IDEIAS E POSSIBILIDADES", "PEOPLE, IDEAS AND POSSIBILITIES");
  register("landing.ecosystem.011", "Tudo o que você faz.", "Everything you do.");
  register("landing.ecosystem.012", "Um universo que conecta.", "A universe that connects.");
  register("landing.ecosystem.013", "Organize sua vida, seus projetos e seu trabalho em um só ambiente. Spaces conectam o que faz sentido para você, com aplicativos e inteligência sob seu controle.", "Organize your life, projects and work in one environment. Spaces connect what matters to you, with apps and intelligence under your control.");
  register("landing.ecosystem.014", "Explorar a demonstração", "Explore the demo");
  register("landing.ecosystem.015", "Conhecer o OrdaX OS", "Discover OrdaX OS");
  register("landing.ecosystem.016", "Produto em desenvolvimento. Demonstração interativa, sem instalar.", "Product in development. Interactive demo, no installation required.");
  register("landing.ecosystem.017", "PARA A VIDA. PARA O TRABALHO.", "FOR LIFE. FOR WORK.");
  register("landing.ecosystem.018", "Um sistema. Seus diferentes mundos.", "One system. Your different worlds.");
  register("landing.ecosystem.019", "Conheça a ideia", "Discover the idea");
  register("landing.ecosystem.020", "DO DIA A DIA AO PRÓXIMO PROJETO", "FROM EVERYDAY LIFE TO YOUR NEXT PROJECT");
  register("landing.ecosystem.021", "Menos coisas espalhadas.", "Fewer scattered pieces.");
  register("landing.ecosystem.022", "Mais sentido entre elas.", "More connections between them.");
  register("landing.ecosystem.023", "Um arquivo sozinho conta uma parte da história. O OrdaX aproxima arquivos, aplicativos, atividades e contexto para ajudar você a seguir de onde parou.", "A file on its own tells part of the story. OrdaX brings files, apps, activity and context closer together to help you pick up where you left off.");
  register("landing.ecosystem.024", "Organize por projeto.", "Organize by project.");
  register("landing.ecosystem.025", "Reúna objetivos, referências, arquivos e próximos passos em torno do que você quer realizar. Projetos vão além de desenvolvimento de software.", "Bring goals, references, files and next steps together around what you want to achieve. Projects go beyond software development.");
  register("landing.ecosystem.026", "Mude de contexto.", "Switch context.");
  register("landing.ecosystem.027", "Sua vida pessoal, uma ideia nova e a rotina da empresa podem ter espaços próprios, sem perder a familiaridade do sistema.", "Your personal life, a new idea and your business routine can each have their own space, with the same familiar system.");
  register("landing.ecosystem.028", "Pense com assistência.", "Think with assistance.");
  register("landing.ecosystem.029", "Inteligência perto do trabalho, com o contexto que você permite compartilhar e ações que dependem da sua autorização.", "Intelligence close to your work, with the context you allow it to use and actions that require your authorization.");
  register("landing.ecosystem.030", "ESPAÇOS", "SPACES");
  register("landing.ecosystem.031", "O seu jeito de trabalhar", "Your way of working");
  register("landing.ecosystem.032", "tem lugar aqui.", "belongs here.");
  register("landing.ecosystem.033", "Um Space é um ambiente dedicado ao que você faz. Ele reúne projetos, ferramentas e informações relevantes para aquele contexto. Você escolhe o que faz parte dele.", "A Space is an environment dedicated to what you do. It brings together projects, tools and information relevant to that context. You choose what belongs in it.");
  register("landing.ecosystem.034", "Seus espaços, suas possibilidades", "Your spaces, your possibilities");
  register("landing.ecosystem.035", "EXEMPLOS DE USO", "USAGE EXAMPLES");
  register("landing.ecosystem.036", "Pessoal", "Personal");
  register("landing.ecosystem.037", "Uma vida além das abas.", "Life beyond browser tabs.");
  register("landing.ecosystem.038", "Estudos, planos, referências e projetos que são só seus.", "Studies, plans, references and projects of your own.");
  register("landing.ecosystem.039", "Notas · Arquivos · Calendário", "Notes · Files · Calendar");
  register("landing.ecosystem.040", "Pequeno negócio", "Small business");
  register("landing.ecosystem.041", "Cada rotina no seu lugar.", "Every routine in its place.");
  register("landing.ecosystem.042", "Da pizzaria à empresa: ambientes pensados para diferentes atividades.", "From a pizzeria to a company: environments designed for different activities.");
  register("landing.ecosystem.043", "Equipe · Rotina · Projetos", "Team · Routine · Projects");
  register("landing.ecosystem.044", "Criação e impressão 3D", "Creation and 3D printing");
  register("landing.ecosystem.045", "Da ideia à próxima peça.", "From an idea to the next piece.");
  register("landing.ecosystem.046", "Modelos, referências e etapas de criação em um mesmo contexto.", "Models, references and creative stages in one context.");
  register("landing.ecosystem.047", "Modelos · Arquivos · Etapas", "Models · Files · Stages");
  register("landing.ecosystem.048", "Desenvolvimento", "Development");
  register("landing.ecosystem.049", "Espaço para construir.", "Room to build.");
  register("landing.ecosystem.050", "Projetos, arquivos e ferramentas para explorar soluções com o Studio.", "Projects, files and tools for exploring solutions with Studio.");
  register("landing.ecosystem.051", "Projetos · Studio · Ferramentas", "Projects · Studio · Tools");
  register("landing.ecosystem.052", "Possibilidades em evolução. Os recursos específicos de cada atividade estão em desenvolvimento; estes exemplos não representam soluções comerciais prontas.", "Evolving possibilities. Features for each activity are in development; these examples do not represent finished commercial solutions.");
  register("landing.ecosystem.053", "Conectar também é uma escolha.", "Connection is a choice, too.");
  register("landing.ecosystem.054", "A proposta do OrdaX Network é aproximar Spaces, comunidades, grupos e mensagens, com participação opcional. Sua conta pessoal não se torna pública automaticamente.", "OrdaX Network aims to bring Spaces, communities, groups and messages together through optional participation. Your personal account does not become public automatically.");
  register("landing.ecosystem.055", "Em desenvolvimento", "In development");
  register("landing.ecosystem.056", "Inteligência que acompanha", "Intelligence that follows");
  register("landing.ecosystem.057", "o que você está fazendo.", "what you are working on.");
  register("landing.ecosystem.058", "A assistência faz parte do OrdaX inteiro. Ajuda a relacionar informações, entender o contexto e preparar o próximo passo nos seus projetos e Spaces.", "Assistance is part of the whole OrdaX experience. It helps connect information, understand context and prepare the next step in your projects and Spaces.");
  register("landing.ecosystem.059", "Explore a Intelligence na demonstração", "Explore Intelligence in the demo");
  register("landing.ecosystem.060", "COMO A EXPERIÊNCIA É PENSADA", "HOW THE EXPERIENCE IS DESIGNED");
  register("landing.ecosystem.061", "Você escolhe o contexto.", "You choose the context.");
  register("landing.ecosystem.062", "O projeto, os arquivos e as referências relevantes. Memory ajuda a manter o que importa para continuar.", "The project, files and relevant references. Memory helps retain what matters so you can keep going.");
  register("landing.ecosystem.063", "A inteligência ajuda a entender.", "Intelligence helps you understand.");
  register("landing.ecosystem.064", "Análises, conexões e sugestões a partir do contexto permitido.", "Analysis, connections and suggestions based on the permitted context.");
  register("landing.ecosystem.065", "Você decide a próxima ação.", "You decide the next action.");
  register("landing.ecosystem.066", "Uma sugestão não é uma autorização. Ferramentas e ações respeitam as permissões do ambiente.", "A suggestion is not authorization. Tools and actions respect the permissions of your environment.");
  register("landing.ecosystem.067", "Inferência local já integra o desenvolvimento do OrdaX OS. A disponibilidade depende do modo, do modelo e do dispositivo; o acesso público ainda está em evolução.", "Local inference is already part of OrdaX OS development. Availability depends on the mode, model and device; public access is still evolving.");
  register("landing.ecosystem.068", "Modelos, com escolha.", "Models, with choice.");
  register("landing.ecosystem.069", "O caminho inclui modelos locais e provedores externos. Cada integração precisa estar disponível e ser autorizada.", "The direction includes local models and external providers. Each integration must be available and authorized.");
  register("landing.ecosystem.070", "Sua IA externa, com limites.", "Your external AI, with boundaries.");
  register("landing.ecosystem.071", "Conectar uma ferramenta como o ChatGPT ao OrdaX é outra experiência, em evolução, com permissões próprias. Isso não libera controle automático do computador.", "Connecting a tool such as ChatGPT to OrdaX is a separate, evolving experience with its own permissions. It does not grant automatic control of your computer.");
  register("landing.ecosystem.072", "APLICATIVOS QUE FAZEM PARTE", "APPS THAT BELONG");
  register("landing.ecosystem.073", "Das pequenas tarefas", "From small tasks");
  register("landing.ecosystem.074", "às grandes ideias.", "to big ideas.");
  register("landing.ecosystem.075", "Um ecossistema próprio para escrever, organizar, criar e desenvolver. Conta, Ajustes, Sistema e Loja dão suporte à experiência.", "An ecosystem of its own for writing, organizing, creating and developing. Account, Settings, System and Store support the experience.");
  register("landing.ecosystem.076", "Arquivos", "Files");
  register("landing.ecosystem.077", "Documentos e referências", "Documents and references");
  register("landing.ecosystem.078", "Notas", "Notes");
  register("landing.ecosystem.079", "Ideias que merecem ficar", "Ideas worth keeping");
  register("landing.ecosystem.080", "Internet", "Internet");
  register("landing.ecosystem.081", "Pesquisa e descoberta", "Research and discovery");
  register("landing.ecosystem.082", "Projetos", "Projects");
  register("landing.ecosystem.083", "Trabalho com contexto", "Work with context");
  register("landing.ecosystem.084", "Activity", "Activity");
  register("landing.ecosystem.085", "O percurso do seu trabalho", "The journey of your work");
  register("landing.ecosystem.086", "Utilitários", "Utilities");
  register("landing.ecosystem.087", "Calculadora, Relógio e Conversor", "Calculator, Clock and Converter");
  register("landing.ecosystem.088", "Criação e mídia", "Creation and media");
  register("landing.ecosystem.089", "Imagens, PDF, Mídia e Desenho", "Images, PDF, Media and Drawing");
  register("landing.ecosystem.090", "Ferramentas", "Tools");
  register("landing.ecosystem.091", "Cores, Texto e Mapa de Caracteres", "Colors, Text and Character Map");
  register("landing.ecosystem.092", "Portfólio em desenvolvimento. Os aplicativos incluídos e os recursos disponíveis variam conforme o modo e a versão publicada.", "Portfolio in development. Included apps and available features vary by mode and published release.");
  register("landing.ecosystem.093", "Um lugar para desenvolver", "A place to develop");
  register("landing.ecosystem.094", "o que vem depois.", "what comes next.");
  register("landing.ecosystem.095", "Arquivos, edição, Git, tarefas, checkpoints e prévias no contexto do projeto. O Studio participa do ecossistema de Projetos, com ferramentas autorizadas e liberdade de escolha de provedor de IA.", "Files, editing, Git, tasks, checkpoints and previews in your project context. Studio participates in the Projects ecosystem, with authorized tools and freedom to choose an AI provider.");
  register("landing.ecosystem.096", "IDEIA", "IDEA");
  register("landing.ecosystem.097", "PROJETO", "PROJECT");
  register("landing.ecosystem.098", "CRIAÇÃO", "CREATION");
  register("landing.ecosystem.099", "Em desenvolvimento para OrdaX OS e Windows. Recursos e integrações evoluem por ambiente.", "In development for OrdaX OS and Windows. Features and integrations evolve for each environment.");
  register("landing.ecosystem.100", "LOJA ORDAX", "ORDAX STORE");
  register("landing.ecosystem.101", "Seu OrdaX pode", "Your OrdaX can");
  register("landing.ecosystem.102", "ganhar possibilidades.", "gain new possibilities.");
  register("landing.ecosystem.103", "Descobrir aplicativos, acompanhar instalações e gerenciar atualizações em um lugar. A Loja apresenta os componentes; o sistema verifica e autoriza a instalação.", "Discover apps, track installations and manage updates in one place. The Store presents components; the system verifies and authorizes installation.");
  register("landing.ecosystem.104", "Descoberta de aplicativos", "App discovery");
  register("landing.ecosystem.105", "Instalação e gerenciamento", "Installation and management");
  register("landing.ecosystem.106", "Atualizações de componentes", "Component updates");
  register("landing.ecosystem.107", "Experiência em evolução. Modelos, conectores e extensões fazem parte da direção futura, conforme forem liberados.", "An evolving experience. Models, connectors and extensions are part of the future direction, as they become available.");
  register("landing.ecosystem.108", "UM ORDAX, VÁRIAS FORMAS DE ACESSAR", "ONE ORDAX, MANY WAYS TO ACCESS IT");
  register("landing.ecosystem.109", "O mesmo universo.", "The same universe.");
  register("landing.ecosystem.110", "Mais caminhos até ele.", "More ways to reach it.");
  register("landing.ecosystem.111", "Computador, navegador e telefone fazem parte da mesma direção: sua identidade, seus Spaces e seus projetos acompanhando você. Cada modo tem seu próprio ritmo de disponibilidade.", "Computer, browser and phone share one direction: your identity, Spaces and projects following you. Each mode has its own availability timeline.");
  register("landing.ecosystem.112", "Inicie o computador por um USB preparado pelo OrdaX Creator.", "Start your computer from a USB prepared with OrdaX Creator.");
  register("landing.ecosystem.113", "Em homologação", "Under validation");
  register("landing.ecosystem.114", "Conhecer o caminho USB", "Explore the USB path");
  register("landing.ecosystem.115", "A experiência OrdaX no navegador, com acesso sujeito à liberação.", "The OrdaX experience in your browser, with access subject to availability.");
  register("landing.ecosystem.116", "Consultar acesso ao Web", "Check Web access");
  register("landing.ecosystem.117", "A direção para Android e iPhone, com uma experiência adaptada à tela.", "The direction for Android and iPhone, with an experience adapted to the screen.");
  register("landing.ecosystem.118", "Mais uma forma de acessar o ecossistema no computador.", "Another way to access the ecosystem on your computer.");
  register("landing.ecosystem.119", "O sistema no disco interno. Instalação pública ainda não liberada.", "The system on your internal drive. Public installation is not yet enabled.");
  register("landing.ecosystem.120", "A continuidade completa entre dispositivos ainda está em desenvolvimento. A conexão entre notebook e telefone nesta página é uma simulação, não uma sincronização de conta.", "Full continuity across devices is still in development. The connection between the laptop and phone on this page is a simulation, not account synchronization.");
  register("landing.ecosystem.121", "COMEÇAR PELO USB", "START WITH USB");
  register("landing.ecosystem.122", "Seu computador.", "Your computer.");
  register("landing.ecosystem.123", "Um novo ambiente.", "A new environment.");
  register("landing.ecosystem.124", "OrdaX OS é o sistema operacional do ecossistema. O caminho público inicial é o USB, com preparação guiada pelo Creator e versões oficiais disponibilizadas na página de download.", "OrdaX OS is the operating system of the ecosystem. The initial public path is USB, with preparation guided by Creator and official releases listed on the download page.");
  register("landing.ecosystem.125", "Ver preparação e downloads", "View preparation and downloads");
  register("landing.ecosystem.126", "Prepare seu USB.", "Prepare your USB.");
  register("landing.ecosystem.127", "Consulte uma versão autorizada e siga as orientações do OrdaX Creator para preparar a mídia.", "Find an authorized release and follow OrdaX Creator guidance to prepare your media.");
  register("landing.ecosystem.128", "Inicie o OrdaX.", "Start OrdaX.");
  register("landing.ecosystem.129", "Inicie um computador compatível pelo USB e siga as orientações de configuração.", "Boot a compatible computer from USB and follow the setup instructions.");
  register("landing.ecosystem.130", "Faça o espaço ser seu.", "Make the space your own.");
  register("landing.ecosystem.131", "Explore o sistema, seus aplicativos e projetos. Conta online é opcional para o uso básico pelo USB.", "Explore the system, its apps and projects. An online account is optional for basic USB use.");
  register("landing.ecosystem.132", "CONFIANÇA NO DIA A DIA", "EVERYDAY CONFIDENCE");
  register("landing.ecosystem.133", "Evoluir, com você", "Evolving, with you");
  register("landing.ecosystem.134", "no controle.", "in control.");
  register("landing.ecosystem.135", "Permissões, separação de dados e recuperação fazem parte da base do OrdaX. As proteções evoluem junto com a validação do sistema nos dispositivos compatíveis.", "Permissions, data separation and recovery are part of the OrdaX foundation. Protections evolve alongside system validation on compatible devices.");
  register("landing.ecosystem.136", "Ações autorizadas.", "Authorized actions.");
  register("landing.ecosystem.137", "Acesso a ferramentas e dados deve respeitar o que você permite, inclusive quando há inteligência artificial envolvida.", "Access to tools and data must respect what you permit, including when artificial intelligence is involved.");
  register("landing.ecosystem.138", "Atualizações verificadas.", "Verified updates.");
  register("landing.ecosystem.139", "O sistema verifica componentes oficiais antes de ativá-los. A evolução de um componente não precisa exigir a troca de todo o ambiente.", "The system verifies official components before activating them. Evolving a component does not have to mean replacing the whole environment.");
  register("landing.ecosystem.140", "Um caminho para voltar.", "A way back.");
  register("landing.ecosystem.141", "Recuperação e retorno à versão conhecida fazem parte do projeto. Falhas em componentes opcionais devem ficar isoladas para preservar o funcionamento do sistema.", "Recovery and returning to a known version are part of the design. Failures in optional components should remain isolated to preserve system operation.");
  register("landing.ecosystem.142", "ANTES DE COMEÇAR", "BEFORE YOU START");
  register("landing.ecosystem.143", "Pode perguntar.", "Good questions.");
  register("landing.ecosystem.144", "Preciso criar uma conta?", "Do I need an account?");
  register("landing.ecosystem.145", "Não para o uso básico do OrdaX OS pelo USB. A Conta OrdaX é o caminho para os serviços de identidade e recursos conectados que estiverem disponíveis. Entrar ou criar uma conta acontece nas páginas próprias, fora da demonstração.", "Not for basic OrdaX OS use from USB. OrdaX Account provides access to identity services and connected features as they become available. Sign-in and registration happen on their own pages, outside the demo.");
  register("landing.ecosystem.146", "Preciso estar sempre conectado?", "Do I always need to be online?");
  register("landing.ecosystem.147", "A aquisição inicial do sistema e o download de atualizações podem precisar de rede. Depois de uma versão verificada estar disponível no dispositivo, o sistema prevê inicialização offline. Recursos online continuam dependendo de conexão.", "Initial system acquisition and update downloads may require a network. Once a verified release is available on the device, the system supports offline startup. Online features still require a connection.");
  register("landing.ecosystem.148", "Já posso instalar no disco do computador?", "Can I install it on my computer drive yet?");
  register("landing.ecosystem.149", "A instalação pública do OrdaX OS — Nativo ainda não está liberada. O caminho público inicial é o USB. Consulte a página de download para saber quais versões e orientações estão autorizadas.", "Public installation of OrdaX OS — Native is not enabled yet. The initial public path is USB. Check the download page for authorized releases and guidance.");
  register("landing.ecosystem.150", "Tudo o que aparece na demonstração está disponível?", "Is everything in the demo available?");
  register("landing.ecosystem.151", "A demonstração apresenta a experiência com dados fictícios, respostas de IA predefinidas e continuidade simulada. Aplicativos e recursos são liberados conforme a evolução de cada modo. Ela não cria conta, não executa modelos e não altera um dispositivo real.", "The demo presents the experience with fictional data, preset AI responses and simulated continuity. Apps and features are released as each mode evolves. It does not create an account, run models or change a real device.");
  register("landing.ecosystem.152", "OrdaX serve só para empresas?", "Is OrdaX only for businesses?");
  register("landing.ecosystem.153", "Não. Organizar arquivos, estudar, criar, planejar e desenvolver projetos também fazem parte da proposta. Spaces profissionais expandem a experiência para negócios e equipes, sem tornar uma empresa requisito para usar o sistema.", "No. Organizing files, studying, creating, planning and developing projects are also part of the experience. Professional Spaces extend it to businesses and teams without requiring a business to use the system.");
  register("landing.ecosystem.154", "IDEIAS ORGANIZAM REALIDADES", "IDEAS ORGANIZE REALITIES");
  register("landing.ecosystem.155", "O próximo espaço", "The next space");
  register("landing.ecosystem.156", "é o seu.", "is yours.");
  register("landing.ecosystem.157", "Conheça a experiência hoje. Acompanhe os caminhos para começar.", "Explore the experience today. Discover the ways to get started.");
  register("landing.ecosystem.158", "Preparação e downloads", "Preparation and downloads");
  register("landing.ecosystem.159", "Já tem uma conta? Acesse a Conta OrdaX.", "Already have an account? Open OrdaX Account.");
  register("landing.ecosystem.160", "Um universo para sua vida e seu trabalho.", "A universe for your life and work.");
  register("landing.ecosystem.161", "Conta", "Account");

  STATIC_PAIRS.forEach(([ptBR, enUS], index) => {
    register(`static.${String(index + 1).padStart(4, "0")}`, ptBR, enUS);
  });
  Object.entries(SEMANTIC).forEach(([id, pair]) => register(id, pair[0], pair[1]));

  window.OrdaXPublicI18nCatalog = Object.freeze({
    schema: "prototype-ordax.public-site-localization/1",
    sourceLocale: SOURCE_LOCALE,
    supportedLocales: SUPPORTED_LOCALES,
    messages: Object.freeze({
      "pt-BR": Object.freeze(messages["pt-BR"]),
      "en-US": Object.freeze(messages["en-US"]),
    }),
    sourceIndex: Object.freeze(sourceIndex),
  });
})();
