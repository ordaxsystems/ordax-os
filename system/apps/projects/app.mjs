import { defineFirstPartyApp } from "../../contracts/first-party-app.mjs";
import { projectsComponent } from "./component.mjs";

export const projectsApp = defineFirstPartyApp({
  id: "projects",
  title: "Projetos",
  description: "Organize projetos locais, conexões e continuidade entre dispositivos.",
  monogram: "PR",
  singleton: true,
  component: projectsComponent,
  localization: {
    sourceLocale: "pt-BR",
    bundledLocales: ["pt-BR", "en-US"],
    packPolicy: "component-scoped",
  },
  requiredCapabilities: [],
  panels: [
    {
      kind: "extension",
      extensionId: "projects-workspace",
      label: "Projetos",
      title: "Seu trabalho",
      body: "O catálogo de projetos não está disponível nesta composição.",
    },
  ],
});
