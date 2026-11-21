'use strict';
// Test-only locator for the single OS-owned distribution contract. The
// packaged Electron host never imports this helper or duplicates that file.
const {existsSync}=require('node:fs');
const {join,resolve,isAbsolute}=require('node:path');
const desktop=resolve(__dirname,'..');
const contract=root=>join(root,'docs','contracts','distribution-profiles.json');
const explicit=process.env.ORDAX_DESKTOP_OS_CHECKOUT;
if(explicit && (!isAbsolute(explicit) || !existsSync(contract(explicit))))
  throw Error('Desktop test OS checkout override is not an absolute canonical contract directory');
const candidates=explicit?[explicit]:[resolve(desktop,'..')];
const osRoot=candidates.find(root=>existsSync(contract(root)));
if(!osRoot)throw Error('Desktop tests require the OS-owned distribution contract in a verified checkout');
process.env.ORDAX_DESKTOP_OS_CHECKOUT=resolve(osRoot);
module.exports=resolve(osRoot);
