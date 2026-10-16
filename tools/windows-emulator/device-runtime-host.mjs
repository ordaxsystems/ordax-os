import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, release } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validateDeviceDisplayName, validateDeviceProfile } from "../../system/contracts/device-profile.mjs";
import { validateHardwareInventorySnapshot } from "../../system/contracts/hardware-inventory.mjs";
import { validateKeyboardLayoutSnapshot } from "../../system/contracts/keyboard-layout.mjs";
import { validateNetworkManagementSnapshot } from "../../system/contracts/network-management.mjs";
import { validateRecoveryStatusSnapshot } from "../../system/contracts/recovery-status.mjs";
import { validateUpdateHistorySnapshot } from "../../system/contracts/update-history.mjs";
import { validateUpdateStatusSnapshot } from "../../system/contracts/update-status.mjs";

const execFileAsync = promisify(execFile);
const LAYOUT_IDS = Object.freeze(["br-abnt2", "us"]);
const TOKEN_BYTES = 32;

function token() { return randomBytes(TOKEN_BYTES).toString("hex"); }
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}
function sendEmpty(res, status) { res.statusCode = status; res.setHeader("Cache-Control", "no-store"); res.end(); }

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}
async function atomicJson(root, path, value) {
  await mkdir(root, { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}
async function readRequestJson(req, maxBytes = 4096) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw new Error("request-too-large"); chunks.push(chunk); }
  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
async function powershell(command, timeout = 4000) {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}
async function gitSourceSha(repoRoot) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, windowsHide: true, timeout: 3000 });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : "0000000000000000000000000000000000000000";
  } catch { return "0000000000000000000000000000000000000000"; }
}

async function readHardwareInventory() {
  let devices = [];
  try {
    const text = await powershell("Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId.StartsWith('PCI\\') -or $_.InstanceId.StartsWith('USB\\') } | Select-Object -First 64 InstanceId,Service | ConvertTo-Json -Compress", 6000);
    if (text) {
      const parsed = JSON.parse(text); const rows = Array.isArray(parsed) ? parsed : [parsed];
      devices = rows.map((row, index) => {
        const instanceId = String(row?.InstanceId ?? "").trim();
        const bus = instanceId.toUpperCase().startsWith("USB\\") ? "usb" : "pci";
        const driver = typeof row?.Service === "string" && row.Service.trim() ? row.Service.trim().slice(0, 160) : null;
        return { id: `${bus}-${index + 1}`, bus, modalias: instanceId.slice(0, 512) || `${bus}:windows-device-${index + 1}`, driver };
      });
    }
  } catch { devices = []; }
  return validateHardwareInventorySnapshot({ schema: "ordax.hardware-inventory/1", architecture: arch(), kernelAbi: `windows-emulator-${release()}`, devices });
}

async function scanWifiNetworks() {
  try {
    const { stdout } = await execFileAsync("netsh.exe", ["wlan", "show", "networks", "mode=bssid"], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 });
    const ssids = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*SSID\s+\d+\s*:\s*(.+?)\s*$/i);
      if (!match) continue;
      const ssid = match[1].trim();
      if (!ssid || Buffer.byteLength(ssid, "utf8") > 32 || /[\x00-\x1f]/.test(ssid)) continue;
      if (!ssids.includes(ssid)) ssids.push(ssid);
      if (ssids.length >= 32) break;
    }
    return ssids;
  } catch { return []; }
}
async function currentWifiSsid() {
  try {
    const { stdout } = await execFileAsync("netsh.exe", ["wlan", "show", "interfaces"], { windowsHide: true, timeout: 4000, maxBuffer: 512 * 1024 });
    for (const line of stdout.split(/\r?\n/)) {
      if (/BSSID/i.test(line)) continue;
      const match = line.match(/^\s*SSID\s*:\s*(.+?)\s*$/i);
      if (!match) continue;
      const ssid = match[1].trim();
      if (ssid && Buffer.byteLength(ssid, "utf8") <= 32 && !/[\x00-\x1f]/.test(ssid)) return ssid;
    }
  } catch {}
  return null;
}
function networkSnapshot({ currentSsid, savedSsid, scanSsids }) {
  const names = [...new Set([currentSsid, savedSsid, ...scanSsids].filter(Boolean))].slice(0, 32);
  return validateNetworkManagementSnapshot({
    wifiInterface: "wlan0", currentSsid, savedSsid,
    networks: names.map((ssid, index) => ({ ssid, signalDbm: Math.max(-90, -48 - index * 4), security: "wpa-psk", connected: ssid === currentSsid, saved: ssid === savedSsid })),
  });
}

