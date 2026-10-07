import assert from "node:assert/strict";import test from "node:test";
import { validateAppPresentationManifest } from "../system/contracts/app-presentation-manifest.mjs";
import { defineExternalFirstPartyApp, externalAppCopy } from "../system/services/apps/external-app-definition.mjs";
const component={schema:"ordax.component-manifest/1",id:"pdf-viewer",title:"PDF",kind:"app",version:"0.1.0",releaseMode:"component-slot",criticality:"optional",failureDomain:"app",restartScope:"component",healthMode:"runtime",owner:"washingtonmsdj/ordax-apps",dependencies:[]};
const presentation={schema:"ordax.app-presentation-manifest/1",appId:"pdf-viewer",appVersion:"0.1.0",authority:"none",sourceLocale:"pt-BR",description:"Visualize documentos PDF locais em modo somente leitura.",monogram:"PD",singleton:true,translations:{"en-US":{title:"PDF",description:"View local PDF documents in read-only mode."}}};
test("presentation binds to exact app identity",()=>{const value=validateAppPresentationManifest(presentation,{appId:"pdf-viewer",appVersion:"0.1.0"});assert.equal(value.authority,"none");});
test("external app reuses standard Surface contract",()=>{const app=defineExternalFirstPartyApp(component,presentation);assert.equal(app.panels[0].extensionId,"pdf-viewer");assert.deepEqual(externalAppCopy(app,"en-US"),{title:"PDF",description:"View local PDF documents in read-only mode."});});
test("external app rejects version drift",()=>assert.throws(()=>defineExternalFirstPartyApp({...component,version:"0.2.0"},presentation),/version drifted/));
