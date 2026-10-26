// Installed OrdaX Desktop Native HTTP host. The exact OS and pinned Surface
// assets were built and verified by the Electron owner before this process
// starts. This serves the SAME Native middleware as Vite without running Vite
// or transforming source at boot. The visual emulator still uses Vite.
import { createServer } from "node:http";
import { lstatSync, realpathSync, readFileSync } from "node:fs";
import { resolve, join, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeEmulatorPlugin } from "./native-host.mjs";

const TYPE = Object.freeze({
  ".mjs":"text/javascript; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".html":"text/html; charset=utf-8", ".txt":"text/plain; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".webp":"image/webp",
  ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".ico":"image/x-icon",
  ".woff":"font/woff", ".woff2":"font/woff2",
});
const SAFE_SEGMENT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const STATIC_PREFIX=/^\/(?:system\/)?(?:surface|apps|contracts|services|profile-packs|adapters|composition)\//;

export function createDesktopStaticMiddleware(root) {
  const system=realpathSync(join(root,"system"));
  return (req,res,next)=>{
    const url=String(req.url??"").split("?")[0];
    if(!STATIC_PREFIX.test(url)) return next();
    if(req.method!=="GET" && req.method!=="HEAD"){
      res.writeHead(405,{"Allow":"GET, HEAD","Cache-Control":"no-store"});
      return res.end();
    }
    // No URL-decoding or filesystem normalization of client-supplied paths:
    // encoded separators, backslashes, dot segments and Windows ADS are denied.
    const plain=url.startsWith("/system/")?url.slice(8):url.slice(1);
    const parts=plain.split("/");
    if(parts.some(p=>!SAFE_SEGMENT.test(p)||p==="."||p===".."||p.includes(":"))){
      res.writeHead(404,{"Cache-Control":"no-store"});return res.end();
    }
    const path=join(system,...parts);
    try{
      if(!path.startsWith(system+sep))throw Error("Outside system");
      let parent=system;
      for(const part of parts.slice(0,-1)){
        parent=join(parent,part);
        const st=lstatSync(parent);
        if(!st.isDirectory()||st.isSymbolicLink())throw Error("Linked directory");
      }
      const st=lstatSync(path),type=TYPE[extname(path).toLowerCase()];
      if(!type||!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>8*1024*1024)
        throw Error("Unpublished asset");
      const data=readFileSync(path);
      res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff","Content-Length":data.length});
      return res.end(req.method==="HEAD"?undefined:data);
    }catch{
      res.writeHead(404,{"Cache-Control":"no-store"});res.end();
    }
  };
}

export function createDesktopNativeServer({root,stateDirectory,accountGatewayOrigin}){
  if(typeof root!=="string"||!root || typeof stateDirectory!=="string"||!stateDirectory)
    throw TypeError("Installed Native root and persistent state directory required");
  if(process.env.ORDAX_DESKTOP_HOST!=="1"||
     !process.env.ORDAX_DESKTOP_UPDATE_USER_DATA||
     !process.env.ORDAX_DESKTOP_ASSETS_ROOT)
    throw TypeError("Installed Desktop host requires verified Electron session and built assets");
  const middleware=[];
  // The one Native plugin owns routes and all Electron grants. Reuse its
  // existing registration; do not fork accounts, files, observations or UI.
  nativeEmulatorPlugin(stateDirectory,{
    desktopHost:true,accountGatewayOrigin,
  }).configureServer({middlewares:{use(fn){middleware.push(fn);}}});
  middleware.push(createDesktopStaticMiddleware(root));
  const server=createServer((req,res)=>{
    let index=0;
    const next=()=>{
      if(res.writableEnded)return;
      const fn=middleware[index++];
      if(!fn){res.writeHead(404,{"Cache-Control":"no-store"});return res.end();}
      try{
        Promise.resolve(fn(req,res,next)).catch(()=>{
          if(!res.headersSent){res.writeHead(503,{"Cache-Control":"no-store"});res.end();}
          else res.destroy();
        });
      }catch{
        if(!res.headersSent){res.writeHead(503,{"Cache-Control":"no-store"});res.end();}
        else res.destroy();
      }
    };
    next();
  });
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  return server;
}

async function main(){
  const port=Number(process.env.ORDAX_EMULATOR_PORT);
  if(!Number.isInteger(port)||port<1||port>65535)
    throw TypeError("Invalid Desktop loopback port");
  const root=process.cwd();
  const accountGatewayOrigin=readFileSync(resolve(root,
    "system/services/account/gateway-base-url"),"utf8").trim();
  const server=createDesktopNativeServer({root,
    stateDirectory:process.env.ORDAX_EMULATOR_STATE_DIR,accountGatewayOrigin});
  server.on("error",error=>{
    process.stderr.write("Desktop Native listener failure: "+error.message+"\n");
    process.exitCode=1;
  });
  await new Promise((resolveListen,reject)=>{
    server.once("error",reject);
    server.listen(port,"127.0.0.1",resolveListen);
  });
  process.stdout.write("Desktop native host ready on loopback\n");
  const close=()=>server.close(()=>{});
  process.once("SIGINT",close);process.once("SIGTERM",close);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{process.stderr.write("Desktop Native host rejected: "+
    error.message+"\n");process.exitCode=1;});
}
