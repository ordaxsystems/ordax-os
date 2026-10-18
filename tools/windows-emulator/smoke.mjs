#!/usr/bin/env node
import { runBrowser, sleep } from "../browser-proof/chromium.mjs";

const url = process.env.ORDAX_WINDOWS_EMULATOR_URL
  ?? "http://127.0.0.1:4202/tools/windows-emulator/index.html";
const STARTUP_TIMEOUT_MS = 30_000;
const STARTUP_POLL_MS = 250;

async function readState(client) {
  const response = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      hasEmulatorApi: window.__ORDAX_EMULATOR__?.schema === "ordax.windows-emulator/1",
      kernelDisabled: window.__ORDAX_EMULATOR__?.kernel === false,
      meridianEnabled: document.documentElement.hasAttribute('data-meridian'),
      firstRunAccent: getComputedStyle(document.querySelector('.ordax-first-run') ?? document.documentElement).getPropertyValue('--ordax-accent').trim(),
      meridianAccent: getComputedStyle(document.documentElement).getPropertyValue('--md-accent').trim(),
      firstRunVisible: Boolean(document.querySelector(".ordax-first-run")),
      nextActionVisible: Boolean(document.querySelector('[data-first-run-action="next"]')),
      surfaceTarget: window.__ORDAX_EMULATOR__?.surfaceTarget ?? null,
      frameSrc: document.querySelector("#ordax-emulator-surface")?.getAttribute("src") ?? null,
      firstRunState: window.__ORDAX_EMULATOR__?.getFirstRunState?.() ?? null,
      surfaceDocumentReady: Boolean(document.querySelector("#ordax-emulator-surface")?.contentDocument?.querySelector("#ordax-root")),
      surfaceBootState: document.querySelector("#ordax-emulator-surface")?.contentDocument?.querySelector("#ordax-boot-screen")?.getAttribute("data-state") ?? null,
      bodyText: document.body.innerText.slice(0, 500),
    }))()`,
    returnByValue: true,
  });
  return response.result?.value ?? null;
}

async function clickAction(client, action) {
  const response = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const button = document.querySelector(${JSON.stringify(`[data-first-run-action="${action}"]`)});
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (response.result?.value !== true) throw new Error(`Missing or disabled first-run action: ${action}`);
  await sleep(100);
}

runBrowser(async (client) => {
  const navigate = await client.send("Page.navigate", { url });
  if (navigate.errorText) throw new Error(`Windows emulator navigation failed: ${navigate.errorText}`);

  const startedAt = Date.now();
  let result = null;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    result = await readState(client);
    if (result?.hasEmulatorApi && result.firstRunVisible && result.nextActionVisible) break;
    await sleep(STARTUP_POLL_MS);
  }

  const browserExceptions = () => client.events
    .filter((event) => event.method === "Runtime.exceptionThrown")
    .map((event) => ({
      text: event.params?.exceptionDetails?.text ?? null,
      description: event.params?.exceptionDetails?.exception?.description ?? null,
      url: event.params?.exceptionDetails?.url ?? null,
      lineNumber: event.params?.exceptionDetails?.lineNumber ?? null,
      columnNumber: event.params?.exceptionDetails?.columnNumber ?? null,
    }));

  if (!result?.hasEmulatorApi) {
    throw new Error(`Windows emulator API did not initialize within ${STARTUP_TIMEOUT_MS}ms: ${JSON.stringify({ result, browserExceptions: browserExceptions() })}`);
  }
  if (!result.kernelDisabled) throw new Error("Windows emulator unexpectedly reports a kernel");
  if (!result.meridianEnabled || !result.meridianAccent || result.firstRunAccent !== result.meridianAccent) {
    throw new Error('Emulator first-run must consume the same Meridian tokens as Native: ' + JSON.stringify(result));
  }
  if (!result.firstRunVisible || !result.nextActionVisible) {
    throw new Error(`Windows emulator first-run did not render: ${JSON.stringify({ result, browserExceptions: browserExceptions() })}`);
  }
  if (result.surfaceTarget !== "/system/composition/web/?preview=layout") {
    throw new Error(`Unexpected Surface target: ${String(result.surfaceTarget)}`);
  }
  if (result.frameSrc !== "about:blank") {
    throw new Error(`Surface must remain inactive during OOBE, got: ${String(result.frameSrc)}`);
  }

  console.log("ORDAX_WINDOWS_EMULATOR_OOBE=VISIBLE");

  // Exercise the real first-run UI exactly as an offline/local Windows development host.
  await clickAction(client, "next");       // welcome -> regional
  await clickAction(client, "next");       // regional -> network
  await clickAction(client, "next");       // network -> security
  await clickAction(client, "next");       // security -> account
  await clickAction(client, "account-local"); // account -> privacy
  await clickAction(client, "next");       // privacy -> device name
  await clickAction(client, "next");       // device name -> ready
  await clickAction(client, "finish");     // ready -> completion

  const completionStartedAt = Date.now();
  while (Date.now() - completionStartedAt < STARTUP_TIMEOUT_MS) {
    result = await readState(client);
    if (
      result?.firstRunState?.completed === true
      && result.frameSrc === "/system/composition/web/?preview=layout"
      && result.surfaceDocumentReady
      && result.surfaceBootState === "ready"
    ) break;
    await sleep(STARTUP_POLL_MS);
  }

  if (result?.firstRunState?.completed !== true) {
    throw new Error(`Windows emulator OOBE did not persist completion: ${JSON.stringify(result)}`);
  }
  if (result.frameSrc !== "/system/composition/web/?preview=layout") {
    throw new Error(`Surface was not activated after OOBE: ${JSON.stringify(result)}`);
  }
  if (!result.surfaceDocumentReady || result.surfaceBootState !== "ready") {
    throw new Error(`Surface document did not become ready after OOBE: ${JSON.stringify({ result, browserExceptions: browserExceptions() })}`);
  }

  console.log("ORDAX_WINDOWS_EMULATOR_SMOKE=PASS");
  console.log(`ORDAX_WINDOWS_EMULATOR_STARTUP_MS=${Date.now() - startedAt}`);
  console.log(`ORDAX_WINDOWS_EMULATOR_TITLE=${result.title}`);
  console.log("ORDAX_WINDOWS_EMULATOR_KERNEL=DISABLED");
  console.log("ORDAX_WINDOWS_EMULATOR_OOBE=COMPLETED");
  console.log("ORDAX_WINDOWS_EMULATOR_SURFACE=ACTIVE");
  return result;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
