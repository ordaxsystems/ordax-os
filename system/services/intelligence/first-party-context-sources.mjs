const SOURCE_SPECS = Object.freeze([
  Object.freeze({
    id: "project-selection",
    title: "Projeto selecionado",
  }),
  Object.freeze({
    id: "note-selection",
    title: "Nota selecionada",
  }),
  Object.freeze({
    id: "file-selection",
    title: "Arquivo selecionado",
  }),
]);

export function listFirstPartyGrantedIntelligenceContextSources() {
  return SOURCE_SPECS;
}
