#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runBrowser, sleep } from "../browser-proof/chromium.mjs";
import { windowsEmulatorStateRoot } from "./native-host.mjs";

const url = "http://127.0.0.1:4202/system/composition/native/";
const timeoutMs = 30_000;
const firstPartyAppIds = Object.freeze(["files", "studio", "settings", "system", "account", "store"]);

const studioSourceLock = JSON.parse(
  await readFile(
    new URL("../../system/services/device-agent/studio-runtime-source-lock.json", import.meta.url),
    "utf8",
  ),
);

if (
  studioSourceLock?.distribution?.runtime_packaged_in_stable !== false
  || studioSourceLock?.distribution?.runtime_network_download_allowed !== false
  || studioSourceLock?.distribution?.source_binding_only !== true
) {
  throw new Error("Studio Stable runtime source lock no longer matches the emulator fidelity contract");
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description
      ?? response.exceptionDetails.text
      ?? "Browser evaluation failed",
    );
  }
  return response.result?.value;
}

function isExpectedUnavailableResourceLog(message) {
  return /^Failed to load resource: the server responded with a status of (404|503) \(/.test(message);
}

function fatalBrowserErrors(client) {
  const exceptions = client.events
    .filter((event) => event.method === "Runtime.exceptionThrown")
    .map((event) => event.params?.exceptionDetails?.exception?.description
      ?? event.params?.exceptionDetails?.text
      ?? "Runtime exception");
  const consoleErrors = client.events
    .filter((event) => event.method === "Runtime.consoleAPICalled" && event.params?.type === "error")
    .map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  const browserLogs = client.events
    .filter((event) => event.method === "Log.entryAdded" && event.params?.entry?.level === "error")
    .map((event) => event.params?.entry?.text ?? "Browser log error")
    .filter((message) => !isExpectedUnavailableResourceLog(message));
  return [...exceptions, ...consoleErrors, ...browserLogs].filter(Boolean);
}

async function waitFor(client, expression, predicate, label) {
  const startedAt = Date.now();
  let value = null;
  while (Date.now() - startedAt < timeoutMs) {
    value = await evaluate(client, expression);
    if (predicate(value)) return value;
    await sleep(150);
  }
  throw new Error(`${label} timed out: ${JSON.stringify({ value, browserErrors: fatalBrowserErrors(client) })}`);
}

async function clickVisibleSelector(client, selector, label) {
  const point = await evaluate(client, `(() => {
    const diagnostics = [];
    const candidates = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    for (const element of candidates) {
      if (!(element instanceof HTMLElement) || element.disabled || element.getClientRects().length === 0) continue;
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit === element || element.contains(hit)) return { ok: true, x, y };
      diagnostics.push({
        aria: element.getAttribute("aria-label"),
        title: element.getAttribute("title"),
        className: element.className,
        hit: hit?.getAttribute?.("aria-label") ?? hit?.getAttribute?.("data-window-id") ?? hit?.tagName ?? null,
      });
    }
    return { ok: false, reason: "no-reachable-control", diagnostics };
  })()`);
  if (!point?.ok) {
    throw new Error(`${label} is not physically reachable: ${JSON.stringify({ selector, point })}`);
  }
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(100);
}

async function waitForWindow(client, appId) {
  return waitFor(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`[data-window-id="${appId}"]`)});
      return Boolean(node && !node.hidden && node.getClientRects().length > 0);
    })()`,
    Boolean,
    `${appId} visible window`,
  );
}

async function launchApp(client, appId) {
  const selector = `[data-launch-app="${appId}"]`;
  try {
    await clickVisibleSelector(client, selector, `launch ${appId}`);
  } catch (error) {
    return Object.freeze({ id: appId, launched: false, title: null, alerts: [error.message] });
  }
  await waitForWindow(client, appId);
  return evaluate(client, `(() => {
    const windowNode = document.querySelector(${JSON.stringify(`[data-window-id="${appId}"]`)});
    return {
      id: ${JSON.stringify(appId)},
      launched: Boolean(windowNode && !windowNode.hidden && windowNode.getClientRects().length > 0),
      title: windowNode?.querySelector(".ordax-window-title")?.textContent?.trim() || null,
      alerts: Array.from(windowNode?.querySelectorAll('[role="alert"]') ?? [])
        .map((entry) => entry.textContent?.trim() || "")
        .filter(Boolean),
    };
  })()`);
}

async function checkFiles(client) {
  const documentsSelector = '[data-window-id="files"] [data-file-open-path="/Documentos"]';
  await waitFor(client, `(() => Boolean(document.querySelector(${JSON.stringify(documentsSelector)})))()`, Boolean, "Files Documentos action");
  await clickVisibleSelector(client, documentsSelector, "Files Documentos action");
  const path = await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="files"] [data-app-extension="file-space"]')?.dataset.fileSpacePath ?? null)()`,
    (value) => value === "/Documentos",
    "Files /Documentos navigation",
  );
  return Object.freeze({ path });
}

