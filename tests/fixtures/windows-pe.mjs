// Synthetic PE bytes for compatibility inspection tests only; not a runnable program.
export function peFixture({
  machine = 0x8664,
  dll = false,
  executable = true,
  sections = 1,
  optionalMagic = machine === 0x014c ? 0x010b : 0x020b,
  optionalHeaderSize = machine === 0x014c ? 0xe0 : 0xf0,
  fileSize = 512,
  peOffset = 0x80,
} = {}) {
  const bytes = new Uint8Array(fileSize);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes[0x3c] = peOffset;
  bytes[peOffset] = 0x50;
  bytes[peOffset + 1] = 0x45;
  bytes[peOffset + 4] = machine & 0xff;
  bytes[peOffset + 5] = (machine >> 8) & 0xff;
  bytes[peOffset + 6] = sections & 0xff;
  bytes[peOffset + 7] = (sections >> 8) & 0xff;
  bytes[peOffset + 20] = optionalHeaderSize & 0xff;
  bytes[peOffset + 21] = (optionalHeaderSize >> 8) & 0xff;
  bytes[peOffset + 22] = executable ? 0x02 : 0x00;
  bytes[peOffset + 23] = dll ? 0x20 : 0x00;
  bytes[peOffset + 24] = optionalMagic & 0xff;
  bytes[peOffset + 25] = (optionalMagic >> 8) & 0xff;
  return bytes;
}
