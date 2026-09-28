import { defineFirstPartyApp } from "../app-contract.mjs";
import { systemComponent } from "../../services/components/manifests/apps.mjs";

export const systemApp = defineFirstPartyApp({
  id: "system",
  title: "Sistema",
  description: "Entrega, atualizações, conectividade e recursos desta execução do OrdaX.",
  monogram: "SI",
  singleton: true,
  component: systemComponent,
  requiredCapabilities: [],
  intelligence: {
    contextSourceIds: ["workspace-selection"],
    toolIds: [
      "observe-system-metrics",
      "observe-network-status",
      "observe-power-status",
    ],
  },
  panels: [
    {
      kind: "extension",
      extensionId: "system-overview",
      label: "Sistema",
      title: "Visão geral",
      body: "O estado detalhado do sistema não está disponível neste host.",
    },
  ],
});
