import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HOSTED_ACCOUNT_SIGNUP_URL, isHostedSignupEnabled, requestNativeHostedSignup } from "../system/services/account/hosted-signup.mjs";
import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from "../system/contracts/product-family.mjs";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("hosted signup derives only from the canonical OrdaX public origin", () => {
  assert.equal(PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin, "https://ordax.com.br");
  assert.equal(HOSTED_ACCOUNT_SIGNUP_URL, "https://ordax.com.br/cadastro/");
  const url = new URL(HOSTED_ACCOUNT_SIGNUP_URL);
  assert.equal(url.protocol, "https:");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
});

test("hosted signup requires explicit server-owned public authorization", () => {
  for (const policy of [undefined, null, {}, { registrationEnabled: true }, { publicRegistrationEnabled: false }, { publicRegistrationEnabled: "true" }]) {
    assert.equal(isHostedSignupEnabled(policy), false);
  }
  assert.equal(isHostedSignupEnabled({ registrationEnabled: false, publicRegistrationEnabled: true }), true);
});

test("Native First Run offers hosted registration without spoofing account authority", async () => {
  const [ui, css] = await Promise.all([
    read("system/surface/ui/first-run.mjs"),
    read("system/surface/ui/first-run.css"),
  ]);
  assert.match(ui, /if \(capabilitySnapshot\.identityRegister\) \{/);
  assert.match(ui, /hostedRegistration\.href = HOSTED_ACCOUNT_SIGNUP_URL/);
  assert.match(ui, /hostedRegistration\.target = "_blank"/);
  assert.match(ui, /hostedRegistration\.rel = "noopener noreferrer"/);
  assert.match(ui, /dataset\.firstRunHostedSignup/);
  assert.match(ui, /else if \(hostedSignupAllowed\)/);
  assert.match(ui, /hostedSignupAllowed = isHostedSignupEnabled\(policy\)/);
  assert.match(ui, /Novos cadastros ainda não estão disponíveis/);
  assert.match(ui, /Após confirmar seu e-mail, volte ao OrdaX e entre/);
  assert.match(ui, /"account-local"/);
  assert.match(css, /\.ordax-first-run-action\[href\]/);
});

test("Native Account settings offers the same hosted flow only when direct register is unavailable", async () => {
  const source = await read("system/surface/ui/account-overview-controls.mjs");
  assert.match(source, /if \(isIdentityActionSupported\(actionsSnapshot, "register"\)\) \{/);
  assert.match(source, /hostedRegistration\.href = HOSTED_ACCOUNT_SIGNUP_URL/);
  assert.match(source, /hostedRegistration\.target = "_blank"/);
  assert.match(source, /hostedRegistration\.rel = "noopener noreferrer"/);
  assert.match(source, /dataset\.accountHostedSignup/);
  assert.match(source, /else if \(hostedSignupAllowed\)/);
  assert.match(source, /hostedSignupAllowed = isHostedSignupEnabled\(policy\)/);
  assert.match(source, /t\("account.action.hostedRegister"\)/);
  assert.match(source, /t\("account.registration.unavailable"\)/);
  assert.doesNotMatch(source, /window\.location\.assign\(HOSTED_ACCOUNT_SIGNUP_URL\)/);
});

test("hosted signup uses the privileged Native broker only for explicit user clicks", () => {
  const messages = [];
  const nativeWindow = { webkit: { messageHandlers: { ordaxBrowser: {
    postMessage(value) { messages.push(JSON.parse(value)); },
  } } } };
  let prevented = 0;
  const event = { preventDefault() { prevented += 1; } };
  assert.equal(requestNativeHostedSignup(event, {}), false);
  assert.equal(prevented, 0);
  // External pages retain normal browser navigation; a privileged loopback
  // Surface with a lost bridge never navigates to the Internet as fallback.
  assert.equal(requestNativeHostedSignup(event, {
    location: { protocol: "https:", hostname: "web.ordax.com.br" },
  }), false);
  assert.equal(prevented, 0);
  assert.equal(requestNativeHostedSignup(event, {
    location: { protocol: "http:", hostname: "127.0.0.1" },
  }), false);
  assert.equal(prevented, 1);
  assert.equal(requestNativeHostedSignup(event, nativeWindow), true);
  assert.deepEqual(messages, [{ type: "account.signup.open" }]);
  assert.equal(prevented, 2);
  // Neither credentials nor caller-controlled URLs cross the privileged bridge.
  assert.deepEqual(Object.keys(messages[0]), ["type"]);
  // Failed host bridging must not fall back to top-level Surface navigation.
  const brokenWindow = { webkit: { messageHandlers: { ordaxBrowser: {
    postMessage() { throw new Error("host offline"); },
  } } } };
  assert.equal(requestNativeHostedSignup(event, brokenWindow), false);
  assert.equal(prevented, 3);
});
