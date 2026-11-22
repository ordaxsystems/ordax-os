// OS-owned read-only presentation renderer from the canonical same-commit Surface.
// The only output is the explicit directory argument, never OS/Site source.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import postcss from 'postcss';
import {readFile,readdir,mkdir,writeFile,rm,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,sep} from 'node:path';
import {listFirstPartyApps} from '../../system/apps/catalog.mjs';
import {listSurfaceShortcutAppIds} from '../../system/services/surface/shortcut-catalog.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const out=resolve(process.argv[2]??''), expectedCommit=process.argv[3]??'';
const inside=(a,b)=>b===a||b.startsWith(a+sep);
if(process.argv.length!==4||!/[a-f0-9]{40}/.test(expectedCommit)
  ||inside(root,out)||inside(out,root))throw Error('Required external output and exact OS Git revision');
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const osSha=git(root,'rev-parse','HEAD');
if(osSha!==expectedCommit)throw Error('OS checkout does not match pinned revision');
if(git(root,'status','--porcelain','--','system/surface/ui','system/surface/workspace',
       'system/apps','system/services','site/scripts/canonical-preview-entry.tsx',
       'site/scripts/canonical-preview.mjs'))throw Error('Uncommitted canonical source cannot be exported');
const digest=data=>createHash('sha256').update(data).digest('hex');
const gitBlob=data=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+data.length+'\0'),data])).digest('hex');
const blobs=(dir,prefixes)=>new Map(git(dir,'ls-tree','-r','HEAD','--',...prefixes).split('\n').filter(Boolean)
  .map(line=>{
    const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if(!match)throw Error('Unsupported Git source entry');
    return [match[3],match[2]];
  }));
const tracked=blobs(root,['system','site/scripts']);
const used=new Set([
  resolve(root,'site/scripts/canonical-preview-entry.tsx'),
  resolve(root,'site/scripts/canonical-preview.mjs'),
  resolve(root,'system/apps/catalog.mjs'),
  resolve(root,'system/services/surface/shortcut-catalog.mjs'),
]);
const identityMock="import {projectSidebarAccount} from '"+resolve(root,'system/surface/ui/sidebar-account.mjs').replaceAll('\\','/')+"';export function useWebAccount(t){const identity={state:'signed-out'};const sidebarAccount=projectSidebarAccount(identity,false,t);return {identity,actions:{supportedActions:[],pending:false},displayName:sidebarAccount.displayName,initials:sidebarAccount.initials,sidebarAccount,offline:false,authorized:{ready:false,visibleSpaces:[],activeSpace:null}}}";
const adapters=new Map([
 ['account-context',identityMock],
 ['preferences-context',"export function useWebPreferences(){return {theme:'light',colorTheme:'light',snapshot:{},persistence:{state:'memory'},setColorTheme(){},setPreference(){}}}"],
 ['client-context',"export function useIntelligenceClient(){return {snapshot:{state:'unavailable',inferenceAvailable:false}}}"]
]);
const plugin={
 name:'readonly-surface-demo-adapters',enforce:'pre',
 resolveId(specifier,importer){
   if(!importer||!importer.replaceAll('\\','/').includes('/system/surface/workspace/'))return null;
   const name=specifier.split('/').at(-1).replace(/\.tsx$/,'');
   return adapters.has(name)?'\0preview:'+name:null;
 },
 load(id){return id.startsWith('\0preview:')?adapters.get(id.slice(9)):null},
 transform(_source,id){
   const path=id.split('?')[0];
   if(path.startsWith(root+sep)&&!path.includes(sep+'node_modules'+sep))used.add(path);
   return null;
 }
};
try{await lstat(out);throw Error('Refusing to overwrite existing output')}catch(e){if(e.code!=='ENOENT')throw e}
await mkdir(dirname(out),{recursive:true});
await build({configFile:false,root,plugins:[plugin,react(),tailwind()],
 ssr:{noExternal:true},
 resolve:{alias:{'@':resolve(root,'system/surface/workspace')}},
 build:{ssr:resolve(root,'site/scripts/canonical-preview-entry.tsx'),
 outDir:out,emptyOutDir:false,ssrEmitAssets:true,cssCodeSplit:false,
 rollupOptions:{output:{entryFileNames:'render.mjs'}}},logLevel:'warn'});
