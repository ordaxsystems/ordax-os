'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {inspectPeImports,auditEngine} = require('./pe-dependency-audit.cjs');
function fixture({name='KERNEL32.DLL',delay=null}={}) {
  const b=Buffer.alloc(2048);
  b.write('MZ',0,'ascii');
  b.writeUInt32LE(0x80,0x3c);
  b.write('PE\0\0',0x80,'ascii');
  b.writeUInt16LE(0x8664,0x84);
  b.writeUInt16LE(1,0x86);
  b.writeUInt16LE(0xf0,0x94);
  const opt=0x98,section=opt+0xf0;
  b.writeUInt16LE(0x20b,opt);
  b.writeUInt32LE(16,opt+108);
  b.writeUInt32LE(0x1000,opt+112+8);
  b.writeUInt32LE(40,opt+112+8+4);
  b.writeUInt32LE(0x1100,section+12);
  // Section mapping base RVA 0x1000, on disk 0x300
  b.writeUInt32LE(0x1000,section+12);
  b.writeUInt32LE(0x400,section+8);
  b.writeUInt32LE(0x400,section+16);
  b.writeUInt32LE(0x300,section+20);
  b.writeUInt32LE(0x1060,0x300+12);
  b.write(name+'\0',0x360,'ascii');
  if(delay){
    b.writeUInt32LE(0x1100,opt+112+13*8);
    b.writeUInt32LE(64,opt+112+13*8+4);
    b.writeUInt32LE(1,0x400);
    b.writeUInt32LE(0x1160,0x404);
    b.write(delay+'\0',0x460,'ascii');
  }
  return b;
}
test('parses AMD64 PE imports and refuses a dynamic MSVC CRT',()=>{
  const imports=inspectPeImports(fixture({name:'VCRUNTIME140.DLL'}));
  assert.deepEqual(imports,['VCRUNTIME140.DLL']);
});
test('inspects delay import table, not just direct imports',()=>{
  assert.deepEqual(inspectPeImports(fixture({delay:'MSVCP140.DLL'})),['KERNEL32.DLL','MSVCP140.DLL']);
});
test('accepts a self-contained image without dynamic MSVC imports',()=>{
  assert.deepEqual(inspectPeImports(fixture()),['KERNEL32.DLL']);
});
test('rejects malformed and non-AMD64 binaries before trusting any result',()=>{
  const b=fixture();b.writeUInt16LE(0x14c,0x84);
  assert.throws(()=>inspectPeImports(b),/AMD64/);
  const c=fixture();c.writeUInt32LE(0x70000000,0x300+12);
  assert.throws(()=>inspectPeImports(c),/range/);
  const d=fixture();d.fill(0,0,32);
  assert.throws(()=>inspectPeImports(d),/DOS/);
});
test('inspects exact source-lock inventory and rejects undeclared or linked PE',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-pe-gate-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const exe=path.join(folder,'llama-server.exe');
  fs.writeFileSync(exe,fixture());
  assert.deepEqual(auditEngine(folder,['llama-server.exe']),{files:1,dynamic:[]});
  fs.writeFileSync(path.join(folder,'other.dll'),fixture());
  assert.throws(()=>auditEngine(folder,['llama-server.exe']),/inventory/);
  fs.rmSync(path.join(folder,'other.dll'));
  fs.writeFileSync(exe,fixture({name:'MSVCP140.DLL'}));
  assert.deepEqual(auditEngine(folder,['llama-server.exe']).dynamic,[{name:'llama-server.exe',dependencies:['MSVCP140.DLL']}]);
});
