import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, readdir, readFile, symlink } from "node:fs/promises";
import { createDesktopFileSpaceMiddleware } from "../system/adapters/desktop/file-space-host.mjs";
import { createNativeFileSpace } from "../system/adapters/native/file-space.mjs";
async function harness(t) {
  const isolated=await mkdtemp(join(tmpdir(),"ordax-win-files-"));
  const userFolder=join(isolated,"Files");
  const serve=createDesktopFileSpaceMiddleware(userFolder);
  const server=createServer((req,res)=>serve(req,res,()=>{
    res.writeHead(404);res.end("not found");
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await rm(isolated,{recursive:true,force:true});
  });
  const origin="http://127.0.0.1:"+server.address().port;
  const request=(path,options={})=>fetch(origin+path,{
    ...options,
    headers:{...(options.headers??{}), ...(options.method==="POST"?{Origin:origin}:{})},
  });
  const post=(payload)=>request("/__ordax/native/files",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
  });
  return {origin,request,post,userFolder};
}
test("Windows files implement canonical file-space/11 with durable mutations and trash",async t=>{
  const h=await harness(t);
  const port=await createNativeFileSpace({fetch:(path,opts)=>h.request(path,opts)});
  assert.deepEqual((await port.list("/")).entries,[]);
  assert.equal((await port.createDirectory("/","docs")).entries[0].name,"docs");
  const bytes=new TextEncoder().encode("OrdaX real files");
  const first=await port.importFile("/docs","sample.txt",bytes);
  assert.equal(first.entries[0].size,bytes.length);
  assert.equal((await port.readTextFile("/docs/sample.txt")).text,"OrdaX real files");
  await port.copyFile("/docs","sample.txt","/","copy.txt");
  await port.renameEntry("/","copy.txt","renamed.txt");
  await port.moveEntry("/","renamed.txt","/docs");
  assert.equal((await port.list("/docs")).entries.length,2);
  await port.trashEntry("/docs","renamed.txt");
  const trash=await port.listTrash();
  assert.equal(trash.entries.length,1);
  assert.equal(trash.entries[0].originalPath,"/docs/renamed.txt");
  assert.equal((await port.restoreTrashEntry(trash.entries[0].id)).entries.length,0);
  assert.equal((await port.readTextFile("/docs/renamed.txt")).text,"OrdaX real files");
  assert.equal((await readFile(join(h.userFolder,"docs","sample.txt"),"utf8")),"OrdaX real files");
});
test("Windows files refuse traversal, ADS, symlinks, unsafe writes, and overwrites",async t=>{
  const h=await harness(t);
  let response=await h.request("/__ordax/native/files?path="+encodeURIComponent("/../Windows"));
  assert.equal(response.status,400);
  response=await h.post({action:"create-directory",path:"/",name:"C:secret"});
  assert.equal(response.status,400);
  response=await h.post({action:"create-directory",path:"/",name:"CON"});
  assert.equal(response.status,400);
  response=await h.request("/__ordax/native/file-import?path=%2F&name=owned.txt",{
    method:"POST",headers:{"Content-Type":"application/octet-stream"},body:"original",
  });
  assert.equal(response.status,200);
  response=await h.request("/__ordax/native/file-import?path=%2F&name=owned.txt",{
    method:"POST",headers:{"Content-Type":"application/octet-stream"},body:"overwritten",
  });
  assert.equal(response.status,409);
  assert.equal(await readFile(join(h.userFolder,"owned.txt"),"utf8"),"original");
  response=await fetch(h.origin+"/__ordax/native/files",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"create-directory",path:"/",name:"csrf"}),
  });
  assert.equal(response.status,403);
  try {
    await symlink(join(h.userFolder,"owned.txt"),join(h.userFolder,"linked.txt"));
    response=await h.request("/__ordax/native/file-content?path=%2Flinked.txt");
    assert.equal(response.status,403);
  } catch(e) {
    if(!["EPERM","EACCES","UNKNOWN"].includes(e?.code))throw e;
  }
  assert.equal((await readdir(h.userFolder)).includes("csrf"),false);
});
test("Windows files serve bounded binary previews and reject unsupported previews",async t=>{
  const h=await harness(t);
  const content=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a]);
  const importResponse=await h.request("/__ordax/native/file-import?path=%2F&name=photo.png",{
    method:"POST",headers:{"Content-Type":"application/octet-stream"},body:content,
  });
  assert.equal(importResponse.status,200);
  const preview=await h.request("/__ordax/native/image-preview?path=%2Fphoto.png");
  assert.equal(preview.status,200);
  assert.equal(preview.headers.get("content-type"),"image/png");
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()),content);
  const bad=await h.request("/__ordax/native/document-preview?path=%2Fphoto.png");
  assert.equal(bad.status,415);
  const download=await h.request("/__ordax/native/file-export?path=%2Fphoto.png");
  assert.equal(download.status,200);
  assert.equal(download.headers.get("content-disposition"),'attachment; filename="ordax-download"');
});
