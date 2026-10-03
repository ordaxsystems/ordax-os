import { defineFirstPartyApp } from "../app-contract.mjs";
import { notesComponent } from "./component.mjs";

export const notesApp = defineFirstPartyApp({
  id: "notes",
  title: "Notas",
  description: "Escrita local, projetos, tarefas e referências disponíveis offline.",
  monogram: "NO",
  singleton: true,
  component: notesComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    optionalLocales: [],
    allowAppOverride: true,
  },
  requiredCapabilities: [],
  optionalCapabilities: ["filesystem.user-space"],
  panels: [
    {
      kind: "extension",
      extensionId: "notes-workspace",
      label: "Notas",
      title: "Seu espaço de escrita",
      body: "O espaço local de Notas não está disponível nesta composição.",
    },
  ],
});
