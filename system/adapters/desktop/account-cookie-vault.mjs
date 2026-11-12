// Persist only the Desktop host's gateway cookies, encrypted with the
// current Windows user's DPAPI identity. Never expose them to the renderer.
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, lstat, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = "ordax.desktop-account-cookies/1";
const COOKIE_NAMES = new Set(["ordax_access", "ordax_refresh"]);
const COOKIE_VALUE = /^[^;\r\n]{1,16384}$/;
const MAX_FILE_BYTES = 100_000;
const FILENAME = "desktop-account-cookies.dpapi.json";

function validateCookies(entries) {
  if (!Array.isArray(entries) || entries.length > COOKIE_NAMES.size) throw TypeError("Invalid account cookie entries");
  const result = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 ||
        !COOKIE_NAMES.has(entry[0]) || typeof entry[1] !== "string" ||
        !COOKIE_VALUE.test(entry[1]) || result.has(entry[0])) {
      throw TypeError("Invalid account cookie entry");
    }
    result.set(entry[0], entry[1]);
  }
  return result;
}

async function dpapi(mode, bytes, entropy) {
  if (process.platform !== "win32") throw Error("Windows DPAPI is required for Desktop account persistence");
  const command = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$data=[Console]::In.ReadToEnd().Trim()
$bytes=[Convert]::FromBase64String($data)
$entropy=[Convert]::FromBase64String('${entropy}')
if ('${mode}' -eq 'protect') {
  $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
}
[Console]::Out.Write([Convert]::ToBase64String($result))
`;
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive",
      "-EncodedCommand", encoded], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let output = "", failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); }, 12000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", data => {
      output += data;
      if (output.length > MAX_FILE_BYTES) { failed = true; child.kill(); }
    });
    child.once("error", () => { failed = true; });
    child.once("close", code => {
      clearTimeout(timer);
      if (failed || code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.trim()))
        return reject(Error("Windows account DPAPI operation failed"));
      try { resolve(Buffer.from(output.trim(), "base64")); }
      catch { reject(Error("Invalid Windows DPAPI response")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(Buffer.from(bytes).toString("base64"));
  });
}

async function regularFileOrAbsent(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES)
      throw Error("Untrusted Desktop account vault");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createDesktopAccountCookieVault(userData, origin, {
  platform = process.platform, protect = dpapi, unprotect = dpapi,
} = {}) {
  if (platform !== "win32" || typeof userData !== "string" || !userData ||
      typeof origin !== "string" || !origin.startsWith("https://"))
    throw TypeError("Secure Windows account session requires a bound Desktop profile and HTTPS gateway");
  const fingerprint = createHash("sha256").update(origin, "utf8").digest("hex");
  const entropy = Buffer.from(fingerprint, "hex").toString("base64");
  const file = join(userData, FILENAME);
  return Object.freeze({
    async load() {
      if (!await regularFileOrAbsent(file)) return new Map();
      const raw = await readFile(file, "utf8");
      const envelope = JSON.parse(raw);
      if (!envelope || envelope.schema !== SCHEMA || envelope.originFingerprint !== fingerprint ||
          typeof envelope.ciphertext !== "string" ||
          envelope.ciphertext.length > MAX_FILE_BYTES ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext))
        throw Error("Untrusted Desktop account vault envelope");
      const plaintext = await unprotect("unprotect", Buffer.from(envelope.ciphertext, "base64"), entropy);
      const state = JSON.parse(plaintext.toString("utf8"));
      if (state?.schema !== SCHEMA || state?.originFingerprint !== fingerprint)
        throw Error("Desktop account vault gateway binding mismatch");
      return validateCookies(state.cookies);
    },
    async save(cookies) {
      const entries = [...validateCookies([...cookies]).entries()];
      await mkdir(userData, { recursive: true });
      if (!entries.length) {
        if (await regularFileOrAbsent(file)) await unlink(file);
        return;
      }
      const plaintext = Buffer.from(JSON.stringify({schema:SCHEMA,originFingerprint:fingerprint,cookies:entries}));
      const encrypted = await protect("protect", plaintext, entropy);
      if (!Buffer.isBuffer(encrypted) || encrypted.length < 32)
        throw Error("Desktop account cookies were not encrypted");
      const envelope = JSON.stringify({schema:SCHEMA,originFingerprint:fingerprint,
        ciphertext:encrypted.toString("base64")});
      if (Buffer.byteLength(envelope) > MAX_FILE_BYTES)
        throw Error("Desktop account vault exceeds size limit");
      await regularFileOrAbsent(file);
      const temp = join(userData, "." + FILENAME + "." + randomUUID());
      try {
        await writeFile(temp, envelope, {encoding:"utf8",mode:0o600,flag:"wx"});
        await rename(temp, file);
      } finally {
        await unlink(temp).catch(error => {if(error.code !== "ENOENT") throw error;});
      }
    },
  });
}
