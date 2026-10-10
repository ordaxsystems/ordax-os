import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync("sites/public/assets/site.js", "utf8");
const styles = fs.readFileSync("sites/public/assets/site.css", "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));

function element(tagName = "div") {
  const listeners = new Map();
  const attributes = new Map();
  return {
    tagName, hidden: false, children: [], parentElement: null, textContent: "",
    href: "", removed: false, focused: false,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      }
      this.removed = true;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    contains(node) { return node === this || this.children.some(child => child.contains(node)); },
    focus() { this.focused = true; },
    querySelector(selector) {
      if (selector === "[data-auth-nav-label]") return this.caption || null;
      if (selector === "a,button") {
        const find = node => node.children.find(child =>
          child.tagName === "a" || child.tagName === "button" || find(child));
        return find(this) || null;
      }
      return null;
    },
  };
}

function fixture({ signedIn = true } = {}) {
  const parent = element("nav");
  const login = element("a");
  login.caption = element("span");
  login.caption.textContent = "Entrar";
  login.href = "/login/";
  parent.appendChild(login);
  const register = element("a");
  register.caption = element("span");
  register.caption.textContent = "Criar conta";
  register.href = "/cadastro/";
  parent.appendChild(register);
  const doc = element("document");
  doc.body = { dataset: { page: "termos" } };
  doc.querySelector = selector => selector === ".site-header" ? header : null;
  doc.createElement = element;
  const header = {
    querySelector(selector) {
      return selector === '[data-auth-nav="login"]' ? login
        : selector === '[data-auth-nav="register"]' ? register : null;
    },
  };
  const events = {};
  const view = {
    window: {
      OrdaXPublicI18n: {
        schema: "prototype-ordax.public-site-localization-runtime/1",
        t(id) { return id === "account.navigation.account" ? "Minha conta" : id; },
        fromSource(text) { return text; },
      },
      location: { pathname: "/termos/", search: "", hash: "" },
      addEventListener(type, callback) { events[type] = callback; },
    },
    document: doc,
    fetch: async path => ({
      ok: true, async json() {
        return path === "/auth/session" ? {
          $schema: "prototype-ordax.public-identity-session/1",
          provider: "supabase", authenticated: signedIn,
          status: signedIn ? "authenticated" : "anonymous",
          ...(signedIn ? { subject: "test-subject" } : {}),
        } : { $schema: "prototype-ordax.public-site-runtime/1" };
      },
    }),
  };
  vm.runInNewContext(source, { ...view, URL, URLSearchParams, console });
  return {
    parent, login, register, doc, events, account: view.window.OrdaXPublicAccount,
    signOut() { signedIn = false; },
    menus() { return parent.children.filter(child => child.className === "ordax-profile-menu"); },
  };
}

function click(target) {
  let prevented = false;
  target.dispatch("click", { target, button: 0, preventDefault() { prevented = true; } });
  return prevented;
}

test("verified Minha conta opens one accessible menu with real routes and POST logout", async () => {
  const f = fixture();
  await flush();
  assert.equal(f.login.href, "/conta/");
  assert.equal(f.login.caption.textContent, "Minha conta");
  assert.equal(f.register.hidden, true);
  assert.equal(f.menus().length, 1);
  const menu = f.menus()[0];
  assert.equal(menu.hidden, true);
  assert.equal(f.login.getAttribute("role"), "button");
  assert.equal(f.login.getAttribute("aria-expanded"), "false");
  assert.equal(f.login.getAttribute("aria-controls"), "ordax-profile-menu");
  assert.equal(click(f.login), true);
  assert.equal(menu.hidden, false);
  assert.equal(f.login.getAttribute("aria-expanded"), "true");
  assert.deepEqual(menu.children.filter(child => child.tagName === "a").map(link => link.href), [
    "/conta/", "/conta/#seguranca", "/conta/#dispositivos", "/conta/#preferencias",
  ]);
  const form = menu.children.find(child => child.tagName === "form");
  assert.equal(form.method, "post");
  assert.equal(form.action, "/auth/logout");
  assert.equal(form.children[0].textContent, "Sair da conta");
  assert.equal(form.children[0].type, "submit");
  menu.dispatch("click", { target: menu.children[1] });
  assert.equal(menu.hidden, true, "selecting a real section closes the menu");
  assert.equal(f.login.getAttribute("aria-expanded"), "false");
  assert.ok(styles.includes(".ordax-profile-menu[hidden]{display:none!important}"));
});