async function selectSettingsSection(client, section) {
  const selector = `[data-window-id="settings"] [data-settings-section="${section}"]`;
  await waitFor(client, `(() => Boolean(document.querySelector(${JSON.stringify(selector)})))()`, Boolean, `Settings ${section} section`);
  await clickVisibleSelector(client, selector, `Settings ${section} section`);
  await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="settings"] [data-app-extension="settings-overview"]')?.dataset.settingsActiveSection ?? null)()`,
    (value) => value === section,
    `Settings ${section} activation`,
  );
}

async function checkSettings(client) {
  await selectSettingsSection(client, "regional");
  const keyboardLayout = await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="settings"] [data-settings-keyboard-layout][data-selected="true"]')?.dataset.settingsKeyboardLayout ?? null)()`,
    (value) => typeof value === "string" && value.length > 0,
    "Settings keyboard layout",
  );
  if (keyboardLayout !== "br-abnt2") {
    throw new Error(`Unexpected Windows emulator keyboard layout: ${keyboardLayout}`);
  }

  await selectSettingsSection(client, "network");
  const networkActions = await waitFor(
    client,
    `(() => document.querySelectorAll('[data-window-id="settings"] [data-settings-network-action]').length)()`,
    (value) => Number.isInteger(value) && value >= 1,
    "Settings native network actions",
  );

  await selectSettingsSection(client, "intelligence");
  const localAiState = await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="settings"] [data-settings-local-ai-state]')?.dataset.settingsLocalAiState ?? null)()`,
    (value) => typeof value === "string" && value.length > 0,
    "Settings local AI state",
  );
  if (localAiState !== "unavailable") {
    throw new Error(`Windows emulator unexpectedly activated Local AI: ${localAiState}`);
  }

  return Object.freeze({ keyboardLayout, networkActions, localAiState });
}

async function selectSystemSection(client, section) {
  const selector = `[data-window-id="system"] [data-system-section="${section}"]`;
  await waitFor(client, `(() => Boolean(document.querySelector(${JSON.stringify(selector)})))()`, Boolean, `System ${section} section`);
  await clickVisibleSelector(client, selector, `System ${section} section`);
  await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="system"] [data-app-extension="system-overview"]')?.dataset.systemActiveSection ?? null)()`,
    (value) => value === section,
    `System ${section} activation`,
  );
}

async function checkSystem(client) {
  await selectSystemSection(client, "overview");
  const overviewCards = await waitFor(
    client,
    `(() => document.querySelectorAll('[data-window-id="system"] .ordax-system-summary .ordax-system-card').length)()`,
    (value) => value === 5,
    "System overview cards",
  );

  await selectSystemSection(client, "storage");
  const storageCards = await waitFor(
    client,
    `(() => document.querySelectorAll('[data-window-id="system"] .ordax-system-resource-grid .ordax-system-card').length)()`,
    (value) => value === 1,
    "System storage metrics",
  );

  await selectSystemSection(client, "updates");
  const recoveryFacts = await waitFor(
    client,
    `(() => document.querySelectorAll('[data-window-id="system"] [data-system-recovery] .ordax-system-fact').length)()`,
    (value) => value === 7,
    "System recovery facts",
  );

  return Object.freeze({ overviewCards, storageCards, recoveryFacts });
}

async function checkAccount(client) {
  const state = await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="account"] .ordax-account-status')?.dataset.state ?? null)()`,
    (value) => typeof value === "string" && value.length > 0,
    "Account identity state",
  );
  if (state !== "unavailable") throw new Error(`Unexpected emulator account state: ${state}`);
  return Object.freeze({ state });
}

