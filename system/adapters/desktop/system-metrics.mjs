// OrdaX system-metrics/1 adapter: Windows host measurements, not a Linux
// kernel emulation. Memory and uptime are from Node's OS APIs; available
// storage is the real volume containing the per-user OrdaX profile.
import { totalmem, freemem, uptime } from "node:os";
import { statfs } from "node:fs/promises";
import { validateSystemMetricsSnapshot } from "../../contracts/system-metrics.mjs";

function safeBytes(value, label) {
  const number = typeof value === "bigint" ? value : BigInt(value);
  if (number < 0n || number > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Windows host ${label} exceeds a safe integer`);
  }
  return Number(number);
}

export async function readDesktopSystemMetrics(userData, {
  readVolume = statfs,
  totalMemory = totalmem,
  freeMemory = freemem,
  systemUptime = uptime,
} = {}) {
  if (typeof userData !== "string" || !userData) {
    throw new TypeError("Desktop metrics require the OrdaX user profile path");
  }
  const volume = await readVolume(userData, { bigint: true });
  if (!volume || volume.bsize === undefined || volume.blocks === undefined ||
      volume.bavail === undefined) {
    throw new TypeError("Windows storage volume metrics are unavailable");
  }
  const total = safeBytes(volume.blocks * volume.bsize, "volume size");
  const free = safeBytes(volume.bavail * volume.bsize, "available volume bytes");
  return validateSystemMetricsSnapshot({
    uptimeSeconds: Math.max(0, Math.floor(systemUptime())),
    memoryTotalBytes: totalMemory(),
    memoryAvailableBytes: freeMemory(),
    userStorageTotalBytes: total,
    userStorageFreeBytes: free,
  });
}
