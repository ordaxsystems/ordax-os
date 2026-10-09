# Studio Web: disponibilidade e integração

Pedido explícito de 09/10/2026, continuidade do plano funcional da Surface. Owner do produto portátil: **ordaxsystems/ordax-apps**. Owner da composição/lifecycle/política: **ordaxsystems/ordax-os**. Runtime de dispositivo e provider connectors mantêm seus owners e contratos; não foi copiada a UI do produto para o OS.

## Estado desta composição

Studio agora está na rail compartilhada e usa o mesmo launcher/lifecycle/catálogo. A janela existente é um **painel de integração do host**, não a interface completa de conversas, editor e preview do Studio. A ausência do capability reader não aparece como três métricas zero de um sistema operacional. Diagnóstico só-leitura fica em detalhes; Projects é aberto pelo owner existente. O link ChatGPT é navegação explícita para o site público, com nova aba e `noopener noreferrer`; não é recurso necessário ao boot offline, não conecta o plugin e não comprova modo Chat.

`system/apps/studio/version.mjs` é a versão do componente de integração legado. A versão do produto portátil é `apps/studio/app.json` no owner Apps; não devem ser tratadas como paridade de features. O source do produto atual ainda não é composto neste bundle Web.

## Trabalho restante

### Apresentação em janelas estreitas — 09/10/2026

Pedido explícito de revisão mobile, vinculado ao incremento Studio do plano funcional da Surface. Owner deste incremento: apresentação do host no OS; o source portátil completo continua no owner Apps. O painel usa os tokens semânticos existentes, uma única hierarquia de título e ações de Projects/ChatGPT com descrições. Container query adapta a janela abaixo de 520px, inclusive em desktop; não existe outra UI mobile. Aviso de integração incompleta permanece visível. Orientação de conexão/cotas e diagnóstico ficam em disclosures separados, com alvos de toque de pelo menos 48px; as ações têm pelo menos 80px em janela estreita.

Reconciliação preserva disclosures e foco em vez de reconstruir a interface a cada atualização da Surface. Mudança de idioma preserva abertura/foco; fechamento destrói subscriptions pelo lifecycle existente. Risco restrito a apresentação/reconciliação, sem nova execução, storage ou autoridade. Aceite: sem overflow horizontal em 320/390/768px, ações acessíveis por teclado, Projects abre seu owner real, detalhes continuam abertos após navegação e estados indisponíveis não viram métricas fictícias. Testes de Studio/Surface e smoke Chromium verificam hierarquia e persistência dos disclosures.

- Entrega da interface canônica por composição verificada, sem um segundo source Studio e sem promover candidato não assinado pela Surface.
- Adapter de conversas/sessão para o Web. Os ports Studio Runtime descrevem ações autorizadas; não autorizam inferência de provedores nem importação de cookies.
- Vínculos de dispositivo/projeto e resultados via `ordax.studio-runtime/3`, preservando os owners de contexto, Identity, Memory e Action Gateway.
- Preview por projeto com origem alcançável pelo browser e controle de viewport. Um localhost do cliente não representa um servidor em outro dispositivo.
- Recursos de provider/microfone definidos por capacidades reais; sem iframe de ChatGPT, API privada ou fallback silencioso para Work/Codex/API.

Critérios: a entrada Web abre a UI canônica; mesma versão/source nos alvos; falhas isoladas; Home sem conversa; contexto e preview vinculados; fechamento/reconexão sem repetição de operação; grants, trust e atualização preservados. A sequência no owner Apps está em `docs/STUDIO-WEB-INTEGRATION.md`.

## Validação e risco

Risco: navegação extra pode afetar layouts pequenos e reconcilição. Tests de Surface, localização e fixture Chromium verificam que Studio abre, a ausência é explícita, não há métricas fictícias e Projects usa sua janela real. O grafo offline continua autocontido; navegação remota só acontece pelo link acionado pelo usuário. Este incremento não ativa execução, payload externo, instalação independente ou release de produção.
