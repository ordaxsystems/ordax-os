// Deterministic, unsigned source-only handoff archive. Activation is exclusively OS-owned.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectPortableSourceFiles, requireRegularPath } from "./source-tree.mjs";
import { createHash } from "node:crypto";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
requireRegularPath("package.json", "file");
const packageBytes = readFileSync("package.json");
const pkg = JSON.parse(packageBytes.toString("utf8"));
// The version is part of the artifact filename. Permit the established
// release/test versions, but never path separators, control bytes or escapes.
if (typeof pkg.version !== "string"
  || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(pkg.version)) {
  throw new Error("Invalid source handoff package version");
}
const files = collectPortableSourceFiles();
const members=files.map(path=>({path,body:readFileSync(path)}));
members.push({path:"package.json",body:packageBytes});
const manifest={schema:"ordax.intelligence-artifact/1",kind:"unsigned-source-handoff",version:pkg.version,contracts:"OS-injected",engineIncluded:false,modelIncluded:false,activated:false,files:members.map(({path,body})=>({path,size:body.length,sha256:sha256(body)}))};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+"\n");
members.push({path:"manifest.json",body:manifestBytes});
function tarHeader(name,length){
  // This writer emits classic ustar name fields, not PAX extended paths.
  // Buffer.write(..., "ascii") would silently corrupt UTF-8 filenames while
  // the JSON manifest still recorded the original name. Fail before writing
  // any artifact instead of producing a receipt for an unextractable archive.
  if (typeof name !== "string" || !/^[\x20-\x7e]+$/.test(name)
    || name.startsWith("/") || name.includes("\\")
    || name.split("/").some(part => !part || part === "." || part === "..")
    || Buffer.byteLength(name, "ascii") > 100) {
    throw new Error("Unsafe or non-ASCII ustar member path: " + JSON.stringify(name));
  }
  const buf=Buffer.alloc(512);
  const str=(offset,width,value)=>buf.write(value,offset,Math.min(width,Buffer.byteLength(value)),"ascii");
  const oct=(offset,width,n)=>str(offset,width,n.toString(8).padStart(width-1,"0")+"\0");
  str(0,100,name);oct(100,8,0o644);oct(108,8,0);oct(116,8,0);oct(124,12,length);oct(136,12,0);
  buf.fill(32,148,156);str(156,1,"0");str(257,6,"ustar\0");str(263,2,"00");
  const sum=buf.reduce((n,b)=>n+b,0);oct(148,8,sum);
  return buf;
}
const blocks=[];
for(const {path,body} of members){
  blocks.push(tarHeader(path,body.length),body,Buffer.alloc((512-body.length%512)%512));
}
blocks.push(Buffer.alloc(1024));
const artifact=Buffer.concat(blocks);
const receipt={schema:"ordax.intelligence-build-receipt/1",kind:"unsigned-source-handoff",archive:"ordax-intelligence-source-"+pkg.version+".tar",sha256:sha256(artifact),size:artifact.length,modelIncluded:false,engineIncluded:false,activationAuthorized:false};
mkdirSync("dist",{recursive:true});
requireRegularPath("dist", "directory");
const dest=join("dist",receipt.archive),receiptPath=join("dist","receipt.json");
requireRegularPath(dest, "file", { allowMissing: true });
requireRegularPath(receiptPath, "file", { allowMissing: true });
if(process.argv.includes("--verify")){
  const old=readFileSync(dest);
  const expectedReceipt=Buffer.from(JSON.stringify(receipt,null,2)+"\n");
  const actualReceipt=readFileSync(receiptPath);
  if(!old.equals(artifact)||!actualReceipt.equals(expectedReceipt)){throw Error("Source artifact or provenance receipt is not reproducible");}
  console.log("Verified identical bytes:",receipt.sha256);
}else{
  writeFileSync(dest,artifact);writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n");
  console.log("Built unsigned source handoff:",receipt.sha256);
}
