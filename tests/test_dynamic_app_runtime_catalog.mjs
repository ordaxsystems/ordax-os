import assert from "node:assert/strict";
import test from "node:test";
import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { createAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";
import { defineExternalFirstPartyApp } from "../system/services/apps/external-app-definition.mjs";
import { createSurfaceState, getActiveArea, reduceSurfaceState } from "../system/surface/ui/surface-state.mjs";

const component={schema:"ordax.component-manifest/1",id:"pdf-viewer",title:"PDF",kind:"app",version:"0.1.0",releaseMode:"component-slot",criticality:"optional",failureDomain:"app",restartScope:"component",healthMode:"runtime",owner:"washingtonmsdj/ordax-apps",dependencies:[]};
const presentation={schema:"ordax.app-presentation-manifest/1",appId:"pdf-viewer",appVersion:"0.1.0",authority:"none",sourceLocale:"pt-BR",description:"Visualize documentos PDF locais em modo somente leitura.",monogram:"PD",singleton:true,translations:{"en-US":{title:"PDF",description:"View local PDF documents in read-only mode."}}};

test("injected runtime catalog launches an external verified app without editing static catalog",()=>{
 const external=defineExternalFirstPartyApp(component,presentation);
 const catalog=createAppRuntimeCatalog([...listFirstPartyApps(),external]);
 let state=createSurfaceState({capabilityIds:[],connectivity:"online"},{},null,catalog);
 state=reduceSurfaceState(state,{type:"app.launch",appId:"pdf-viewer",target:"/Docs/a.pdf"},catalog);
 const windows=getActiveArea(state).windows;
 assert.equal(windows.length,1);
 assert.equal(windows[0].appId,"pdf-viewer");
 assert.equal(windows[0].target,"/Docs/a.pdf");
});

test("default runtime catalog remains unchanged",()=>{
 let state=createSurfaceState({capabilityIds:[],connectivity:"online"});
 state=reduceSurfaceState(state,{type:"app.launch",appId:"pdf-viewer"});
 assert.equal(getActiveArea(state).windows.length,0);
});
