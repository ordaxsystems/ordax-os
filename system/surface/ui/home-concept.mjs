// Native Home chrome; service-owned data is rendered by its dedicated mounts.
export function homeConceptSections(t, icons) {
  const rows = [
    ["internet","networkWifi","home.status.network.label",'data-quick-panel-toggle="network" aria-controls="ordax-quick-network" aria-expanded="false"'],
    ["account","account","home.status.account.label",'data-launch-app="account"'],
    ["sync","clock","home.status.sync.label",'data-launch-app="account" data-app-target="sync"'],
    ["storage","folder","home.status.storage.label",'data-launch-app="system" data-app-target="storage"'],
    ["updates","system","home.status.updates.label",'data-launch-app="system" data-app-target="updates"'],
  ];
  const status = `<section class="ordax-home-status ordax-home-widget" aria-labelledby="ordax-home-status-title" aria-describedby="ordax-home-status-note"><div class="ordax-home-section-heading"><h2 id="ordax-home-status-title" data-home-copy="home.status.title">${t("home.status.title")}</h2><span class="ordax-home-status-connection" data-home-status-connection data-state="loading" aria-live="polite">${t("home.status.loading")}</span></div><div class="ordax-home-status-list">${rows.map(([key,icon,label,action]) => `<button type="button" ${action}><span class="ordax-rail-icon" aria-hidden="true">${icons[icon]}</span><span data-home-copy="${label}">${t(label)}</span><small data-home-status-value="${key}" data-state="loading" aria-live="polite">${t("home.status.loading")}</small></button>`).join("")}</div><p id="ordax-home-status-note" class="ordax-home-note" data-home-status-note>${t("home.status.note.loading")}</p></section>`;
  const currentSpace = `<section class="ordax-home-current-space ordax-home-widget" aria-labelledby="ordax-home-current-space-title"><div class="ordax-home-section-heading"><h2 id="ordax-home-current-space-title" data-home-copy="home.space.title">${t("home.space.title")}</h2><span class="ordax-home-status-connection" data-home-space-state data-state="loading" aria-live="polite">${t("home.space.loading")}</span></div><button type="button" class="ordax-home-space-identity" data-launch-app="account" data-app-target="spaces"><span class="ordax-rail-icon" aria-hidden="true">${icons.home}</span><span><strong data-home-space-name>${t("home.space.loading")}</strong><small data-home-space-kind>${t("home.space.loadingKind")}</small></span><span aria-hidden="true">›</span></button><div class="ordax-home-space-art" aria-hidden="true"><div class="ordax-home-space-window"></div><div class="ordax-home-space-screen"></div><div class="ordax-home-space-desk"></div><div class="ordax-home-space-plant"></div></div><button type="button" class="ordax-home-space-open" data-launch-app="account" data-app-target="spaces"><span class="ordax-rail-icon" aria-hidden="true">${icons.folder}</span><span data-home-copy="home.space.open">${t("home.space.open")}</span><span aria-hidden="true">→</span></button></section>`;
  return { status, currentSpace };
}

export function handleHomeConceptKeyDown(event, root) {
  if (event.key !== "Enter" || event.isComposing || !event.target.matches?.("[data-native-aura-prompt]")) {
    return false;
  }
  event.preventDefault();
  if (event.target.value.trim()) root.querySelector("[data-home-aura-submit]")?.click();
  return true;
}

export function handleHomeConceptClick(event, root, localization) {
  const suggestion = event.target.closest("[data-home-aura-suggestion]");
  if (!suggestion) return false;
  const input = root.querySelector("[data-native-aura-prompt]");
  if (input) {
    input.value = localization.translate(suggestion.dataset.homeAuraSuggestion);
    input.focus();
  }
  return true;
}
