import { validateApplicationCompatibilityInspection } from "../../contracts/application-compatibility.mjs";

const DOS_MAGIC = [0x4d, 0x5a];
const PE_SIGNATURE = [0x50, 0x45, 0x00, 0x00];
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const IMAGE_FILE_DLL = 0x2000;
const IMAGE_FILE_EXECUTABLE_IMAGE = 0x0002;
const SECTION_HEADER_BYTES = 40;
const MAX_IMAGE_SECTIONS = 96;
const PE32_MAGIC = 0x010b;
const PE32_PLUS_MAGIC = 0x020b;
const DOS_HEADER_SIZE = 0x40;
const COFF_HEADER_SIZE = 20;
const PE32_OPTIONAL_HEADER_MIN_SIZE = 96;
const PE32_PLUS_OPTIONAL_HEADER_MIN_SIZE = 112;

const PE_MACHINES = new Map([
  [0x014c, "x86"],
  [0x8664, "x86_64"],
  [0xaa64, "aarch64"],
]);

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Application compatibility inspection bytes must be binary data");
}

function hasSignature(data, offset, signature) {
  if (offset < 0 || offset + signature.length > data.length) return false;
  return signature.every((value, index) => data[offset + index] === value);
}

function readU16LE(data, offset) {
  if (offset < 0 || offset + 2 > data.length) return null;
  return data[offset] | (data[offset + 1] << 8);
}

function readU32LE(data, offset) {
  if (offset < 0 || offset + 4 > data.length) return null;
  return (
    data[offset]
    | (data[offset + 1] << 8)
    | (data[offset + 2] << 16)
    | (data[offset + 3] << 24)
  ) >>> 0;
}

function lowerExtension(name) {
  const normalized = String(name ?? "").trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot < 0 ? "" : normalized.slice(dot);
}

export function inspectWindowsPayload({ name, bytes: input }) {
  const data = asBytes(input);
  const payloadName = typeof name === "string" && name.trim() ? name.trim() : "unnamed";
  const extension = lowerExtension(payloadName);

  if (data.length >= 96 && hasSignature(data, 0, DOS_MAGIC)) {
    const peOffset = readU32LE(data, 0x3c);
    if (
      peOffset !== null
      && peOffset >= DOS_HEADER_SIZE
      && peOffset <= data.length - (PE_SIGNATURE.length + COFF_HEADER_SIZE + 2)
      && hasSignature(data, peOffset, PE_SIGNATURE)
    ) {
      const machine = readU16LE(data, peOffset + 4);
      const numberOfSections = readU16LE(data, peOffset + 6);
      const optionalHeaderSize = readU16LE(data, peOffset + 20);
      const characteristics = readU16LE(data, peOffset + 22);
      const optionalMagic = readU16LE(data, peOffset + 24);
      const architecture = PE_MACHINES.get(machine) ?? "unknown";
      const expectedMagic = architecture === "x86"
        ? PE32_MAGIC
        : (architecture === "x86_64" || architecture === "aarch64" ? PE32_PLUS_MAGIC : null);
      const optionalHeaderOffset = peOffset + PE_SIGNATURE.length + COFF_HEADER_SIZE;
      const minimumOptionalSize = expectedMagic === PE32_MAGIC
        ? PE32_OPTIONAL_HEADER_MIN_SIZE
        : PE32_PLUS_OPTIONAL_HEADER_MIN_SIZE;
      const validOptionalHeader = (
        expectedMagic !== null
        && optionalMagic === expectedMagic
        && optionalHeaderSize >= minimumOptionalSize
        && optionalHeaderOffset + optionalHeaderSize <= data.length
      );
      const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
      const validSectionTable = (
        numberOfSections >= 1
        && numberOfSections <= MAX_IMAGE_SECTIONS
        && sectionTableOffset + numberOfSections * SECTION_HEADER_BYTES <= data.length
      );
      const isExecutableImage = (characteristics & IMAGE_FILE_EXECUTABLE_IMAGE) !== 0;
      const isLibrary = (characteristics & IMAGE_FILE_DLL) !== 0;
      const launchable = architecture !== "unknown"
        && validOptionalHeader
        && validSectionTable
        && isExecutableImage
        && !isLibrary;
      return validateApplicationCompatibilityInspection({
        name: payloadName,
        family: "windows",
        kind: "windows-pe",
        role: isLibrary ? "library" : "executable",
        architecture,
        launchable,
        evidence: [
          "dos-mz-header",
          "pe-signature",
          `machine:0x${machine.toString(16).padStart(4, "0")}`,
          validOptionalHeader ? "valid-optional-header" : "invalid-optional-header",
          validSectionTable ? "valid-section-table" : "invalid-section-table",
          isExecutableImage ? "executable-image-characteristic" : "missing-executable-image-characteristic",
          isLibrary ? "dll-characteristic" : "not-dll-characteristic",
        ],
      });
    }
  }

  if (extension === ".msi" && hasSignature(data, 0, CFB_SIGNATURE)) {
    return validateApplicationCompatibilityInspection({
      name: payloadName,
      family: "windows",
      kind: "windows-msi",
      role: "installer",
      architecture: "unknown",
      launchable: false,
      evidence: [
        "compound-file-binary-signature",
        "msi-extension",
        "msi-database-verification-pending",
      ],
    });
  }

  return validateApplicationCompatibilityInspection({
    name: payloadName,
    family: null,
    kind: "unknown",
    role: "unknown",
    architecture: "unknown",
    launchable: false,
    evidence: extension ? [`untrusted-extension:${extension}`] : ["no-recognized-format"],
  });
}
