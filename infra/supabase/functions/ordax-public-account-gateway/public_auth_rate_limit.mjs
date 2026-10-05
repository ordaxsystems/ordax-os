const PUBLIC_CLIENT_ADDRESS_HEADER = "x-ordax-client-address";
const RATE_LIMIT_SCHEMA = "prototype-ordax.public-auth-rate-limit/1";
const RATE_LIMIT_BUCKETS = new Set([
  "credentials",
  "recovery-request",
  "recovery-completion",
]);

function canonicalIpv4(raw) {
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const canonical = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    canonical.push(String(value));
  }
  return canonical.join(".");
}

function ipv4TailToHextets(raw) {
  const ipv4 = canonicalIpv4(raw);
  if (!ipv4) return null;
  const octets = ipv4.split(".").map(Number);
  return [
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16),
  ];
}

function parseIpv6Side(raw, allowIpv4Tail) {
  if (!raw) return [];
  const parts = raw.split(":");
  if (parts.some((part) => !part)) return null;
  const result = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.includes(".")) {
      if (!allowIpv4Tail || index !== parts.length - 1) return null;
      const tail = ipv4TailToHextets(part);
      if (!tail) return null;
      result.push(...tail.map((value) => Number.parseInt(value, 16)));
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    result.push(Number.parseInt(part, 16));
  }
  return result;
}

function canonicalIpv6(raw) {
  if (!raw || raw.length > 64 || raw.includes("%") || raw.includes("[") || raw.includes("]")) return null;
  const firstCompression = raw.indexOf("::");
  if (firstCompression !== -1 && raw.indexOf("::", firstCompression + 2) !== -1) return null;

  let leftRaw = raw;
  let rightRaw = "";
  const compressed = firstCompression !== -1;
  if (compressed) {
    [leftRaw, rightRaw] = [raw.slice(0, firstCompression), raw.slice(firstCompression + 2)];
  }

  const rightMayContainIpv4 = Boolean(rightRaw) || !compressed;
  const left = parseIpv6Side(leftRaw, !rightRaw && rightMayContainIpv4);
  const right = parseIpv6Side(rightRaw, true);
  if (!left || !right) return null;

  const explicit = left.length + right.length;
  if (compressed) {
    if (explicit >= 8) return null;
  } else if (explicit !== 8) {
    return null;
  }
  const groups = compressed
    ? [...left, ...Array(8 - explicit).fill(0), ...right]
    : [...left, ...right];
  if (groups.length !== 8) return null;

  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < groups.length;) {
    if (groups[start] !== 0) {
      start += 1;
      continue;
    }
    let end = start;
    while (end < groups.length && groups[end] === 0) end += 1;
    const length = end - start;
    if (length >= 2 && length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
    start = end;
  }

  const text = groups.map((value) => value.toString(16));
  if (bestStart < 0) return text.join(":");
  const before = text.slice(0, bestStart).join(":");
  const after = text.slice(bestStart + bestLength).join(":");
  if (!before && !after) return "::";
  if (!before) return `::${after}`;
  if (!after) return `${before}::`;
  return `${before}::${after}`;
}

export function canonicalizePublicClientAddress(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 64 || value.includes(",") || /\s/.test(value)) return null;
  return value.includes(":") ? canonicalIpv6(value) : canonicalIpv4(value);
}

export function trustedPublicClientAddress(request) {
  const address = canonicalizePublicClientAddress(
    request.headers.get(PUBLIC_CLIENT_ADDRESS_HEADER),
  );
  if (!address) {
    return { ok: false, code: "trusted-client-address-required" };
  }
  return { ok: true, address };
}

export function validateRateLimitRpcResult(value, expectedBucket) {
  if (!RATE_LIMIT_BUCKETS.has(expectedBucket)) return null;
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (row.schema !== RATE_LIMIT_SCHEMA || row.bucket !== expectedBucket) return null;
  if (!["allowed", "rate_limited"].includes(row.decision)) return null;
  if (!Number.isInteger(row.limit_count) || row.limit_count < 1 || row.limit_count > 1000) return null;
  if (!Number.isInteger(row.remaining) || row.remaining < 0 || row.remaining > row.limit_count) return null;
  if (typeof row.reset_at !== "string" || !Number.isFinite(Date.parse(row.reset_at))) return null;

  if (row.decision === "rate_limited") {
    if (
      !Number.isInteger(row.retry_after_seconds)
      || row.retry_after_seconds < 1
      || row.retry_after_seconds > 60
      || row.remaining !== 0
    ) return null;
  } else if (row.retry_after_seconds !== null) {
    return null;
  }
  return row;
}