test("outside click, Escape and locale refresh close menu and do not duplicate it", async () => {
  const f = fixture();
  await flush();
  const oldMenu = f.menus()[0];
  click(f.login);
  f.doc.dispatch("click", { target: element("outside") });
  assert.equal(oldMenu.hidden, true);
  click(f.login);
  f.doc.dispatch("keydown", { key: "Escape" });
  assert.equal(oldMenu.hidden, true);
  assert.equal(f.login.focused, true);
  f.login.dispatch("keydown", { key: "ArrowDown", preventDefault() {} });
  assert.equal(oldMenu.hidden, false);
  assert.equal(oldMenu.children[0].focused, true);
  f.login.dispatch("keydown", { key: " ", preventDefault() {} });
  assert.equal(oldMenu.hidden, true);
  f.doc.dispatch("ordax:localechange");
  await flush();
  assert.equal(oldMenu.removed, true);
  assert.equal(f.menus().length, 1);
});

test("revalidation removes logout and menu immediately when session is revoked", async () => {
  const f = fixture();
  await flush();
  click(f.login);
  f.signOut();
  f.events.pageshow({ persisted: true });
  assert.equal(f.menus().length, 0);
  await flush();
  assert.equal(f.menus().length, 0);
  assert.equal(f.login.href, "/login/");
  assert.equal(f.login.getAttribute("aria-expanded"), null);
  assert.equal(f.login.getAttribute("role"), null);
  assert.equal(f.register.hidden, false);
});

test("anonymous visitors never receive the authenticated profile menu", async () => {
  const f = fixture({ signedIn: false });
  await flush();
  assert.equal(f.menus().length, 0);
  assert.equal(f.login.href, "/login/");
  assert.equal(f.login.getAttribute("aria-haspopup"), null);
});

test("candidate profile menu uses registered candidate routes and native logout stays connected during submit", async () => {
  const f = fixture();
  await flush();
  const trigger = element("button");
  f.parent.appendChild(trigger);
  const dispose = f.account.bindProfileMenu(trigger, { accountRoute: "/conta-2/" });
  const menu = f.menus()[1];
  assert.deepEqual(menu.children.filter(child => child.tagName === "a").map(link => link.href), [
    "/conta-2/", "/conta-2/#dados-pessoais", "/conta-2/#seguranca",
    "/conta-2/#dispositivos", "/conta-2/#preferencias",
  ]);
  const form = menu.children.find(child => child.tagName === "form");
  form.dispatch("submit");
  assert.equal(f.account.getSnapshot().status, "leaving");
  assert.equal(f.account.getSnapshot().email, "");
  assert.equal(form.parentElement, menu);
  assert.equal(menu.removed, false, "removing the form during submit can cancel the native POST");
  assert.equal(menu.hidden, true);
  assert.equal((await f.account.refreshSession()).status, "leaving",
    "a refresh must not restore private data while the native logout is pending");
  dispose();
  assert.equal(menu.removed, true);
});

test("candidate menu cannot receive off-origin destinations or logout for an anonymous session", async () => {
  const f = fixture({ signedIn: false });
  await f.account.readSession();
  const trigger = element("button");
  f.parent.appendChild(trigger);
  const dispose = f.account.bindProfileMenu(trigger, { accountRoute: "https://untrusted.test/" });
  const menu = f.menus()[0];
  assert.deepEqual(menu.children.filter(child => child.tagName === "a").map(link => link.href), ["/login/", "/cadastro/"]);
  assert.equal(menu.children.some(child => child.tagName === "form"), false);
  dispose();
});
