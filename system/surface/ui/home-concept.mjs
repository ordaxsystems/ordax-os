// Explicit examples for the Home composition; service-owned data keeps its own mount.
const projects = Object.freeze([
  { key: "model", title: "Modelagem Produto 3D", app: "Blender", detail: "shell.home.preview.modelDetail" },
  { key: "city", title: "Salvador Historic Core", app: "3D", detail: "shell.home.preview.cityDetail" },
  { key: "world", title: "HORDAX-game", app: "Unity", detail: "shell.home.preview.worldDetail" },
]);
function projectArt(kind) {
  const colors = { model: "#dce5df", city: "#d8e9ec", world: "#e1e8cf" };
  const model = '<g stroke="#698076" stroke-width="1.5" stroke-linejoin="round"><path d="m72 80 93-43 87 40-92 46Z" fill="#f6f5ee"/><path d="M72 80v47l88 31v-35Z" fill="#a1b2a6"/><path d="M160 123v35l92-34V77Z" fill="#c8d3c9"/><path d="m99 71 65-30 60 27-64 30Z" fill="#fffdf5"/><path d="M99 71v34l61 23V98Zm61 27v30l64-26V68Z" fill="#b6c5ba"/><path d="M142 50V30q18-27 36 0v21l-18 9Z" fill="#e3e9de"/><path d="m142 30 18 8 18-8m-18 8v22" fill="none"/><path d="m91 98 9 4v18l-9-4Zm24 9 9 4v18l-9-4Zm63 19 11-4v17l-11 4Zm27-10 11-4v17l-11 4Zm26-10 11-4v17l-11 4Z" fill="#526d64"/></g>';
  const city = '<circle cx="264" cy="29" r="16" fill="#f0cf83"/><path d="M0 91 50 62 106 88 175 57 240 85 320 65v95H0Z" fill="#8daeb0" opacity=".45"/>' + [[30,78,"#d8ac79"],[85,62,"#f0e2b8"],[140,75,"#b4cfca"],[202,57,"#dfb783"],[258,79,"#b9c4cb"]].map(([x,y,color]) => `<g transform="translate(${x} ${y})"><path d="M0 0h42v62H0Z" fill="${color}"/><path d="m-4 0 25-19L46 0Z" fill="#8c6857"/><path d="M8 9h8v15H8Zm18 0h8v15h-8ZM8 34h8v15H8Zm18 0h8v15h-8Z" fill="#466f6b"/><path d="M18 45h8v17h-8Z" fill="#627d73"/></g>`).join("");
  const world = '<circle cx="259" cy="31" r="18" fill="#e3ca82"/><path d="M0 102 53 53 112 102 162 40 221 94 280 60 320 98V160H0Z" fill="#7e9a7a"/><path d="M0 123 100 97 174 129 258 104 320 121V160H0Z" fill="#a7b68b"/><path d="m90 160 58-60h22l38 60Z" fill="#dfcba3"/><g fill="#4f7865"><path d="m40 52-24 66h48ZM275 49l-27 71h54Z"/></g><g stroke="#8c9d83" stroke-width="2"><path d="M121 103V62q39-64 78 0v41h-18V64q-21-36-42 0v39Z" fill="#e8e6ce"/><path d="M112 103h36v12h-36Zm61 0h36v12h-36Z" fill="#c4ceb0"/></g>';
  return `<svg class="ordax-home-project-art" viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="160" fill="${colors[kind]}"/><path d="M0 106 160 66 320 105V160H0Z" fill="#55756a" opacity=".25"/>${{model,city,world}[kind]}</svg>`;
}
export function homeConceptSections(t, icons) {
  const example = `<span class="ordax-home-example" data-home-copy="shell.home.preview.badge">${t("shell.home.preview.badge")}</span>`;
  const head = (id, title, app = "files") => `<div class="ordax-home-section-heading"><h2 id="${id}" data-home-copy="${title}">${t(title)}</h2><button type="button" data-launch-app="${app}"><span data-home-copy="shell.home.preview.seeAll">${t("shell.home.preview.seeAll")}</span> <span aria-hidden="true">↗</span></button></div>`;
  const continuation = `<section class="ordax-home-resume" data-home-example="resume" aria-labelledby="ordax-home-resume-title">${head("ordax-home-resume-title","shell.home.preview.resume")}<div class="ordax-home-resume-grid">${projects.map(p => `<button type="button" class="ordax-home-project-card" data-home-preview-notice><span class="ordax-home-project-cover">${projectArt(p.key)}<span class="ordax-home-project-app" aria-hidden="true">${p.app === "Blender" ? icons.studio : icons.apps}</span></span><span class="ordax-home-project-copy"><strong>${p.title}</strong><small>${p.app} · <span data-home-copy="${p.detail}">${t(p.detail)}</span></small></span></button>`).join("")}</div><p class="ordax-home-example-note" data-home-copy="shell.home.preview.projectsNote">${t("shell.home.preview.projectsNote")}</p></section>`;
  const rows = [
    ["networkWifi","shell.home.preview.internet","shell.home.preview.connected",'data-quick-panel-toggle="network" aria-controls="ordax-quick-network" aria-expanded="false"'],
    ["account","shell.home.session.account","shell.home.preview.connected",'data-launch-app="account"'],
    ["clock","shell.home.preview.sync","shell.home.preview.upToDate",'data-launch-app="account" data-app-target="sync"'],
    ["folder","shell.home.preview.storage","32,4 GB / 128 GB",'data-launch-app="system" data-app-target="storage"'],
    ["system","shell.home.preview.updates","shell.home.preview.upToDate",'data-launch-app="system" data-app-target="updates"'],
  ];
  const status = `<section class="ordax-home-status ordax-home-widget" aria-labelledby="ordax-home-status-title" aria-describedby="ordax-home-status-note"><div class="ordax-home-section-heading"><h2 id="ordax-home-status-title" data-home-copy="shell.home.preview.status">${t("shell.home.preview.status")}</h2>${example}</div><div class="ordax-home-status-list">${rows.map(([icon,label,value,action]) => `<button type="button" ${action}><span class="ordax-rail-icon" aria-hidden="true">${icons[icon]}</span><span data-home-copy="${label}">${t(label)}</span><small${value.startsWith("shell.") ? ` data-home-copy="${value}"` : ""}>${value.startsWith("shell.") ? t(value) : value}</small></button>`).join("")}</div><p id="ordax-home-status-note" class="ordax-home-example-note" data-home-copy="shell.home.preview.statusNote">${t("shell.home.preview.statusNote")}</p></section>`;
  const currentSpace = `<section class="ordax-home-current-space ordax-home-widget" aria-labelledby="ordax-home-current-space-title"><div class="ordax-home-section-heading"><h2 id="ordax-home-current-space-title" data-home-copy="shell.home.preview.currentSpace">${t("shell.home.preview.currentSpace")}</h2>${example}</div><button type="button" class="ordax-home-space-identity" data-launch-app="account" data-app-target="spaces"><span class="ordax-rail-icon" aria-hidden="true">${icons.home}</span><span><strong data-home-copy="shell.home.preview.spaceName">${t("shell.home.preview.spaceName")}</strong><small data-home-copy="shell.home.preview.personal">${t("shell.home.preview.personal")}</small></span><span aria-hidden="true">›</span></button><div class="ordax-home-space-art" aria-hidden="true"><div class="ordax-home-space-window"></div><div class="ordax-home-space-screen"></div><div class="ordax-home-space-desk"></div><div class="ordax-home-space-plant"></div></div><button type="button" class="ordax-home-space-open" data-launch-app="account" data-app-target="spaces"><span class="ordax-rail-icon" aria-hidden="true">${icons.folder}</span><span data-home-copy="shell.home.preview.openSpace">${t("shell.home.preview.openSpace")}</span><span aria-hidden="true">→</span></button></section>`;
  const files = [["Diorama_Lazaro_v3.blend","shell.home.preview.folder.modelsDioramas","studio"],["Salvador_Lacorda.fbx","shell.home.preview.folder.projectsSalvador","files"],["Planejamento_Projeto.md","shell.home.preview.folder.notes","folder"],["Area_de_Neo_v2.stl","shell.home.preview.folder.modelsArea","spaces"]];
  const recent = `<section class="ordax-home-recent ordax-home-widget" aria-labelledby="ordax-home-recent-title">${head("ordax-home-recent-title","shell.home.preview.recent")}<div class="ordax-home-recent-list">${files.map(([name,folder,icon]) => `<button type="button" data-home-preview-notice><span class="ordax-rail-icon" aria-hidden="true">${icons[icon]}</span><span><strong>${name}</strong><small data-home-copy="${folder}">${t(folder)}</small></span>${example}</button>`).join("")}</div></section>`;
  const activity = `<section class="ordax-home-projects ordax-home-widget" aria-labelledby="ordax-home-projects-title">${head("ordax-home-projects-title","shell.home.preview.projects")}<div class="ordax-home-project-list">${projects.map(p => `<button type="button" data-home-preview-notice>${projectArt(p.key)}<span><strong>${p.title}</strong><small><b>${p.app}</b> <span data-home-copy="${p.detail}">${t(p.detail)}</span></small></span><span aria-hidden="true">›</span></button>`).join("")}</div><p class="ordax-home-example-note" data-home-copy="shell.home.preview.projectsNote">${t("shell.home.preview.projectsNote")}</p></section>`;
  return {continuation,status,currentSpace,recent,activity};
}
const previewTriggers = new WeakMap();

