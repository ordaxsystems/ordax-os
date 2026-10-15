#!/usr/bin/env node
import { runBrowser, sleep } from "../browser-proof/chromium.mjs";

const url = process.env.ORDAX_WINDOWS_EMULATOR_URL
  ?? "http://127.0.0.1:4202/tools/windows-emulator/index.html";

runBrowser(async (client) => {
  const navigate = await client.send("Page.navigate", { url });
  if (navigate.errorText) throw new Error(`Windows emulator navigation failed: ${navigate.errorText}`);
  await sleep(1500);

  const response = await client.send("Runtime.evaluate", {
    expression: `(() => ({
      title: document.title,
      hasEmulatorApi: window.__ORDAX_EMULATOR__?.schema === "ordax.windows-emulator/1",
      kernelDisabled: window.__ORDAX_EMULATOR__?.kernel === false,
      firstRunVisible: Boolean(document.querySelector(".ordax-first-run")),
      nextActionVisible: Boolean(document.querySelector('[data-first-run-action="next"]')),
      surfaceTarget: document.querySelector("#ordax-emulator-surface")?.getAttribute("src") ?? null,
      bodyText: document.body.innerText.slice(0, 500),
    }))()`,
    returnByValue: true,
  });

  const result = response.result?.value;
  if (!result?.hasEmulatorApi) throw new Error("Windows emulator API did not initialize");
  if (!result.kernelDisabled) throw new Error("Windows emulator unexpectedly reports a kernel");
  if (!result.firstRunVisible || !result.nextActionVisible) {
    throw new Error(`Windows emulator first-run did not render: ${JSON.stringify(result)}`);
  }
  if (result.surfaceTarget !== "/system/composition/web/index.html") {
    throw new Error(`Unexpected Surface target: ${String(result.surfaceTarget)}`);
  }

  console.log("ORDAX_WINDOWS_EMULATOR_SMOKE=PASS");
  console.log(`ORDAX_WINDOWS_EMULATOR_TITLE=${result.title}`);
  console.log("ORDAX_WINDOWS_EMULATOR_KERNEL=DISABLED");
  console.log("ORDAX_WINDOWS_EMULATOR_OOBE=VISIBLE");
  return result;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
