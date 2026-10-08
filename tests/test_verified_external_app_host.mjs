import assert from "node:assert/strict";
import test from "node:test";
import {
  createVerifiedExternalAppHost,
  loadVerifiedExternalAppRuntime,
} from "../system/services/apps/verified-external-app-host.mjs";

const metadata={componentId:"pdf-viewer",state:"current",source:"slot",revision:4,version:"0.1.0",sourceCommit:"2222222222222222222222222222222222222222",entrypoint:"system/apps/pdf-viewer/src/runtime.mjs",pendingHealth:null};
const entry={
  app:{id:"pdf-viewer"},
  component:{id:"pdf-viewer",version:"0.1.0"},
  metadata,
  association:{extensions:["pdf"]},
};
const source={
 schema:"ordax.verified-component-package-source/1",
 metadataUrl(){return "unused";},
 fileUrl(request){return `verified://${request.componentId}/${request.path}`;},
};

test("unit loader imports exact verified runtime and grants file ports only to associated app",async()=>{
 const contexts=[];
 const fileSpace={schema:"ordax.file-space/11"};
 const appActivation={schema:"ordax.app-activation/1"};
 const mounted=await loadVerifiedExternalAppRuntime({
  entry,root:{kind:"isolated"},surfaceLifecycle:{schema:"ordax.surface-render-lifecycle/5"},
  packageSource:source,fileSpace,appActivation,
  importModule:async(url)=>({
   componentRuntime:{schema:"ordax.component-runtime/1",componentId:"pdf-viewer",version:"0.1.0",async mount(context){contexts.push([url,context]);return {destroy(){}};}},
  }),
 });
 assert.equal(typeof mounted.destroy,"function");
 assert.equal(contexts[0][0],"verified://pdf-viewer/system/apps/pdf-viewer/src/runtime.mjs");
 assert.equal(contexts[0][1].fileSpace,fileSpace);
 assert.equal(contexts[0][1].appActivation,appActivation);
});

test("unit loader does not leak file ports to non-associated apps",async()=>{
 const plain={...entry,app:{id:"toolbox"},component:{id:"toolbox",version:"0.1.0"},metadata:{...metadata,componentId:"toolbox",entrypoint:"system/apps/toolbox/src/runtime.mjs"},association:null};
 let keys=[];
 await loadVerifiedExternalAppRuntime({
  entry:plain,root:{},surfaceLifecycle:{},packageSource:source,fileSpace:{},appActivation:{},
  importModule:async()=>({componentRuntime:{schema:"ordax.component-runtime/1",componentId:"toolbox",version:"0.1.0",async mount(context){keys=Object.keys(context).sort();return {destroy(){}};}}}),
 });
 assert.deepEqual(keys,["root","surfaceLifecycle"]);
});

test("host mounts into extension root and destroys when window disappears",async()=>{
 let panel={};
 let listener=null;
 let destroyed=0;
 const surfaceLifecycle={subscribeRender(fn){listener=fn;fn();return()=>{listener=null;};}};
 const surfaceRoot={querySelector(){return panel;}};
 const host=createVerifiedExternalAppHost({
  root:surfaceRoot,surfaceLifecycle,entries:[entry],packageSource:source,
  fileSpace:{},appActivation:{},
  importModule:async()=>({componentRuntime:{schema:"ordax.component-runtime/1",componentId:"pdf-viewer",version:"0.1.0",async mount(context){assert.equal(context.root,panel);return {destroy(){destroyed+=1;}};}}}),
 });
 await host.reconcile();
 panel=null;
 listener?.();
 await host.reconcile();
 assert.equal(destroyed,1);
 await host.destroy();
});
