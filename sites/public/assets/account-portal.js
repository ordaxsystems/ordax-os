/* Account presentation only. Session and locale remain with the existing owners. */
(() => {
  "use strict";
  const content = document.querySelector("[data-account-content]");
  if (!content) return;
  const cards = [...document.querySelectorAll("[data-account-card]")];
  const overview = document.querySelector("[data-account-overview]");
  const search = document.querySelector("[data-account-search]");
  const back = document.querySelector("[data-account-back]");
  const empty = document.querySelector("[data-account-no-results]");
  const status = document.querySelector("[data-account-search-status]");
  const menu = document.querySelector("[data-account-menu]");
  const searchToggle = document.querySelector("[data-account-search-toggle]");
  const links = [...document.querySelectorAll("[data-account-section]")];
  const sections = new Set(["visao-geral", ...cards.map(card => card.id)]);
  const normalize = value => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const sectionFromHash = () => {
    const requested = window.location.hash.slice(1);
    return sections.has(requested) ? requested : "visao-geral";
  };

  function closeMenu(restoreFocus = false) {
    document.body.classList.remove("account-menu-open");
    menu?.setAttribute("aria-expanded", "false");
    if (restoreFocus) menu?.focus();
  }

  function render({ focus = false } = {}) {
    const view = sectionFromHash();
    const query = normalize(search?.value || "");
    const searching = query.length > 0;
    content.dataset.view = searching ? "visao-geral" : view;
    overview.hidden = searching || view !== "visao-geral";
    back.hidden = view === "visao-geral" && !searching;
    let visible = 0;
    for (const card of cards) {
      card.hidden = searching
        ? !normalize(card.textContent).includes(query)
        : view !== "visao-geral" && card.id !== view;
      if (!card.hidden) visible++;
    }
    empty.hidden = visible > 0;
    status.textContent = searching
      ? window.OrdaXPublicI18n.t("account.search.matches", { count: visible })
      : "";
    for (const link of links) {
      if (!searching && link.hash === "#" + view) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    if (focus) {
      const heading = view === "visao-geral" ? content.querySelector("h1") : document.getElementById(view)?.querySelector("h2");
      if (heading) { heading.tabIndex = -1; heading.focus(); }
    }
  }

  for (const link of links) {
    link.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
      const section = link.hash.slice(1);
      if (!sections.has(section)) return;
      event.preventDefault();
      if (search) search.value = "";
      window.history.pushState(null, "", "#" + section);
      closeMenu();
      render({ focus: true });
    });
  }
  search?.addEventListener("input", () => render());
  search?.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      search.value = "";
      document.body.classList.remove("account-search-open");
      searchToggle?.setAttribute("aria-expanded", "false");
      if (window.matchMedia("(max-width:900px)").matches) searchToggle?.focus();
      render();
    }
  });
  searchToggle?.addEventListener("click", () => {
    const open = document.body.classList.toggle("account-search-open");
    searchToggle.setAttribute("aria-expanded", String(open));
    if (open) { closeMenu(); search?.focus(); }
  });
  menu?.addEventListener("click", () => {
    const open = document.body.classList.toggle("account-menu-open");
    menu.setAttribute("aria-expanded", String(open));
    if (open) document.querySelector("#account-navigation a")?.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.body.classList.contains("account-menu-open")) closeMenu(true);
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("#account-navigation, [data-account-menu]")) closeMenu();
  });
  window.addEventListener("hashchange", () => render());
  window.addEventListener("popstate", () => render());
  document.addEventListener("ordax:localechange", () => render());
  window.matchMedia("(min-width:901px)").addEventListener("change", event => { if (event.matches) closeMenu(); });
  document.body.classList.add("account-enhanced");
  render();
})();
