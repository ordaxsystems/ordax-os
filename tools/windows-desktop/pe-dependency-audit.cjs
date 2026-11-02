'use strict';
// PE32+ loader-closure check for the canonical Windows Aura package.
// Hashes and exact inventory remain owned by local-ai-package.mjs.
// This gate prevents a VS-equipped CI runner from masking undeployed MSVC DLLs.
const fs = require('node:fs');
const path = require('node:path');
const VC_RUNTIME_RE = /^(?:VCRUNTIME14\d*(?:_\d+)?|MSVCP14\d*(?:_[A-Z0-9_]+)?|CONCRT14\d*|VCOMP14\d*|MSVCR\d+)\.DLL$/i;
const MAX_IMPORTS = 512;
function inspectPeImports(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 0x200 || bytes.toString('ascii', 0, 2) !== 'MZ') {
    throw Error('Invalid PE: missing DOS header');
  }
  const u16 = offset => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.length)
      throw Error('Invalid PE: truncated ushort');
    return bytes.readUInt16LE(offset);
  };
  const u32 = offset => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > bytes.length)
      throw Error('Invalid PE: truncated ulong');
    return bytes.readUInt32LE(offset);
  };
  const pe = u32(0x3c);
  if (pe < 0x40 || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0')
    throw Error('Invalid PE signature');
  if (u16(pe + 4) !== 0x8664) throw Error('Aura engine must contain AMD64 PE binaries');
  const count = u16(pe + 6);
  if (!count || count > 96) throw Error('Invalid PE section count');
  const optionalSize = u16(pe + 20), optional = pe + 24;
  if (u16(optional) !== 0x20b || optionalSize < 112)
    throw Error('Aura engine requires PE32+');
  const sectionTable = optional + optionalSize;
  if (sectionTable + 40 * count > bytes.length)
    throw Error('Invalid PE section table');
  const sections = [];
  for (let i = 0; i < count; i++) {
    const off = sectionTable + i * 40;
    const virtualSize = u32(off + 8), rva = u32(off + 12);
    const rawSize = u32(off + 16), raw = u32(off + 20);
    if (raw + rawSize > bytes.length) throw Error('Invalid PE section bounds');
    sections.push({ rva, virtualSize, rawSize, raw });
  }
  const rvaOffset = (rva, length) => {
    if (!rva || !Number.isSafeInteger(length) || length < 1)
      throw Error('Invalid PE import RVA');
    const s = sections.find(v => rva >= v.rva && rva - v.rva + length <= v.rawSize);
    if (!s) throw Error('Invalid PE import range');
    return s.raw + (rva - s.rva);
  };
  const nameAt = rva => {
    const off = rvaOffset(rva, 1);
    const end = bytes.indexOf(0, off);
    if (end < 0 || end - off < 5 || end - off > 160)
      throw Error('Invalid PE import name');
    const value = bytes.toString('ascii', off, end).toUpperCase();
    if (!/^[A-Z0-9_.-]+\.DLL$/.test(value)) throw Error('Invalid PE import library name');
    return value;
  };
  const directoryCount = u32(optional + 108);
  const imports = new Set();
  const scan = (directoryIndex, stride, nameField, delay) => {
    if (directoryCount <= directoryIndex) return;
    const entry = optional + 112 + directoryIndex * 8;
    if (entry + 8 > optional + optionalSize) throw Error('Invalid PE data directories');
    const rva = u32(entry), size = u32(entry + 4);
    if (!rva && !size) return;
    if (!rva || size < stride || size > 256 * 1024 || size % stride)
      throw Error('Invalid PE import directory size');
    const start = rvaOffset(rva, size);
    let terminated = false;
    for (let i = 0; i < Math.min(size / stride, MAX_IMPORTS); i++) {
      const offset = start + i * stride;
      if (bytes.subarray(offset, offset + stride).every(b => b === 0)) {
        terminated = true;
        break;
      }
      if (delay && !(u32(offset) & 1))
        throw Error('Unsupported PE delay imports with absolute address');
      imports.add(nameAt(u32(offset + nameField)));
    }
    if (!terminated) throw Error('Unterminated PE import directory');
  };
  scan(1, 20, 12, false);
  scan(13, 32, 4, true);
  return [...imports].sort();
}

function auditEngine(engineDirectory, requiredNames) {
  if (typeof engineDirectory !== 'string' || !engineDirectory)
    throw TypeError('Canonical Aura engine directory required');
  const rootInfo = fs.lstatSync(engineDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw Error('Untrusted Aura engine directory');
  if (!Array.isArray(requiredNames) || !requiredNames.length)
    throw Error('Canonical source-lock inventory required');
  const expected = requiredNames.slice().sort();
  if (expected.some(n => typeof n !== 'string' || path.basename(n) !== n ||
      !/^[a-zA-Z0-9_.-]+\.(?:exe|dll)$/i.test(n)) ||
      new Set(expected.map(n=>n.toLowerCase())).size !== expected.length)
    throw Error('Unsafe or duplicate canonical Windows PE inventory');
  const actual = fs.readdirSync(engineDirectory).sort();
  if (actual.length !== expected.length ||
      actual.some((name, i) => name !== expected[i]))
    throw Error('Aura engine file inventory disagrees with source lock');
  const dynamic = [];
  for (const name of expected) {
    const file = path.join(engineDirectory, name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
      throw Error('Unsafe Windows engine file: ' + name);
    const imports = inspectPeImports(fs.readFileSync(file));
    const vc = imports.filter(item => VC_RUNTIME_RE.test(item));
    if (vc.length) dynamic.push({name, dependencies:vc});
  }
  return {files:expected.length, dynamic};
}

function runCli(argv=process.argv.slice(2)) {
  if (argv.length !== 2) throw Error('Usage: node pe-dependency-audit.cjs <engine-directory> <local-ai-source-lock.json>');
  const lock = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  const expected = lock?.engine?.windows_artifact?.files?.map(entry => entry.name);
  const result = auditEngine(argv[0], expected);
  if (result.dynamic.length) {
    for (const item of result.dynamic)
      console.error('WINDOWS_AURA_UNDECLARED_MSVC_DEPENDENCY='+item.name+':'+item.dependencies.join(','));
    throw Error('Windows Aura package requires MSVC DLLs not deployed in per-user NSIS; fix canonical Intelligence builder or supply an approved verified prerequisite. A VS runner is not clean Windows.');
  }
  console.log('WINDOWS_AURA_PE_LOADER_CLOSURE=PASS files='+result.files+' dynamic_msvc=0');
  return result;
}
module.exports = {inspectPeImports,auditEngine,runCli};
if (require.main === module) {
  try {runCli();}
  catch(error) {
    console.error('WINDOWS_AURA_PE_LOADER_CLOSURE=FAIL '+error.message);
    process.exitCode = 1;
  }
}
