#!/usr/bin/env node
'use strict';
const {resolve}=require('node:path');
const {writeBundledNativeReceipt}=require('./native-build.cjs');
const {compileWin32PowerHelper}=require('./power-helper.cjs');
if(process.argv.length!==5)throw Error('Expected OS root, verified Surface receipt, OS SHA');
const [root,receipt,sha]=process.argv.slice(2);
// One Windows build step, attested by the existing Desktop stage manifest.
// Never compile the Win32 helper at Desktop boot or from an untrusted OS revision.
compileWin32PowerHelper(resolve(root));
const result=writeBundledNativeReceipt(resolve(root),resolve(receipt),sha);
process.stdout.write('ORDAX_DESKTOP_BUNDLE_PROVENANCE=VERIFIED '+result.os_sha+' '+result.source_commit+'\n');
