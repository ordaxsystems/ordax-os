import { mkdir, readFile, writeFile, statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { freemem, homedir, networkInterfaces, totalmem, uptime } from "node:os";
import { createWindowsFileSpaceHost } from "./file-space-host.mjs";
import { createWindowsLocalSessionHost } from "./local-session-host.mjs";
import { createWindowsStatePersistenceHost } from "./state-persistence-host.mjs";
import { createWindowsDeviceRuntimeHost } from "./device-runtime-host.mjs";
import { createWindowsProfileRuntimeHost } from "./profile-runtime-host.mjs";
import { createWindowsLocalAiHost } from "./local-ai-host.mjs";
import { createWindowsAppDataHost } from "./app-data-host.mjs";

const execFileAsync = promisify(execFile);

export function windowsEmulatorStateRoot(env = process.env) {
  const base = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "OrdaX", "MvpEmulator");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(path, value) {
  await mkdir(windowsEmulatorStateRoot(), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function networkSnapshot() {
  const interfaces = [];
  for (const [rawName, entries] of Object.entries(networkInterfaces())) {
    const name = rawName.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 32) || "network";
    const active = Array.isArray(entries) && entries.some((entry) => entry && !entry.internal);
    const lower = rawName.toLowerCase();
    const kind = /wi-?fi|wireless|wlan/.test(lower) ? "wifi" : /ethernet|\beth\b|^eth/.test(lower) ? "ethernet" : "other";
    interfaces.push({ name, kind, state: active ? "connected" : "disconnected", signalDbm: null });
  }
  return { interfaces: interfaces.slice(0, 64) };
}

async function metricsSnapshot() {
  let userStorageTotalBytes = 0;
  let userStorageFreeBytes = 0;
  try {
    const stats = await statfs(process.env.USERPROFILE || homedir());
    userStorageTotalBytes = Number(stats.blocks) * Number(stats.bsize);
    userStorageFreeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {}
  return {
    uptimeSeconds: Math.max(0, Math.floor(uptime())),
    memoryTotalBytes: Math.max(0, Math.floor(totalmem())),
    memoryAvailableBytes: Math.max(0, Math.floor(freemem())),
    userStorageTotalBytes: Math.max(0, Math.floor(userStorageTotalBytes)),
    userStorageFreeBytes: Math.max(0, Math.floor(userStorageFreeBytes)),
  };
}

async function powerSnapshot() {
  if (process.platform !== "win32") return { battery: null, externalPower: null };
  try {
    const command = 'Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, timeout: 3000 });
    const text = stdout.trim();
    if (!text) return { battery: null, externalPower: null };
    const parsed = JSON.parse(text);
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    const percent = Number.isInteger(row?.EstimatedChargeRemaining) ? Math.max(0, Math.min(100, row.EstimatedChargeRemaining)) : 0;
    const status = Number(row?.BatteryStatus);
    const state = status === 1 ? "discharging" : status === 3 ? "full" : [6,7,8,9].includes(status) ? "charging" : status === 2 ? "not-charging" : "unknown";
    const externalPower = status === 1 ? false : [2,3,6,7,8,9].includes(status) ? true : null;
    return { battery: { percent, state }, externalPower };
  } catch {
    return { battery: null, externalPower: null };
  }
}

async function readBody(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createWindowsMvpNativeHostPlugin() {
  const stateRoot = windowsEmulatorStateRoot();
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const preferencesPath = join(stateRoot, "preferences.json");
  const firstRunPath = join(stateRoot, "first-run.json");
  const appDataHost = createWindowsAppDataHost(stateRoot, repoRoot);
  const fileSpaceHost = createWindowsFileSpaceHost(stateRoot);
  const localSessionHost = createWindowsLocalSessionHost(stateRoot);
  const localAiHost = createWindowsLocalAiHost(stateRoot, { isSessionLocked: localSessionHost.isLocked });
  const statePersistenceHost = createWindowsStatePersistenceHost(stateRoot);
  const deviceRuntimeHost = createWindowsDeviceRuntimeHost(stateRoot, repoRoot);
  const profileRuntimeHost = createWindowsProfileRuntimeHost(
    stateRoot,
    repoRoot,
    deviceRuntimeHost.session.profileActivationToken,
  );

  return {
    name: "ordax-windows-mvp-native-host",
    async transformIndexHtml(html, context) {
      if (!context?.path?.startsWith("/system/composition/native/")) return html;
      const appDataBindings = await appDataHost.getBindings();
      return {
        html,
        tags: [{
          tag: "script",
          injectTo: "head-prepend",
          children: `(() => {
            const messageHandlers = {
              ordaxBrowser: {
                postMessage(raw) {
                  let message;
                  try { message = JSON.parse(raw); } catch { return; }
                  if (message?.type !== "app-data.bootstrap.request") return;
                  import("/system/composition/native/app-data-bootstrap.mjs")
                    .then((module) => module.acceptTrustedNativeAppDataBootstrap({
                      schema: "ordax.native-app-data-composition-bootstrap/1",
                      bindings: ${JSON.stringify(appDataBindings)},
                    }))
                    .catch((error) => console.error("Windows MVP App Data bridge failed", error));
                },
              },
            };
            Object.defineProperty(window, "webkit", {
              configurable: true,
              value: Object.freeze({ messageHandlers: Object.freeze(messageHandlers) }),
            });
          })();`,
        }],
      };
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        try {
          const handledByAppData = await appDataHost.handle(req, res, url);
          if (handledByAppData) return;

          const handledByDeviceRuntime = await deviceRuntimeHost.handle(req, res, url);
          if (handledByDeviceRuntime) return;

          const handledByProfileRuntime = await profileRuntimeHost.handle(req, res, url);
          if (handledByProfileRuntime) return;

          const handledByLocalAi = await localAiHost(req, res, url);
          if (handledByLocalAi) return;

          const handledByStatePersistence = await statePersistenceHost(req, res, url);
          if (handledByStatePersistence) return;

          const handledByLocalSession = await localSessionHost(req, res, url);
          if (handledByLocalSession) return;

          const handledByFileSpace = await fileSpaceHost(req, res, url);
          if (handledByFileSpace) return;

          if (url.pathname === "/__ordax/native/preferences") {
            if (req.method === "GET") {
              const value = await readJson(preferencesPath);
              return value === null ? sendJson(res, 404, { error: "not-found" }) : sendJson(res, 200, value);
            }
            if (req.method === "POST") {
              const value = await readBody(req, 8192);
              await writeJson(preferencesPath, value ?? {});
              return sendJson(res, 200, { ok: true });
            }
          }

          if (url.pathname === "/__ordax/native/first-run") {
            if (req.method === "GET") {
              const value = await readJson(firstRunPath);
              return value === null ? sendJson(res, 404, { error: "not-found" }) : sendJson(res, 200, value);
            }
            if (req.method === "POST") {
              const value = await readBody(req, 4096);
              await writeJson(firstRunPath, value);
              return sendJson(res, 200, { ok: true });
            }
          }

          if (url.pathname === "/__ordax/native/network-status" && req.method === "GET") {
            return sendJson(res, 200, networkSnapshot());
          }

          if (url.pathname === "/__ordax/native/metrics" && req.method === "GET") {
            return sendJson(res, 200, await metricsSnapshot());
          }

          if (url.pathname === "/__ordax/native/power-status" && req.method === "GET") {
            return sendJson(res, 200, await powerSnapshot());
          }

          if (url.pathname === "/auth/session" && req.method === "GET") {
            return sendJson(res, 200, {
              $schema: "prototype-ordax.public-identity-session/1",
              provider: "unconfigured",
              authenticated: false,
              status: "signed-out",
            });
          }

          next();
        } catch (error) {
          sendJson(res, 500, { error: "windows-emulator-native-host", message: String(error?.message ?? error) });
        }
      });
    },
  };
}
