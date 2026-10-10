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
  const navigation = document.querySelector("#account-navigation");
  const menuClose = document.querySelector("[data-account-menu-close]");
  const servicesHeading = document.querySelector("[data-account-services-heading]");
  const modalBackground = [content, document.querySelector(".account-header"), document.querySelector(".account-mobile-nav")];
  const mobile = window.matchMedia("(max-width:900px)");
  const focusableNavigation = () => [...navigation.querySelectorAll("a[href], button:not([disabled])")].filter(element => element.getClientRects().length);
  const normalize = value => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const sectionFromHash = () => {
    const requested = window.location.hash.slice(1);
    return sections.has(requested) ? requested : "visao-geral";
  };

  function closeMenu(restoreFocus = false) {
    document.body.classList.remove("account-menu-open");
    menu?.setAttribute("aria-expanded", "false");
    navigation.removeAttribute("role");
    navigation.removeAttribute("aria-modal");
    navigation.removeAttribute("aria-labelledby");
    modalBackground.forEach(element => { if (element) element.inert = false; });
    if (restoreFocus) menu?.focus();
  }

  function openMenu() {
    if (!mobile.matches) return;
    document.body.classList.remove("account-search-open");
    searchToggle?.setAttribute("aria-expanded", "false");
    document.body.classList.add("account-menu-open");
    menu?.setAttribute("aria-expanded", "true");
    navigation.setAttribute("role", "dialog");
    navigation.setAttribute("aria-modal", "true");
    navigation.setAttribute("aria-labelledby", "account-navigation-title");
    modalBackground.forEach(element => { if (element) element.inert = true; });
    const targets = focusableNavigation();
    (targets.find(element => element.matches("a[data-account-section]")) || targets[0])?.focus();
  }

  function render({ focus = false } = {}) {
    const view = sectionFromHash();
    const query = normalize(search?.value || "");
    const searching = query.length > 0;
    content.dataset.view = searching ? "visao-geral" : view;
    content.dataset.searching = String(searching);
    if (servicesHeading) servicesHeading.hidden = searching || view !== "visao-geral";
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
      if (window.location.hash !== "#" + section) window.history.pushState(null, "", "#" + section);
      closeMenu();
      document.body.classList.remove("account-search-open");
      searchToggle?.setAttribute("aria-expanded", "false");
      render({ focus: true });
      if (link.hasAttribute("data-account-open-session")) {
        const disclosure = overview.querySelector("details");
        if (disclosure) { disclosure.open = true; disclosure.querySelector("summary")?.focus(); }
      }
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
    if (document.body.classList.contains("account-menu-open")) closeMenu(true);
    else openMenu();
  });
  menuClose?.addEventListener("click", () => closeMenu(true));
  document.addEventListener("keydown", event => {
    if (!document.body.classList.contains("account-menu-open")) return;
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    if (event.key === "Tab") {
      const targets = focusableNavigation();
      const first = targets[0], last = targets[targets.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !navigation.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !navigation.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  document.addEventListener("click", event => {
    if (document.body.classList.contains("account-menu-open") && !event.target.closest("#account-navigation, [data-account-menu]")) closeMenu(true);
  });
  const onHistoryNavigation = () => { closeMenu(); if (search) search.value = ""; render({ focus: true }); };
  window.addEventListener("hashchange", onHistoryNavigation);
  window.addEventListener("popstate", onHistoryNavigation);
  document.addEventListener("ordax:localechange", () => render());
  mobile.addEventListener("change", event => {
    if (!event.matches) {
      const focusedInMenu = navigation.contains(document.activeElement);
      closeMenu();
      if (focusedInMenu) navigation.querySelector("a[aria-current], a")?.focus();
    }
  });
  document.body.classList.add("account-enhanced");
  render();
})();