async function checkStore(client) {
  const state = await waitFor(
    client,
    `(() => document.querySelector('[data-window-id="store"] [data-app-extension="store-overview"]')?.dataset.storeState ?? null)()`,
    (value) => typeof value === "string" && value.length > 0,
    "Store catalog state",
  );
  if (state !== "unavailable") throw new Error(`Unexpected emulator Store state: ${state}`);
  return Object.freeze({ state });
}

async function checkStudio(client) {
  const result = await waitFor(
    client,
    `(() => {
      const extension = document.querySelector('[data-window-id="studio"] [data-app-extension="studio-workspace"]');
      if (!extension) return null;
      return {
        runtimeMounted: Boolean(extension.querySelector('[data-studio-workspace="true"]')),
        fallbackPresent: Boolean(extension.querySelector('.ordax-app-panel-body')),
      };
    })()`,
    (value) => value !== null,
    "Studio fallback extension",
  );
  if (result.runtimeMounted || !result.fallbackPresent) {
    throw new Error(`Studio Stable runtime packaging boundary changed: ${JSON.stringify(result)}`);
  }
  return Object.freeze({ state: "runtime-not-packaged", runtimeMounted: false });
}

const functionalChecks = Object.freeze({
  files: checkFiles,
  studio: checkStudio,
  settings: checkSettings,
  system: checkSystem,
  account: checkAccount,
  store: checkStore,
});

await rm(join(windowsEmulatorStateRoot(), "first-run.json"), { force: true });

runBrowser(async (client) => {
  const navigation = await client.send("Page.navigate", { url });
  if (navigation.errorText) throw new Error(navigation.errorText);

  await waitFor(
    client,
    `(() => ({
      visible: Boolean(document.querySelector(".ordax-first-run")),
      next: Boolean(document.querySelector('[data-first-run-action="next"]')),
    }))()`,
    (value) => value?.visible && value.next,
    "native MVP OOBE",
  );
  console.log("ORDAX_WINDOWS_MVP_OOBE=NATIVE_VISIBLE");

  for (const action of ["next", "next", "next", "next", "account-local", "next", "finish"]) {
    await clickVisibleSelector(client, `[data-first-run-action="${action}"]`, `first-run ${action}`);
  }

  const ready = await waitFor(
    client,
    `(() => ({
      title: document.title,
      bootState: document.querySelector("#ordax-boot-screen")?.getAttribute("data-state") ?? null,
      workspaceVisible: Boolean(document.querySelector("[data-workspace]")),
      launcherElements: document.querySelectorAll("[data-launch-app]").length,
    }))()`,
    (value) => value?.bootState === "ready" && value.workspaceVisible && value.launcherElements === 21,
    "native MVP workspace",
  );

  const launchResults = [];
  const functionalResults = {};
  for (const appId of firstPartyAppIds) {
    const launched = await launchApp(client, appId);
    launchResults.push(launched);
    if (!launched.launched || launched.alerts.length > 0) {
      throw new Error(`Native MVP app launch gate failed: ${JSON.stringify(launched)}`);
    }
    functionalResults[appId] = await functionalChecks[appId](client);
  }

  console.log(`ORDAX_WINDOWS_MVP_APP_LAUNCH_RESULTS=${JSON.stringify(launchResults)}`);
  console.log(`ORDAX_WINDOWS_MVP_FIRST_PARTY_APPS=${firstPartyAppIds.length}`);
  console.log(`ORDAX_WINDOWS_MVP_APPS_OPENED=${launchResults.filter((entry) => entry.launched).length}/${firstPartyAppIds.length}`);

  const errors = fatalBrowserErrors(client);
  if (errors.length > 0) throw new Error(`Native MVP browser errors: ${JSON.stringify(errors)}`);

  console.log(`ORDAX_WINDOWS_MVP_FUNCTIONAL_RESULTS=${JSON.stringify(functionalResults)}`);
  console.log("ORDAX_WINDOWS_MVP_FUNCTIONS=PASS");
  console.log("ORDAX_WINDOWS_MVP_SMOKE=PASS");
  console.log(`ORDAX_WINDOWS_MVP_TITLE=${ready.title}`);
  console.log(`ORDAX_WINDOWS_MVP_LAUNCHER_ELEMENTS=${ready.launcherElements}`);
  console.log("ORDAX_WINDOWS_MVP_COMPOSITION=NATIVE");
  return functionalResults;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
