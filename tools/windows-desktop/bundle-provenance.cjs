#!/usr/bin/env node
'use strict';
const {resolve}=require('node:path');
const {writeBundledNativeReceipt}=require('./native-build.cjs');
if(process.argv.length!==5)throw Error('Expected OS root, verified Surface receipt, OS SHA');
const [root,receipt,sha]=process.argv.slice(2);
const result=writeBundledNativeReceipt(resolve(root),resolve(receipt),sha);
process.stdout.write('ORDAX_DESKTOP_BUNDLE_PROVENANCE=VERIFIED '+result.os_sha+' '+result.source_commit+'\n');
