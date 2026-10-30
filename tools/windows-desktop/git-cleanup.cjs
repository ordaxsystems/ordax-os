'use strict';
// One cleanup primitive for Desktop's OS and pinned-Surface Git staging.
// Windows Git marks object/pack/index files readonly and can hide .git.
// Normalize only an explicitly passed ordinary Git directory, without
// following junctions, reparse points or hard-linked files.
const {execFileSync}=require('node:child_process');
const {join}=require('node:path');
const {existsSync,lstatSync,readdirSync,chmodSync}=require('node:fs');

function prepareWindowsGitDeletion(gitDir) {
  if (process.platform !== 'win32' || !existsSync(gitDir)) return;
  const root = lstatSync(gitDir);
  if (!root.isDirectory() || root.isSymbolicLink()) return;
  const directories = [gitDir];
  while (directories.length) {
    const directory = directories.pop();
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const path = join(directory,entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) directories.push(path);
      else if (stat.isFile() && stat.nlink === 1) chmodSync(path,0o666);
    }
    chmodSync(directory,0o777);
  }
  execFileSync('attrib.exe',['-H',gitDir],
    {windowsHide:true,timeout:10000,stdio:'ignore'});
}

module.exports={prepareWindowsGitDeletion};
