import { validateApplicationCompatibilityInspection } from "../../contracts/application-compatibility.mjs";
import { asApplicationBytes } from "./binary.mjs";

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];
const ARCHITECTURES = new Map([[3, "x86"], [62, "x86_64"], [183, "aarch64"]]);
const MAX_PROGRAM_HEADERS = 128;

function readUnsigned(data, offset, width) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + width > data.length) return null;
  let result = 0n;
  for (let i = 0; i < width; i++) result |= BigInt(data[offset + i]) << BigInt(8 * i);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

function validRange(offset, size, length) {
  return Number.isSafeInteger(offset) && Number.isSafeInteger(size)
    && offset >= 0 && size >= 0 && offset <= length && size <= length - offset;
}

/** Structural inspection, never installation or execution authority. */
export function inspectLinuxPayload({ name, bytes: input } = {}) {
  const data = asApplicationBytes(input);
  if (data.length < 4 || !ELF_MAGIC.every((byte, index) => data[index] === byte)) return null;
  const payloadName = typeof name === "string" && name.trim() ? name.trim() : "unnamed";
  const elfClass = data[4];
  const is64 = elfClass === 2;
  const headerSize = is64 ? 64 : 52;
  const entryWidth = is64 ? 8 : 4;
  const phEntrySize = is64 ? 56 : 32;
  const machine = readUnsigned(data, 18, 2);
  const architecture = ARCHITECTURES.get(machine) ?? "unknown";
  const elfType = readUnsigned(data, 16, 2);
  const version = readUnsigned(data, 20, 4);
  const fileHeaderSize = readUnsigned(data, is64 ? 52 : 40, 2);
  const programOffset = readUnsigned(data, is64 ? 32 : 28, entryWidth);
  const programEntrySize = readUnsigned(data, is64 ? 54 : 42, 2);
  const programCount = readUnsigned(data, is64 ? 56 : 44, 2);
  const entry = readUnsigned(data, is64 ? 24 : 24, entryWidth);
  const validHeader = (elfClass === 1 || elfClass === 2)
    && (architecture === "x86" ? elfClass === 1 : elfClass === 2)
    && data.length >= headerSize && data[5] === 1 && data[6] === 1
    && version === 1 && fileHeaderSize === headerSize
    && (elfType === 2 || elfType === 3) && architecture !== "unknown"
    && programCount >= 1 && programCount <= MAX_PROGRAM_HEADERS
    && programEntrySize === phEntrySize && programOffset >= headerSize
    && validRange(programOffset, programCount * phEntrySize, data.length)
    && entry !== null && entry !== 0;

  let executableEntry = false;
  let hasInterpreter = false;
  let validSegments = Boolean(validHeader);
  if (validHeader) {
    for (let i = 0; i < programCount; i++) {
      const base = programOffset + i * phEntrySize;
      const type = readUnsigned(data, base, 4);
      if (type !== 1 && type !== 3) continue;
      const offset = readUnsigned(data, base + (is64 ? 8 : 4), entryWidth);
      const size = readUnsigned(data, base + (is64 ? 32 : 16), entryWidth);
      if (!validRange(offset, size, data.length)) { validSegments = false; break; }
      if (type === 3) {
        // Dynamic PIE must have a real bounded, NUL-terminated interpreter record.
        if (hasInterpreter || size < 2 || size > 4096 || data[offset + size - 1] !== 0
          || data.subarray(offset, offset + size - 1).includes(0)) {
          validSegments = false; break;
        }
        hasInterpreter = true;
        continue;
      }
      const memSize = readUnsigned(data, base + (is64 ? 40 : 20), entryWidth);
      const virtualAddress = readUnsigned(data, base + (is64 ? 16 : 8), entryWidth);
      const flags = readUnsigned(data, base + (is64 ? 4 : 24), 4);
      if (memSize === null || virtualAddress === null || flags === null || memSize < size
        || !Number.isSafeInteger(virtualAddress + memSize)) {
        validSegments = false; break;
      }
      if ((flags & 1) !== 0 && entry >= virtualAddress && entry < virtualAddress + memSize) {
        executableEntry = true;
      }
    }
  }
  const appImageVersion = data.length >= 11 && data[8] === 0x41 && data[9] === 0x49
    && (data[10] === 1 || data[10] === 2) ? data[10] : null;
  const launchable = validHeader && validSegments && executableEntry
    && (elfType === 2 || hasInterpreter) && appImageVersion === null;
  return validateApplicationCompatibilityInspection({
    name: payloadName,
    family: "linux",
    kind: appImageVersion !== null ? "linux-appimage" : "linux-elf",
    role: elfType === 2 || elfType === 3 ? "executable" : "unknown",
    architecture,
    launchable,
    evidence: [
      validHeader ? "valid-elf-header" : "invalid-elf-header",
      validSegments ? "bounded-program-segments" : "invalid-program-segments",
      executableEntry ? "executable-entry-in-load-segment" : "missing-executable-entry",
      hasInterpreter ? "interpreter-present" : "no-interpreter",
      appImageVersion !== null ? `appimage-type${appImageVersion}-verification-pending` : "ordinary-elf",
    ],
  });
}