export function createWindowsDeviceRuntimeHost(stateRoot, repoRoot) {
  const deviceProfilePath = join(stateRoot, "device-profile.json");
  const keyboardPath = join(stateRoot, "keyboard-layout.json");
  const networkPath = join(stateRoot, "network-management.json");
  const heartbeatPath = join(stateRoot, "surface-heartbeat.json");
  const diagnosticPath = join(stateRoot, "client-diagnostic.json");
  const session = Object.freeze({ token: token(), networkToken: token(), diagnosticToken: token(), nativeInstallToken: token(), profileActivationToken: token() });
  const sourceShaPromise = gitSourceSha(repoRoot);
  const startedAt = new Date().toISOString();
  let appliedLayoutId = "br-abnt2";
  let hardwarePromise = null;

  const ensureDeviceProfile = async () => {
    const existing = await readJson(deviceProfilePath);
    if (existing !== null) return validateDeviceProfile(existing);
    const created = validateDeviceProfile({ schema: "ordax.device-profile/1", devicePublicId: `ordax-${randomBytes(16).toString("hex")}`, displayName: "Meu OrdaX" });
    await atomicJson(stateRoot, deviceProfilePath, created); return created;
  };
  const readKeyboard = async () => {
    const existing = await readJson(keyboardPath, { configuredLayoutId: "br-abnt2" });
    const configuredLayoutId = LAYOUT_IDS.includes(existing?.configuredLayoutId) ? existing.configuredLayoutId : "br-abnt2";
    return validateKeyboardLayoutSnapshot({ configuredLayoutId, appliedLayoutId, supportedLayoutIds: [...LAYOUT_IDS], restartRequired: configuredLayoutId !== appliedLayoutId });
  };
  void readJson(keyboardPath, { configuredLayoutId: "br-abnt2" }).then((existing) => { appliedLayoutId = LAYOUT_IDS.includes(existing?.configuredLayoutId) ? existing.configuredLayoutId : "br-abnt2"; });

  const readNetworkState = async (refreshScan = false) => {
    const stored = await readJson(networkPath, {}); const actualSsid = await currentWifiSsid();
    const currentSsid = Object.hasOwn(stored ?? {}, "currentSsid") ? stored.currentSsid : actualSsid;
    const savedSsid = typeof stored?.savedSsid === "string" ? stored.savedSsid : actualSsid;
    const scanSsids = refreshScan ? await scanWifiNetworks() : Array.isArray(stored?.scanSsids) ? stored.scanSsids : await scanWifiNetworks();
    return { currentSsid, savedSsid, scanSsids };
  };
  const saveNetworkState = async (value) => { await atomicJson(stateRoot, networkPath, value); return networkSnapshot(value); };
  const updateSnapshot = async () => {
    const sha = await sourceShaPromise;
    return validateUpdateStatusSnapshot({ sourceSha: sha, deliveryNumber: 0, runtimeSurfaceSha: sha, targetSha: "", status: "applied", phase: "idle", applyMode: "none", attemptId: "windows-mvp-emulator", bootRefreshRequired: false, baseUpdatePhase: "none", baseUpdateSha: "", checkedAt: new Date().toISOString(), lastAppliedSha: sha, lastAppliedAt: startedAt, lastApplyDurationSeconds: 0, lastStageDurationSeconds: 0, rejectedSha: "", lastError: "", healthToken: session.token });
  };
  const recoverySnapshot = async () => {
    const sha = await sourceShaPromise;
    return validateRecoveryStatusSnapshot({ schema: "ordax.recovery-status/1", layout: "portable-v2", bootSlot: "current", runningSourceSha: sha, currentSha: sha, knownGoodSha: sha, candidateSha: null, transactionPresent: false, recoveryEntryStatus: "verified", policy: "local-read-only", automaticNetwork: false, automaticMutation: false });
  };

  const handle = async (req, res, url) => {
    const path = url.pathname;
    if (path === "/__ordax/native/session" && req.method === "GET") {
      sendJson(res, 200, { token: session.token, networkToken: session.networkToken, diagnosticToken: session.diagnosticToken, productMode: "usb", nativeInstallAvailable: false, nativeInstallToken: session.nativeInstallToken, profileActivationAvailable: true, profileActivationToken: session.profileActivationToken, componentSlotReadAvailable: false, supportedActions: ["restart", "shutdown"] }); return true;
    }
    if (path === "/__ordax/native/device-profile") {
      if (req.method === "GET") { sendJson(res, 200, await ensureDeviceProfile()); return true; }
      if (req.method === "POST") {
        const body = await readRequestJson(req, 2048); if (!exactKeys(body, ["displayName"])) { sendEmpty(res, 400); return true; }
        const current = await ensureDeviceProfile(); const next = validateDeviceProfile({ ...current, displayName: validateDeviceDisplayName(body.displayName) });
        await atomicJson(stateRoot, deviceProfilePath, next); sendJson(res, 200, next); return true;
      }
      sendEmpty(res, 405); return true;
    }
    if (path === "/__ordax/native/keyboard-layout") {
      if (req.method === "GET") { sendJson(res, 200, await readKeyboard()); return true; }
      if (req.method === "POST") {
        const body = await readRequestJson(req, 512); if (!exactKeys(body, ["layoutId"]) || !LAYOUT_IDS.includes(body.layoutId)) { sendEmpty(res, 400); return true; }
        await atomicJson(stateRoot, keyboardPath, { configuredLayoutId: body.layoutId }); sendJson(res, 200, await readKeyboard()); return true;
      }
      sendEmpty(res, 405); return true;
    }
    if (path === "/__ordax/native/hardware-inventory" && req.method === "GET") { hardwarePromise ??= readHardwareInventory(); sendJson(res, 200, await hardwarePromise); return true; }
    if (path === "/__ordax/native/recovery-status" && req.method === "GET") { sendJson(res, 200, await recoverySnapshot()); return true; }
    if (path === "/__ordax/native/update-history" && req.method === "GET") { sendJson(res, 200, validateUpdateHistorySnapshot({ releases: [], applications: [] })); return true; }
    if (path === "/__ordax/native/update" && req.method === "GET") { sendJson(res, 200, await updateSnapshot()); return true; }
    if (path === "/__ordax/native/health" && req.method === "POST") {
      if (req.headers["x-ordax-health-token"] !== session.token) { sendEmpty(res, 403); return true; }
      const body = await readRequestJson(req, 1024); const sha = await sourceShaPromise;
      if (!exactKeys(body, ["sourceSha"]) || body.sourceSha !== sha) { sendEmpty(res, 400); return true; }
      sendEmpty(res, 204); return true;
    }
    if (path === "/__ordax/native/surface-heartbeat" && req.method === "POST") {
      const body = await readRequestJson(req, 1024); if (!exactKeys(body, ["sourceSha"]) || !/^[0-9a-f]{40}$/.test(body.sourceSha)) { sendEmpty(res, 400); return true; }
      await atomicJson(stateRoot, heartbeatPath, { sourceSha: body.sourceSha, observedAt: new Date().toISOString() }); sendEmpty(res, 204); return true;
    }
    if (path === "/__ordax/native/client-diagnostic" && req.method === "POST") {
      if (req.headers["x-ordax-diagnostic-token"] !== session.diagnosticToken) { sendEmpty(res, 403); return true; }
      const body = await readRequestJson(req, 2048); await atomicJson(stateRoot, diagnosticPath, { ...body, observedAt: new Date().toISOString() }); sendEmpty(res, 204); return true;
    }
    if (path === "/__ordax/native/network-management") {
      if (req.headers["x-ordax-network-token"] !== session.networkToken) { sendEmpty(res, 403); return true; }
      if (req.method === "GET") { const state = await readNetworkState(false); sendJson(res, 200, networkSnapshot(state)); return true; }
      if (req.method === "POST") {
        const body = await readRequestJson(req, 4096); if (!body || typeof body.action !== "string") { sendEmpty(res, 400); return true; }
        const state = await readNetworkState(body.action === "scan");
        if (body.action === "scan") { sendJson(res, 200, await saveNetworkState(state)); return true; }
        if (body.action === "connect") {
          if (typeof body.ssid !== "string" || typeof body.password !== "string" || Buffer.byteLength(body.password, "utf8") < 8 || Buffer.byteLength(body.password, "utf8") > 63) { sendEmpty(res, 400); return true; }
          state.currentSsid = body.ssid; state.savedSsid = body.ssid; if (!state.scanSsids.includes(body.ssid)) state.scanSsids.unshift(body.ssid);
        } else if (body.action === "disconnect") state.currentSsid = null;
        else if (body.action === "forget") state.savedSsid = null;
        else if (body.action === "reconnect") { if (!state.savedSsid) { sendEmpty(res, 409); return true; } state.currentSsid = state.savedSsid; }
        else { sendEmpty(res, 400); return true; }
        sendJson(res, 200, await saveNetworkState(state)); return true;
      }
      sendEmpty(res, 405); return true;
    }
    if (path === "/__ordax/native/power" && req.method === "POST") {
      if (req.headers["x-ordax-power-token"] !== session.token) { sendEmpty(res, 403); return true; }
      const body = await readRequestJson(req, 1024); if (!exactKeys(body, ["action"]) || !["restart", "shutdown"].includes(body.action)) { sendEmpty(res, 400); return true; }
      console.info(`ordax-emulator: MVP power action emulated safely: ${body.action}`); sendEmpty(res, 204); return true;
    }
    return false;
  };
  return Object.freeze({ handle, session });
}