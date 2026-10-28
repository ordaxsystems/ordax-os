// Windows x64 inference package integrity; the single owner of model/engine pins
// is system/services/local-ai/source-lock.json. No network or activation here.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

const LOCK_URL = new URL("../../services/local-ai/source-lock.json", import.meta.url);
const SHA = /^[0-9a-f]{64}$/;
const ENGINE_FILES = Object.freeze([
  "ggml-base.dll", "ggml-cpu.dll", "ggml.dll", "llama-common.dll",
  "llama-server-impl.dll", "llama-server.exe", "llama.dll", "mtmd.dll",
]);

function trustedIdentity(lock) {
  if (lock?.$schema !== "prototype-ordax.local-ai-source-lock/1" ||
      lock?.engine?.id !== "llama.cpp" ||
      !/^[0-9a-f]{40}$/.test(lock.engine.commit) ||
      lock?.model?.format !== "GGUF" ||
      !SHA.test(lock.model.sha256) ||
      !Number.isSafeInteger(lock.model.size_bytes) ||
      lock.model.size_bytes < 1 ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(lock.model.filename) ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(lock.model.id)) {
    throw Error("Untrusted canonical Local AI source lock");
  }
  const artifact = lock.engine.windows_artifact;
  if (artifact?.platform !== "windows-x86_64" ||
      artifact?.binary_format !== "PE" ||
      artifact?.architecture !== "x64" ||
      artifact.source_commit !== lock.engine.commit ||
      artifact.model_sha256 !== lock.model.sha256 ||
      !Array.isArray(artifact.files) ||
      artifact.files.length !== ENGINE_FILES.length) {
    throw Error("Canonical Windows Local AI engine pin unavailable");
  }
  const pinned = new Map();
  for (const entry of artifact.files) {
    if (!entry || typeof entry.name !== "string" ||
        !ENGINE_FILES.includes(entry.name) || pinned.has(entry.name) ||
        !SHA.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size_bytes) ||
        entry.size_bytes < 1 || entry.size_bytes > 512 * 1024 * 1024) {
      throw Error("Untrusted Windows Local AI binary pin");
    }
    pinned.set(entry.name, entry);
  }
  if (pinned.size !== ENGINE_FILES.length) throw Error("Incomplete Windows Local AI binary pins");
  return { model: lock.model, files: [...pinned.values()] };
}

async function realDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Error("Local AI package contains an unsafe directory");
  return realpath(path);
}

async function exactFile(dir, name, expectedBytes, expectedDigest) {
  if (basename(name) !== name || !SHA.test(expectedDigest))
    throw Error("Untrusted Local AI package member");
  const file = join(dir, name);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedBytes)
    throw Error("Local AI package file is missing or corrupt");
  const target = await realpath(file);
  if (!target.startsWith(dir + sep))
    throw Error("Local AI package file escapes verified root");
  const digest = createHash("sha256");
  const stream = createReadStream(file, { highWaterMark: 1024 * 1024 });
  for await (const bytes of stream) digest.update(bytes);
  if (digest.digest("hex") !== expectedDigest)
    throw Error("Local AI package file digest mismatch");
  return file;
}

// Test-only readLock substitution is internal to Node tests; the installed Host
// always invokes this with the OS source lock and trusted packaged root.
export async function verifyWindowsLocalAiPackage(packageRoot, { readLock = async () => JSON.parse(
  await readFile(LOCK_URL, "utf8")
) } = {}) {
  if (typeof packageRoot !== "string" || !packageRoot)
    throw TypeError("Verified Local AI package root required");
  const lock = await readLock();
  const pinned = trustedIdentity(lock);
  const root = await realDirectory(resolve(packageRoot));
  const engine = await realDirectory(join(root, "engine"));
  const models = await realDirectory(join(root, "models"));
  await Promise.all(pinned.files.map(item =>
    exactFile(engine, item.name, item.size_bytes, item.sha256)));
  const modelFile = await exactFile(models, pinned.model.filename,
    pinned.model.size_bytes, pinned.model.sha256);
  return Object.freeze({
    executable: join(engine, "llama-server.exe"),
    engineDirectory: engine,
    modelFile,
    modelId: pinned.model.id,
  });
}
