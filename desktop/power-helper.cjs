'use strict';
// Single Desktop-owned build+receipt gate for the short-lived Win32 power reader.
// The OS owns the power-status contract and display policy; the shell owns
// compilation and its exact, installed Windows executable. Never invoke a
// compiler, PowerShell or network during an installed Desktop boot.
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const {join,resolve,isAbsolute}=require('node:path');

const NAME='ordax-win32-power.exe';
const RELATIVE='tools/windows-power/'+NAME;
const STAGED='runtime-template/'+RELATIVE;
const SOURCE=join(__dirname,'win32-power-helper.cs');
const MAX_BYTES=32768;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function assertBinary(file){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1024||stat.size>MAX_BYTES)
    throw Error('Windows power helper is missing, linked or out of bounds');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==stat.size||bytes.toString('ascii',0,2)!=='MZ')
    throw Error('Windows power helper is not a valid PE input');
  return bytes;
}

function compileWin32PowerHelper(osRoot,{platform=process.platform,
  windowsRoot=process.env.SystemRoot,run=spawnSync}={}){
  if(platform!=='win32'||typeof windowsRoot!=='string'||
     !isAbsolute(windowsRoot)||typeof run!=='function')
    throw Error('Win32 power helper requires the Windows host and compiler');
  const sourceStat=fs.lstatSync(SOURCE);
  if(!sourceStat.isFile()||sourceStat.isSymbolicLink()||sourceStat.size<50||
     sourceStat.size>128*1024)throw Error('Canonical Desktop Win32 power source unavailable');
  const root=resolve(osRoot);
  const outputDir=join(root,'out','windows-desktop-power');
  fs.mkdirSync(outputDir,{recursive:true});
  const outStat=fs.lstatSync(outputDir);
  if(!outStat.isDirectory()||outStat.isSymbolicLink())
    throw Error('Windows power build output must be a plain directory');
  const destination=join(outputDir,NAME);
  if(fs.existsSync(destination))
    throw Error('Win32 power helper build cannot overwrite an existing artifact');
  const directory=fs.mkdtempSync(join(outputDir,'.power-compile-'));
  const temporary=join(directory,NAME);
  try{
    const compiler=join(windowsRoot,'Microsoft.NET','Framework64',
      'v4.0.30319','csc.exe');
    const toolStat=fs.lstatSync(compiler);
    if(!toolStat.isFile()||toolStat.isSymbolicLink())
      throw Error('Windows .NET compiler unavailable');
    const result=run(compiler, ['/nologo','/optimize+','/target:exe',
      '/platform:x64','/out:'+temporary,SOURCE],{
        cwd:directory,encoding:'utf8',windowsHide:true,shell:false,
        timeout:90000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],
      });
    if(result?.status!==0||result?.signal||result?.error)
      throw Error('Win32 power helper compilation failed');
    assertBinary(temporary);
    const probe=run(temporary,[],{encoding:'utf8',windowsHide:true,
      shell:false,timeout:15000,maxBuffer:512,
      stdio:['ignore','pipe','pipe']});
    if(probe?.status!==0||probe?.signal||probe?.error||
       !/^(?:\d{1,3},){2}\d{1,3}\r?\n?$/.test(String(probe.stdout??'')))
      throw Error('Compiled Win32 power helper failed real telemetry smoke');
    fs.copyFileSync(temporary,destination,fs.constants.COPYFILE_EXCL);
    const bytes=assertBinary(destination);
    return Object.freeze({path:destination,sha256:digest(bytes),bytes:bytes.length});
  }finally{
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

// The OS process never chooses an executable path. Read the one installed by
// the Desktop Git source and recorded in the existing NSIS stage manifest.
// This does not replace the OS/Suface Native provenance verification.
function resolveInstalledPowerHelper(template){
  const root=resolve(template);
  const manifestPath=join(root,'docs','evidence','desktop-stage-manifest.json');
  const manifestStat=fs.lstatSync(manifestPath);
  if(!manifestStat.isFile()||manifestStat.isSymbolicLink()||
     manifestStat.size<100||manifestStat.size>12*1024*1024)
    throw Error('Installed Desktop power helper manifest unavailable');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if(manifest.schema!=='ordax.desktop-standalone-stage/2'||
     manifest.product_owner!=='ordaxsystems/ordax-os'||
     manifest.desktop_owner!=='ordaxsystems/ordax-os'||
     manifest.runtime_owner!=='ordaxsystems/ordax-os'||
     manifest.desktop_sha!==manifest.os_sha||
     !Array.isArray(manifest.files)||manifest.files.length>100000)
    throw Error('Untrusted installed Desktop power helper manifest');
  const matched=manifest.files.filter(x=>x?.path===STAGED);
  if(matched.length!==1||typeof matched[0].sha256!=='string'||
     !/^[0-9a-f]{64}$/.test(matched[0].sha256)||
     !Number.isInteger(matched[0].bytes)||matched[0].bytes<1024||
     matched[0].bytes>MAX_BYTES)
    throw Error('Unattested installed Win32 power helper');
  const binary=join(root,'tools','windows-power',NAME);
  const bytes=assertBinary(binary);
  if(bytes.length!==matched[0].bytes||digest(bytes)!==matched[0].sha256)
    throw Error('Installed Win32 power executable does not match Desktop stage receipt');
  return binary;
}

if(require.main===module){
  if(process.argv.length!==3)throw Error('Expected exact canonical OS checkout');
  const result=compileWin32PowerHelper(process.argv[2]);
  process.stdout.write('DESKTOP_WIN32_POWER_HELPER_VERIFIED='+result.sha256+'\n');
}
module.exports={compileWin32PowerHelper,resolveInstalledPowerHelper,
  assertBinary,RELATIVE,STAGED};