export function handleHomePreviewKeyDown(event, root) {
  if (event.key === "Enter" && !event.isComposing && event.target.matches?.("[data-native-aura-prompt]")) {
    event.preventDefault();
    if (event.target.value.trim()) root.querySelector("[data-home-preview-send]")?.click();
    return true;
  }
  if (event.key === "Escape" && root.querySelector("[data-home-preview-feedback]:not([hidden])")) {
    event.preventDefault();
    root.querySelector("[data-home-preview-dismiss]")?.click();
    return true;
  }
  return false;
}

export function handleHomePreviewClick(event, root, localization) {
  if (event.target.closest("[data-home-preview-dismiss]")) {
    root.querySelector("[data-home-preview-feedback]")?.setAttribute("hidden", "");
    const trigger = previewTriggers.get(root);
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    previewTriggers.delete(root);
    return true;
  }
  const suggestion = event.target.closest("[data-home-preview-command]");
  if (suggestion) {
    const input = root.querySelector("[data-native-aura-prompt]");
    if (input) { input.value = localization.translate(suggestion.dataset.homePreviewCommand); input.focus(); }
    return true;
  }
  const trigger = event.target.closest("[data-home-preview-notice]");
  if (!trigger) return false;
  previewTriggers.set(root, trigger);
  const feedback = root.querySelector("[data-home-preview-feedback]");
  if (feedback) {
    feedback.hidden = false;
    feedback.querySelector("[data-home-preview-feedback-text]").textContent = localization.translate("shell.home.preview.feedback");
  }
  return true;
}
