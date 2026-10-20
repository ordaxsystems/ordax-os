// The canonical OrdaX file-space/11 protocol backed by a private, persistent
// Windows user-data directory. Never maps "/" to a Windows drive or host HOME.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir, lstat, readdir, readFile, rename, unlink, rm, copyFile, writeFile, realpath,
} from "node:fs/promises";
import { resolve, join, sep, dirname, basename, extname } from "node:path";
import {
  MAX_TEXT_FILE_BYTES, MAX_FILE_COPY_BYTES, MAX_FILE_EXPORT_BYTES,
  MAX_FILE_IMPORT_BYTES, MAX_IMAGE_PREVIEW_BYTES, MAX_MEDIA_PREVIEW_BYTES,
  MAX_DOCUMENT_PREVIEW_BYTES, validateFileSpacePath, validateFileListing,
  validateTextFile, validateTrashListing,
} from "../../contracts/file-space.mjs";

const INVALID_NAME = /[\\:\x00-\x1f<>|"?*]/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
const SYSTEM_TRASH = ".ordax-trash";
const IMAGES=Object.freeze({".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".bmp":"image/bmp",".avif":"image/avif"});
const MEDIA=Object.freeze({".mp3":"audio/mpeg",".wav":"audio/wav",".flac":"audio/flac",".aac":"audio/aac",".ogg":"audio/ogg",".m4a":"audio/mp4",".mp4":"video/mp4",".webm":"video/webm"});
const DOCS=Object.freeze({".pdf":"application/pdf"});
class RequestFailure extends Error { constructor(status,reason){super(reason);this.status=status;} }
const reject=(status,reason)=>{throw new RequestFailure(status,reason)};
function segments(logical) {
  validateFileSpacePath(logical);
  if(logical.length>4096)reject(400,"Path too long");
  const parts=logical==="/" ? [] : logical.slice(1).split("/");
  for(const part of parts){
    if(part.length>240 || INVALID_NAME.test(part) || part.endsWith(".") ||
       part.endsWith(" ") || part.toLowerCase()===SYSTEM_TRASH ||
       RESERVED_NAME.test(part))reject(400,"Unsupported Windows filename");
  }
  return parts;
}
function entryName(value){
  if(typeof value!=="string")reject(400,"Filename must be text");
  const parts=segments("/"+value);
  if(parts.length!==1)reject(400,"Expected a single filename");
  return value;
}
function childLogical(parent,name) {return parent==="/" ? "/"+name : parent+"/"+name;}
async function checkedRoot(root) {
  await mkdir(root,{recursive:true});
  const stat=await lstat(root);
  if(!stat.isDirectory() || stat.isSymbolicLink())reject(403,"Untrusted file root");
}
async function inside(root,logical,{missing=false}={}) {
  let current=root;
  const parts=segments(logical);
  for(let i=0;i<parts.length;i++){
    const candidate=join(current,parts[i]);
    if(!candidate.startsWith(root+sep))reject(403,"Outside OrdaX files");
    let stat;
    try{stat=await lstat(candidate);}
    catch(error){
      if(error?.code==="ENOENT" && missing && i===parts.length-1) return candidate;
      if(error?.code==="ENOENT")reject(404,"File or directory missing");
      throw error;
    }
    if(stat.isSymbolicLink())reject(403,"Symbolic links are not available");
    if(i<parts.length-1 && !stat.isDirectory())reject(400,"Not a directory");
    current=candidate;
  }
  return current;
}
async function existing(root,path) {
  const filename=await inside(root,path);
  // No reparse-point traversal beyond the bounded logical directory.
  const actual=await realpath(filename);
  if(actual!==root && !actual.startsWith(root+sep))reject(403,"Escaped file root");
  return filename;
}
async function listing(root,logical) {
  const folder=await existing(root,logical);
  if(!(await lstat(folder)).isDirectory())reject(400,"Not a directory");
  const entries=[];
  for(const dirent of await readdir(folder,{withFileTypes:true})){
    if(dirent.name.toLowerCase()===SYSTEM_TRASH || dirent.isSymbolicLink())continue;
    try{
      entryName(dirent.name);
      if(!dirent.isFile() && !dirent.isDirectory())continue;
      const stat=await lstat(join(folder,dirent.name));
      entries.push({name:dirent.name,kind:stat.isDirectory()?"directory":"file",
        size:stat.isFile()?stat.size:0,modifiedAt:Math.max(0,Math.floor(stat.mtimeMs))});
    }catch(error){
      if(error instanceof RequestFailure || error instanceof TypeError)continue;
      throw error;
    }
  }
  entries.sort((a,b)=>a.name.localeCompare(b.name));
  return validateFileListing({path:logical,entries});
}
function params(req) {return new URL(req.url,"http://localhost").searchParams;}
async function body(req,limit) {
  let bytes=0;const chunks=[];
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>limit)reject(413,"Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if(!String(req.headers["content-type"]??"").startsWith("application/json"))
    reject(415,"Expected JSON");
  try {return JSON.parse((await body(req,16384)).toString("utf8"));}
  catch(error){if(error instanceof RequestFailure)throw error;reject(400,"Invalid JSON");}
}
async function notPresent(path) {
  try{await lstat(path);reject(409,"Destination already exists");}
  catch(error){if(error?.code==="ENOENT")return;throw error;}
}
async function regularFile(root,logical,limit) {
  const path=await existing(root,logical);
  const stat=await lstat(path);
  if(!stat.isFile())reject(400,"Not a regular file");
  if(stat.size>limit)reject(413,"File exceeds size limit");
  return {path,stat};
}
function binary(response,bytes,mime,downloadName=null) {
  response.writeHead(200,{
    "Content-Type":mime,
    ...(downloadName ? {"Content-Disposition":'attachment; filename="ordax-download"'} : {}),
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Content-Length":bytes.length,
  });
  response.end(bytes);
}
function metadataPath(root,id){return join(root,SYSTEM_TRASH,id+".json");}
function payloadPath(root,id){return join(root,SYSTEM_TRASH,id+".data");}
async function trashListing(root) {
  const dir=join(root,SYSTEM_TRASH);
  await mkdir(dir,{recursive:true});
  const records=[];
  for(const name of await readdir(dir)){
    if(!/^[0-9a-f]{32}\.json$/.test(name))continue;
    const id=name.slice(0,32);
    const metadata=metadataPath(root,id);
    const metadataStat=await lstat(metadata);
    if(!metadataStat.isFile() || metadataStat.isSymbolicLink())reject(503,"Untrusted trash metadata");
    const json=JSON.parse(await readFile(metadata,"utf8"));
    if(json.id!==id)reject(503,"Trash metadata mismatch");
    const snapshot=validateTrashListing({entries:[json]});
    if(!(await lstat(payloadPath(root,id))).isSymbolicLink())records.push(snapshot.entries[0]);
    else reject(503,"Trash must not contain symbolic links");
  }
  return validateTrashListing({entries:records});
}
function httpStatus(error) {
  if(error instanceof RequestFailure)return error.status;
  if(error instanceof TypeError || error instanceof SyntaxError)return 400;
  if(error?.code==="ENOENT")return 404;
  if(error?.code==="EEXIST")return 409;
  if(error?.code==="EACCES" || error?.code==="EPERM")return 403;
  return 503;
}
export function createDesktopFileSpaceMiddleware(filesDirectory) {
  if(typeof filesDirectory!=="string" || !filesDirectory)throw TypeError("Desktop files directory required");
  const root=resolve(filesDirectory);
  const endpoints=new Set([
    "/__ordax/native/files", "/__ordax/native/file-content",
    "/__ordax/native/file-import", "/__ordax/native/file-export",
    "/__ordax/native/trash", "/__ordax/native/image-preview",
    "/__ordax/native/media-preview", "/__ordax/native/document-preview",
  ]);
  let queue=Promise.resolve();
  const serial=(operation)=>{
    const result=queue.then(operation);
    queue=result.then(()=>{},()=>{});
    return result;
  };
  return function desktopFileSpace(req,res,next) {
    const path=(req.url??"").split("?")[0];
    if(!endpoints.has(path))return next();
    void serial(async()=>{
      await checkedRoot(root);
      const method=req.method;
      const query=params(req);
      const logical=validateFileSpacePath(query.get("path")??"/");
      const reply=(status,what)=>{
        res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
        res.end(JSON.stringify(what));
      };
      if(method==="POST"){
        if(req.headers.origin!=="http://"+req.headers.host)reject(403,"Same-origin writes required");
      }
      if(path==="/__ordax/native/files" && method==="GET")
        return reply(200,await listing(root,logical));
      if(path==="/__ordax/native/trash" && method==="GET")
        return reply(200,await trashListing(root));
      if(path==="/__ordax/native/file-content" && method==="GET"){
        const {path:file,stat}=await regularFile(root,logical,MAX_TEXT_FILE_BYTES);
        const text=new TextDecoder("utf-8",{fatal:true}).decode(await readFile(file));
        if(text.includes("\0"))reject(415,"Not a text file");
        return reply(200,validateTextFile({path:logical,size:stat.size,text}));
      }
      if(["/__ordax/native/file-export","/__ordax/native/image-preview",
        "/__ordax/native/media-preview","/__ordax/native/document-preview"].includes(path) && method==="GET"){
        const preview=path!=="/__ordax/native/file-export";
        const max=path.includes("image-preview")?MAX_IMAGE_PREVIEW_BYTES:
          path.includes("media-preview")?MAX_MEDIA_PREVIEW_BYTES:
          path.includes("document-preview")?MAX_DOCUMENT_PREVIEW_BYTES:MAX_FILE_EXPORT_BYTES;
        const {path:file}=await regularFile(root,logical,max);
        const ext=extname(file).toLowerCase();
        const mime=path.includes("image-preview")?IMAGES[ext]:
          path.includes("media-preview")?MEDIA[ext]:
          path.includes("document-preview")?DOCS[ext]:"application/octet-stream";
        if(!mime)reject(415,"Unsupported preview format");
        return binary(res,await readFile(file),mime,preview?null:basename(file));
      }
      if(path==="/__ordax/native/file-import" && method==="POST"){
        if(!String(req.headers["content-type"]??"").startsWith("application/octet-stream"))
          reject(415,"Expected binary file import");
        const name=entryName(query.get("name"));
        const folder=await existing(root,logical);
        if(!(await lstat(folder)).isDirectory())reject(400,"Not a directory");
        const destination=await inside(root,childLogical(logical,name),{missing:true});
        await notPresent(destination);
        const bytes=await body(req,MAX_FILE_IMPORT_BYTES);
        await writeFile(destination,bytes,{flag:"wx"});
        return reply(200,await listing(root,logical));
      }
      if(path==="/__ordax/native/files" && method==="POST"){
        const input=await jsonBody(req);
        const action=input?.action;
        if(action==="create-directory"){
          const name=entryName(input.name);
          const parent=await existing(root,input.path);
          if(!(await lstat(parent)).isDirectory())reject(400,"Not a directory");
          await mkdir(await inside(root,childLogical(input.path,name),{missing:true}));
          return reply(200,await listing(root,input.path));
        }
        if(["rename-entry","move-entry","copy-file","trash-entry"].includes(action)){
          const sourceLogical=childLogical(input.sourcePath??input.path,entryName(input.name));
          const src=await existing(root,sourceLogical);
          const sourceStat=await lstat(src);
          if(action==="trash-entry"){
            const trash=join(root,SYSTEM_TRASH);await mkdir(trash,{recursive:true});
            const id=randomBytes(16).toString("hex");
            const record={id,name:input.name,kind:sourceStat.isDirectory()?"directory":"file",
              size:sourceStat.isFile()?sourceStat.size:0,
              modifiedAt:Math.max(0,Math.floor(sourceStat.mtimeMs)),
              originalPath:sourceLogical,trashedAt:Date.now()};
            validateTrashListing({entries:[record]});
            await rename(src,payloadPath(root,id));
            try{await writeFile(metadataPath(root,id),JSON.stringify(record),{flag:"wx"});}
            catch(error){await rename(payloadPath(root,id),src);throw error;}
            return reply(200,await listing(root,input.path));
          }
          const parentLogical=action==="rename-entry"?input.path:input.destinationPath;
          const destinationName=action==="rename-entry"?entryName(input.newName):
            action==="copy-file"?entryName(input.newName??input.name):entryName(input.name);
          const parent=await existing(root,parentLogical);
          if(!(await lstat(parent)).isDirectory())reject(400,"Destination is not a directory");
          const destination=await inside(root,childLogical(parentLogical,destinationName),{missing:true});
          await notPresent(destination);
          if(action==="copy-file"){
            if(!sourceStat.isFile())reject(400,"Only regular files may be copied");
            if(sourceStat.size>MAX_FILE_COPY_BYTES)reject(413,"Copy exceeds size limit");
            await copyFile(src,destination,constants.COPYFILE_EXCL);
          }else{
            if(sourceStat.isDirectory() && destination.startsWith(src+sep))
              reject(400,"Cannot move directory into itself");
            await rename(src,destination);
          }
          return reply(200,await listing(root,parentLogical));
        }
        if(action==="restore-trash-entry"){
          if(typeof input.id!=="string" || !/^[0-9a-f]{32}$/.test(input.id))
            reject(400,"Invalid trash id");
          const name=metadataPath(root,input.id);
          const metadataStat=await lstat(name);
          if(!metadataStat.isFile() || metadataStat.isSymbolicLink())reject(503,"Untrusted trash metadata");
          const record=JSON.parse(await readFile(name,"utf8"));
          const validated=validateTrashListing({entries:[record]}).entries[0];
          if(validated.id!==input.id)reject(503,"Trash identity mismatch");
          const destination=await inside(root,validated.originalPath,{missing:true});
          await notPresent(destination);
          const source=payloadPath(root,input.id);
          if((await lstat(source)).isSymbolicLink())reject(403,"Untrusted trash data");
          await rename(source,destination);
          await unlink(name);
          return reply(200,await trashListing(root));
        }
        reject(400,"Unsupported file operation");
      }
      reject(405,"File method unavailable");
    }).catch(error=>{
      if(res.headersSent)return res.destroy();
      res.writeHead(httpStatus(error),{"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({error:"Windows OrdaX file operation failed"}));
    });
  };
}
