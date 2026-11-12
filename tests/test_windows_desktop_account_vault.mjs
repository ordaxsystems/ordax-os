import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createDesktopAccountCookieVault } from "../system/adapters/desktop/account-cookie-vault.mjs";
import { createEmulatorNativeHost } from "../tools/windows-emulator/native-host.mjs";

const gatewayOrigin="https://account.example.test/functions/v1/ordax-account-gateway";
const prefix=join(tmpdir(),"ordax-win-dpapi-vault-");
// This isolated fake cryptor is ONLY for deterministic validation in CI.
// The real Windows crypto command is exercised in a separate Windows test.
const protect=async(_mode,plain)=>Buffer.concat([Buffer.alloc(32,0xab),Buffer.from(plain).reverse()]);
const unprotect=async(_mode,cipher)=> {
  if(cipher.length<32 || !cipher.subarray(0,32).equals(Buffer.alloc(32,0xab)))throw Error("Tampered");
  return Buffer.from(cipher.subarray(32)).reverse();
};
const vault=(root,origin=gatewayOrigin)=>createDesktopAccountCookieVault(root,origin,{
  platform:"win32",protect,unprotect,
});
const session=(authenticated)=>({
  $schema:"prototype-ordax.public-identity-session/1",
  authenticated,status:authenticated?"authenticated":"anonymous",
  provider:"supabase",...(authenticated?{subject:"subject-e2e",email:"e2e@example.test"}:{}),
});
async function withServer(gateway,cookieVault,run) {
  const middleware=createEmulatorNativeHost({
    stateDirectory:join(gateway.directory,"native"),
    accountGatewayOrigin:gatewayOrigin,cookieVault,fetchImpl:gateway.fetch,
  });
  const server=createServer((req,res)=>middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const origin="http://127.0.0.1:"+server.address().port;
  const request=(path,init={})=>fetch(origin+path,{
    ...init,headers:{Origin:origin,...init.headers},
  });
  try{await run(request);}
  finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
}

test("Desktop account vault is encrypted, origin bound and deleted on logout",async()=>{
  const root=await mkdtemp(prefix);
  try{
    const v=vault(root);
    assert.deepEqual([...await v.load()],[]);
    await v.save(new Map([["ordax_access","secret-access"],["ordax_refresh","secret-refresh"]]));
    const [file]=await readdir(root);
    assert.match(file,/\.dpapi\.json$/);
    const onDisk=await readFile(join(root,file),"utf8");
    assert.doesNotMatch(onDisk,/secret-access|secret-refresh/);
    assert.deepEqual([...await v.load()],[
      ["ordax_access","secret-access"],["ordax_refresh","secret-refresh"],
    ]);
    await assert.rejects(()=>vault(root,"https://another.example.test/").load(),/binding|envelope/);
    await assert.rejects(()=>v.save(new Map([["untrusted","token"]])),/Invalid/);
    await v.save(new Map());
    assert.deepEqual(await readdir(root),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("Desktop account survives a new host process, logout revokes local cache and error stays closed",async()=>{
  const root=await mkdtemp(prefix);
  const gateway={directory:root,fetch:async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path.endsWith("/auth/login")){
      const headers=new Headers();
      headers.append("set-cookie","ordax_access=secret-access; HttpOnly; Secure");
      headers.append("set-cookie","ordax_refresh=secret-refresh; HttpOnly; Secure");
      return new Response(null,{status:303,headers});
    }
    if(path.endsWith("/auth/session")){
      const loggedIn=String(options.headers?.Cookie??"").includes("ordax_access=secret-access");
      return Response.json(session(loggedIn));
    }
    if(path.endsWith("/auth/logout"))return new Response(null,{status:204});
    return new Response(null,{status:404});
  }};
  const cookieVault=vault(root);
  try{
    await withServer(gateway,cookieVault,async request=>{
      const login=await request("/auth/login",{method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:"email=e2e%40example.test&password=do-not-store-this"});
      assert.equal(login.status,200);
      assert.equal((await login.json()).authenticated,true);
      assert.equal(login.headers.get("set-cookie"),null);
    });
    await withServer(gateway,vault(root),async request=>{
      const refreshed=await request("/auth/session");
      assert.equal(refreshed.status,200);
      assert.equal((await refreshed.json()).authenticated,true);
      assert.equal(refreshed.headers.get("set-cookie"),null);
      const logout=await request("/auth/logout",{method:"POST"});
      assert.equal(logout.status,204);
    });
    await withServer(gateway,vault(root),async request=>{
      assert.equal((await (await request("/auth/session")).json()).authenticated,false);
    });
    const files=await readdir(root);
    assert.ok(!files.some(file=>file.endsWith(".dpapi.json")));
    await writeFile(join(root,"desktop-account-cookies.dpapi.json"),"{corrupted");
    await withServer(gateway,vault(root),async request=>{
      assert.equal((await request("/auth/session")).status,503);
      assert.equal((await request("/auth/logout",{method:"POST"})).status,204);
      assert.equal((await (await request("/auth/session")).json()).authenticated,false);
    });
    assert.ok(!(await readdir(root)).some(file=>file.endsWith(".dpapi.json")));
  } finally {await rm(root,{recursive:true,force:true});}
});

test("Windows DPAPI encrypts and restores cookies for the current OS user",{
  skip:process.platform!=="win32",
},async()=>{
  const root=await mkdtemp(prefix);
  try{
    const v=createDesktopAccountCookieVault(root,gatewayOrigin);
    await v.save(new Map([["ordax_refresh","real-windows-dpapi-test-token"]]));
    const raw=await readFile(join(root,"desktop-account-cookies.dpapi.json"),"utf8");
    assert.doesNotMatch(raw,/real-windows-dpapi-test-token/);
    assert.equal((await v.load()).get("ordax_refresh"),"real-windows-dpapi-test-token");
    // Rotation must replace an existing encrypted file atomically on NTFS.
    await v.save(new Map([["ordax_refresh","rotated-windows-dpapi-token"]]));
    assert.equal((await v.load()).get("ordax_refresh"),"rotated-windows-dpapi-token");
    await v.save(new Map());
    assert.deepEqual(await readdir(root),[]);
  }finally{await rm(root,{recursive:true,force:true});}
});
