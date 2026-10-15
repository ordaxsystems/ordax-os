#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runBrowser, sleep } from "../browser-proof/chromium.mjs";
import { windowsEmulatorStateRoot } from "./native-host.mjs";

const url = "http://127.0.0.1:4202/system/composition/native/";
const timeoutMs = 30_000;

async function evaluate(client) {
  const response = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      title: document.title,
      bootState: document.querySelector("#ordax-boot-screen")?.getAttribute("data-state") ?? null,
      bootText: document.querySelector("[data-ordax-boot-status]")?.textContent ?? null,
      firstRunVisible: Boolean(document.querySelector(".ordax-first-run")),
      nextVisible: Boolean(document.querySelector('[data-first-run-action="next"]')),
      workspaceVisible: Boolean(document.querySelector("[data-workspace]")),
      launcherApps: document.querySelectorAll("[data-launch-app]").length,
      bodyText: document.body.innerText.slice(0, 1000),
    }))()`,
    returnByValue: true,
  });
  return response.result?.value ?? null;
}

async function waitFor(client, predicate, label) {
  const startedAt = Date.now();
  let state = null;
  while (Date.now() - startedAt < timeoutMs) {
    state = await evaluate(client);
    if (predicate(state)) return state;
    await sleep(200);
  }
  const exceptions = client.events.filter((event) => event.method === "Runtime.exceptionThrown").map((event) => event.params?.exceptionDetails?.exception?.description ?? event.params?.exceptionDetails?.text);
  const consoleErrors = client.events.filter((event) => event.method === "Runtime.consoleAPICalled" && event.params?.type === "error").map((event) => event.params?.args?.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  const browserLogs = client.events.filter((event) => event.method === "Log.entryAdded").map((event) => `${event.params?.entry?.level}: ${event.params?.entry?.text}`);
  throw new Error(`${label} timed out: ${JSON.stringify({ state, exceptions, consoleErrors, browserLogs })}`);
}

async function click(client, action) {
  const response = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector(${JSON.stringify('[data-first-run-action="ACTION"]'.replace('ACTION', action))});
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (response.result?.value !== true) throw new Error(`first-run action unavailable: ${action}`);
  await sleep(120);
}

await rm(join(windowsEmulatorStateRoot(), "first-run.json"), { force: true });

runBrowser(async (client) => {
  const navigation = await client.send("Page.navigate", { url });
  if (navigation.errorText) throw new Error(navigation.errorText);

  let state = await waitFor(
    client,
    (value) => value?.firstRunVisible && value.nextVisible,
    "native MVP OOBE",
  );
  console.log("ORDAX_WINDOWS_MVP_OOBE=NATIVE_VISIBLE");

  await click(client, "next");
  await click(client, "next");
  await click(client, "next");
  await click(client, "next");
  await click(client, "account-local");
  await click(client, "next");
  await click(client, "finish");

  state = await waitFor(
    client,
    (value) => value?.bootState === "ready" && value.workspaceVisible && value.launcherApps > 0,
    "native MVP workspace",
  );

  console.log("ORDAX_WINDOWS_MVP_SMOKE=PASS");
  console.log(`ORDAX_WINDOWS_MVP_TITLE=${state.title}`);
  console.log(`ORDAX_WINDOWS_MVP_LAUNCHER_APPS=${state.launcherApps}`);
  console.log("ORDAX_WINDOWS_MVP_COMPOSITION=NATIVE");
  return state;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
