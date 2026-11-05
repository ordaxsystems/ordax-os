"use strict";
// Single Windows process-tree termination policy for both the Electron Native
// host and the OS-owned Product Runtime Supervisor. No executable name scans.
const { spawnSync } = require("node:child_process");
const { isAbsolute, join } = require("node:path");

function stopOwnedWindowsProcessTree(pid, {
  windowsRoot = process.env.SystemRoot,
  execImpl = spawnSync,
} = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0xffffffff ||
      typeof windowsRoot !== "string" || !isAbsolute(windowsRoot) ||
      typeof execImpl !== "function") return false;
  try {
    const result = execImpl(join(windowsRoot, "System32", "taskkill.exe"),
      ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true, shell: false, stdio: "ignore", timeout: 5000,
      });
    return result?.status === 0 && !result.error && !result.signal;
  } catch { return false; }
}
module.exports = { stopOwnedWindowsProcessTree };
