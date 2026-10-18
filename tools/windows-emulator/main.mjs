// Development chrome only. Native owns the complete UI, including First Run.
const SURFACE_TARGET = "/system/composition/native/index.html";
const frame = document.querySelector("#ordax-emulator-surface");
if (!(frame instanceof HTMLIFrameElement)) throw new Error("Native Surface frame is missing");

async function readFirstRun() {
  const reply = await fetch("/__ordax/native/first-run", { cache: "no-store" });
  if (!reply.ok) throw new Error("Emulator First Run state is unavailable");
  return reply.json();
}

async function resetFirstRun() {
  const reply = await fetch("/__ordax/emulator/reset-first-run", { method: "POST" });
  if (!reply.ok) throw new Error("Could not reset development First Run");
  frame.contentWindow.location.reload();
}

window.__ORDAX_EMULATOR__ = Object.freeze({
  schema: "ordax.windows-emulator/1",
  kernel: false,
  host: "windows-development",
  repositoryBacked: true,
  surfaceTarget: SURFACE_TARGET,
  getFirstRunState: readFirstRun,
  resetFirstRun,
});
document.querySelector("#ordax-emulator-reset")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await resetFirstRun(); }
  catch (error) { document.querySelector("#ordax-emulator-status").textContent = error.message; }
  finally { button.disabled = false; }
});
frame.src = SURFACE_TARGET;
