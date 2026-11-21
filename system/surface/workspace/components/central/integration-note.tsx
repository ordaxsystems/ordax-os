// Presentation notes from the compatibility review, not a runtime capability source.
const pending = {
  store: {
    status: 'Backend pendente',
    notes: ['A visão planejada inclui aplicativos, modelos, conectores, extensões e pacotes.', 'O catálogo real atual cobre aplicativos. A conexão Web e os dados e operações dos demais tipos ainda precisam alcançar esta proposta.', 'Biblioteca, permissões, versões e operações desta demonstração continuam como exemplos.'],
  },
  projects: {
    status: 'Integração pendente',
    notes: ['Projetos e arquivos recentes já têm serviços locais no sistema.', 'Faltam o acesso autorizado pelo Web e a integração do contexto de projetos. O card Atlas e a colaboração continuam como exemplos.'],
  },
  files: {
    status: 'Integração pendente',
    notes: ['O sistema já possui acesso a arquivos e histórico de recentes no dispositivo.', 'Falta conectar o acesso autorizado pelo Web. Os documentos da Central permanecem como exemplos, sem leitura ou alteração de arquivos reais.'],
  },
  devices: {
    status: 'Backend pendente',
    notes: ['Câmera, áudio e segunda tela continuam na proposta visual.', 'Faltam descoberta e vínculo de dispositivos no Web, além da conexão e do consentimento próprios de cada recurso.'],
  },
  activity: {
    status: 'Backend pendente',
    notes: ['A proposta reúne movimentos de projetos, arquivos e outras ferramentas.', 'Falta uma consulta autorizada que reúna esse histórico no Web. Notificações do dispositivo não substituem essa atividade.'],
  },
  continuity: {
    status: 'Integração pendente',
    notes: ['O sistema possui serviços de sincronização e memória de conta.', 'Falta integrar o fluxo autorizado à sessão Web. Sincronizar metadados não equivale a restaurar arquivos, aplicativos ou toda a sessão.'],
  },
} as const;

export function IntegrationNote({area}: {area: keyof typeof pending}) {
  const item=pending[area];
  return <details className="meridian-integration-note"><summary><span className="meridian-integration-status">{item.status}</span> O que falta conectar</summary>
    <p>Visão planejada preservada para evolução.</p><ul>{item.notes.map(note => <li key={note}>{note}</li>)}</ul>
  </details>;
}
