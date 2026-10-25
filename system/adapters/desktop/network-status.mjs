// Windows/Desktop capability adapter for the existing ordax.network-status/1 port.
// Node-only host code. Never import this adapter into a browser Surface bundle.
import { networkInterfaces } from "node:os";
import { validateNetworkStatusSnapshot } from "../../contracts/network-status.mjs";

const SAFE_NAME = /^[A-Za-z0-9_.:-]{1,32}$/;

function capabilityName(input, index, used) {
  const candidate = String(input).replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 32);
  const base = SAFE_NAME.test(candidate) ? candidate : `host-interface-${index + 1}`;
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    const extra = `-${suffix++}`;
    name = base.slice(0, 32 - extra.length) + extra;
  }
  used.add(name);
  return name;
}

export function readDesktopNetworkStatus({ readInterfaces = networkInterfaces } = {}) {
  const interfaces = readInterfaces();
  if (!interfaces || typeof interfaces !== "object" || Array.isArray(interfaces)) {
    throw new TypeError("Desktop network interface reader returned an invalid snapshot");
  }
  const used = new Set();
  const entries = [];
  for (const [name, addresses] of Object.entries(interfaces).slice(0, 64)) {
    // Node's networkInterfaces() does not reliably expose hardware kind, link
    // health or Wi-Fi signal on Windows. Never invent that telemetry.
    if (!Array.isArray(addresses) || addresses.length === 0) continue;
    const active = addresses.some(address => address && !address.internal &&
      (address.family === "IPv4" || address.family === "IPv6" ||
        address.family === 4 || address.family === 6));
    entries.push({
      name: capabilityName(name, entries.length, used),
      kind: "other",
      state: active ? "connected" : "unknown",
      signalDbm: null,
    });
  }
  return validateNetworkStatusSnapshot({ interfaces: entries });
}