const {renderMeridianPresentation}=await import(pathToFileURL(resolve(out,'render.mjs')).href);
const preview=renderMeridianPresentation();
await rm(resolve(out,'render.mjs'));
const sources=[];
for(const file of [...used].sort()){
  const name=relative(root,file).replaceAll('\\','/');
  if(name.startsWith('..')||!(name.startsWith('system/')||name.startsWith('site/scripts/')))
    throw Error('External source dependency: '+name);
  const expected=tracked.get(name);
  if(!expected)throw Error('Untracked canonical dependency: '+name);
  const bytes=await readFile(file);
  const committed=execFileSync('git',['-C',root,'show',osSha+':'+name]);
  // Windows clean checkouts may use CRLF; hash original committed LF bytes.
  const normalized=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  if(gitBlob(committed)!==expected
      ||(!bytes.equals(committed)&&!normalized.equals(committed)))
    throw Error('Modified canonical dependency: '+name);
  sources.push({repository:'ordaxsystems/ordax-os',commit:osSha,path:name,
    git_blob:expected,sha256:digest(committed)});
}
const assets=resolve(out,'assets');
const cssFiles=(await readdir(assets)).filter(name=>name.endsWith('.css'));
if(cssFiles.length!==1)throw Error('Expected one Surface CSS bundle');
const cssTree=postcss.parse(await readFile(resolve(assets,cssFiles[0]),'utf8'));
cssTree.walkAtRules('import',()=>{throw Error('External CSS import forbidden')});
cssTree.walkComments(rule=>rule.remove());
cssTree.walkRules(rule=>{
  if(rule.parent.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;
  rule.selectors=rule.selectors.map(selector=>
    '.demo-native '+selector.replace(/(^|[ ,])(?:html|body|:root)(?=$|[ .:#[])/g,
    '$1.demo-native-root'));
});
cssTree.walkAtRules('media',rule=>{
  if(/\bwidth\b/.test(rule.params)){rule.name='container';rule.params='public-surface '+rule.params}
});
let inline='',ordinal=0;
function noInlineStyles(html){
 return html.replace(/<([a-z][a-z0-9-]*)([^>]*?) style="([^"]*)"([^>]*)>/g,
 (_all,tag,before,style,after)=>{
   if(/url\s*\(|[{}]/i.test(style))throw Error('Forbidden dynamic preview style');
   const cls='snapshot-style-'+(++ordinal);
   inline+=' .demo-native .'+cls+'{'+style.replaceAll('&quot;','"')+'}';
   let attrs=before+after;
   if(/class="/.test(attrs))attrs=attrs.replace('class="','class="'+cls+' ');
   else attrs+=' class="'+cls+'"';
   return '<'+tag+attrs+'>';
 });
}
preview.chrome=noInlineStyles(preview.chrome);
for(const id of Object.keys(preview.views))preview.views[id]=noInlineStyles(preview.views[id]);
if(Object.keys(preview.views).length!==11||!preview.views.home||!preview.chrome.includes('demo-native-root'))
 throw Error('Incomplete readonly Surface demo');
const html=[preview.chrome,...Object.values(preview.views)].join('');
if(/<script\b|<iframe\b|<form\b[^>]*action=/i.test(html))
 throw Error('Executable or authoritative browser UI prohibited');
const css=cssTree.toString()+inline;
const stylesheet=resolve(assets,'surface-snapshot.css');
await writeFile(stylesheet,css);
if(resolve(assets,cssFiles[0])!==stylesheet)await rm(resolve(assets,cssFiles[0]));
const catalog={
  $schema:'ordax.os-public-catalog-projection/1',
  source_repository:'ordaxsystems/ordax-os',
  source_commit:osSha,
  source:{apps:'system/apps/catalog.mjs'},
  apps:listFirstPartyApps().map(app=>({id:app.id,title:app.title,
    description:app.description,monogram:app.monogram})),
  home:{rail_apps:listSurfaceShortcutAppIds('central')},
};
if(catalog.apps.length<1||catalog.home.rail_apps.some(id=>!catalog.apps.some(a=>a.id===id)))
  throw Error('Invalid canonical OS app projection');
const catalogBytes=Buffer.from(JSON.stringify(catalog)+'\n');
const ids=catalog.apps.map(x=>x.id);
if(new Set(ids).size!==ids.length)throw Error('Duplicate OS projected app IDs');
preview.presentation='example-only-not-an-authorized-session';
preview.sources=sources;
preview.cssSha256=digest(Buffer.from(css));
const fixture={
  $schema:'prototype-ordax.public-playground-fixture/1',
  source:catalog.source,
  home:catalog.home,
  apps:catalog.apps,
  surface:preview,
};
await writeFile(resolve(assets,'playground-fixture.json'),JSON.stringify(fixture)+'\n');
const items=[];
async function scan(dir){
 for(const part of await readdir(dir,{withFileTypes:true})){
   if(part.isSymbolicLink())throw Error('Output symlink forbidden');
   const path=resolve(dir,part.name);
   if(part.isDirectory())await scan(path);
   else if(part.isFile()){
     const data=await readFile(path);
     items.push({path:relative(out,path).replaceAll('\\','/'),size:data.length,sha256:digest(data)});
   }else throw Error('Unexpected output entry');
 }
}
await scan(out);
items.sort((a,b)=>a.path.localeCompare(b.path));
await writeFile(resolve(out,'manifest.json'),JSON.stringify({
 $schema:'ordax.meridian-readonly-preview-artifact/2',status:'candidate-not-published',
 artifact_class:'ordax-meridian-preview',runtime_authority:false,
 catalog_schema:catalog.$schema,
 catalog_sha256:digest(catalogBytes),
 sources,
 source_repository:'ordaxsystems/ordax-os',source_commit:osSha,
 files:items
},null,2)+'\n');
console.log('MERIDIAN_READONLY_PREVIEW=PASS views=11 apps='+catalog.apps.length+' files='+items.length+
 ' os='+osSha);
