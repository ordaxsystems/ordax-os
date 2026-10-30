'use strict';
// Materializes the single OS-pinned Windows Local AI package only at Dev build
// time. No downloads, substitutions, model selection, keys or second updater.
const { mkdtempSync, mkdirSync, copyFileSync, renameSync, rmSync,
  existsSync, lstatSync, readFileSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const pathToRoot = resolve(__dirname,'../..');

async function materialize(candidateDir, modelCacheFile, outputDir) {
  const { verifyWindowsLocalAiPackage } = await import(
    '../../system/adapters/desktop/local-ai-package.mjs');
  const lock = JSON.parse(readFileSync(join(pathToRoot,
    'system/services/local-ai/source-lock.json'),'utf8'));
  const receipt = JSON.parse(readFileSync(join(candidateDir,'candidate-receipt.json'),'utf8'));
  const exact = lock.engine.windows_artifact;
  if (receipt.$schema !== 'prototype-ordax.windows-inference-candidate/1' ||
      receipt.activation_authorized !== false ||
      receipt.signed_release !== false ||
      receipt.proof?.real_completion !== true ||
      receipt.proof?.real_model_loaded !== true ||
      receipt.engine_source_commit !== lock.engine.commit ||
      receipt.model?.sha256 !== lock.model.sha256 ||
      JSON.stringify(receipt.files) !== JSON.stringify(exact.files))
    throw Error('Windows inference candidate is not bound to canonical OS lock');
  if (existsSync(outputDir)) {
    await verifyWindowsLocalAiPackage(outputDir);
    return {cached:true};
  }
  const parent=dirname(outputDir);
  mkdirSync(parent,{recursive:true});
  const temp=join(parent,'.candidate-ai-'+randomUUID());
  if (existsSync(temp)) throw Error('Unsafe candidate already exists');
  mkdirSync(join(temp,'engine'),{recursive:true});
  mkdirSync(join(temp,'models'));
  try {
    for(const file of exact.files){
      const src=join(candidateDir,'engine',file.name);
      const info=lstatSync(src);
      if(!info.isFile() || info.isSymbolicLink())
        throw Error('Windows engine file not regular');
      copyFileSync(src,join(temp,'engine',file.name));
    }
    const modelStat=lstatSync(modelCacheFile);
    if(!modelStat.isFile()||modelStat.isSymbolicLink())
      throw Error('Pinned GGUF model is not a regular file');
    copyFileSync(modelCacheFile,join(temp,'models',lock.model.filename));
    const verified=await verifyWindowsLocalAiPackage(temp);
    renameSync(temp,outputDir);
    return {cached:false,modelId:verified.modelId};
  } finally {
    if(existsSync(temp)) rmSync(temp,{recursive:true,force:true});
  }
}
if(require.main===module){
  if(process.argv.length!==5)
    throw Error('Usage: node materialize-local-ai.cjs <candidate> <verified-GGUF> <out>');
  materialize(...process.argv.slice(2)).then(result=>{
    process.stdout.write('WINDOWS_LOCAL_AI_PACKAGE_VERIFIED='+JSON.stringify(result)+'\n');
  }).catch(error=>{process.stderr.write('Local AI package rejected: '+error.message+'\n');process.exitCode=1;});
}
module.exports={materialize};
