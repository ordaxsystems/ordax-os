import assert from "node:assert/strict";
import test from "node:test";
import { discoverVerifiedExternalApplications } from "../system/services/apps/verified-external-app-catalog.mjs";

const source={
  schema:"ordax.verified-component-package-source/1",
  metadataUrl(appId,state){return `meta://${appId}/${state}`;},
  fileUrl({componentId,path}){return `file://${componentId}/${path}`;},
};
const metadata={
  componentId:"pdf-viewer",state:"current",source:"slot",revision:7,version:"0.1.0",
  sourceCommit:"1111111111111111111111111111111111111111",
  entrypoint:"system/apps/pdf-viewer/src/runtime.mjs",pendingHealth:null,
};
const app={schema:"ordax.component-manifest/1",id:"pdf-viewer",title:"PDF",kind:"app",version:"0.1.0",releaseMode:"component-slot",criticality:"optional",failureDomain:"app",restartScope:"component",healthMode:"runtime",owner:"washingtonmsdj/ordax-apps",dependencies:[]};
const presentation={schema:"ordax.app-presentation-manifest/1",appId:"pdf-viewer",appVersion:"0.1.0",authority:"none",sourceLocale:"pt-BR",description:"Visualize documentos PDF locais em modo somente leitura.",monogram:"PD",singleton:true,translations:{"en-US":{title:"PDF",description:"View local PDF documents in read-only mode."}}};
const association={schema:"ordax.file-association-manifest/1",appId:"pdf-viewer",appVersion:"0.1.0",authority:"none",role:"viewer",extensions:["pdf"]};
function response(status,payload=null){return {status,ok:status>=200&&status<300,async json(){return payload;}};}

test("discovery exposes only verified current component-slot apps",async()=>{
 const fetchImpl=async(url)=>{
  if(url==="meta://pdf-viewer/current")return response(200,metadata);
  if(url.startsWith("meta://"))return response(404);
  if(url.endsWith("/app.json"))return response(200,app);
  if(url.endsWith("/presentation/manifest.json"))return response(200,presentation);
  if(url.endsWith("/associations/manifest.json"))return response(200,association);
  return response(404);
 };
 const entries=await discoverVerifiedExternalApplications({source,fetchImpl,appIds:["calculator","pdf-viewer"]});
 assert.equal(entries.length,1);
 assert.equal(entries[0].component.id,"pdf-viewer");
 assert.equal(entries[0].presentation.appId,"pdf-viewer");
 assert.equal(entries[0].association.extensions[0],"pdf");
 assert.equal(entries[0].metadata.revision,7);
});

test("broken verified app fails closed without hiding healthy peers",async()=>{
 const errors=[];
 const fetchImpl=async(url)=>{
  if(url==="meta://pdf-viewer/current")return response(200,metadata);
  if(url.endsWith("/app.json"))return response(200,app);
  if(url.endsWith("/presentation/manifest.json"))return response(200,presentation);
  if(url.endsWith("/associations/manifest.json"))return response(200,{...association,appVersion:"9.9.9"});
  return response(404);
 };
 const entries=await discoverVerifiedExternalApplications({
  source,fetchImpl,appIds:["pdf-viewer"],onError:(error,appId)=>errors.push([appId,error.message]),
 });
 assert.equal(entries.length,0);
 assert.equal(errors.length,1);
 assert.equal(errors[0][0],"pdf-viewer");
 assert.match(errors[0][1],/version drifted/);
});
