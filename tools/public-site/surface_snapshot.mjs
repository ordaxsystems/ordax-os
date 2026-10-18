// Build-time rendering only. No Surface runtime or account adapter ships to the portal.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import postcss from 'postcss';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {stripGeneratedSurfaceCopy} from './generated_copy.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'out/public-surface-snapshot');
const assets=resolve(root,'sites/public/assets');
const generated=new Set();
const adapters={
 'account-context':`export function useWebAccount(){return {identity:{state:'signed-out'},actions:{supportedActions:[],pending:false},displayName:'Visitante',initials:null,offline:false,authorized:{ready:false,visibleSpaces:[],activeSpace:null}}}`,
 'preferences-context':`export function useWebPreferences(){return {theme:'light',colorTheme:'light',snapshot:{},persistence:{state:'memory'},setColorTheme(){},setPreference(){}}}`,
 'client-context':`export function useIntelligenceClient(){return {snapshot:{state:'unavailable',inferenceAvailable:false}}}`,
};
await build({configFile:false,root,plugins:[{name:'public-snapshot-read-only-adapters',enforce:'pre',resolveId(source){const key=source.split('/').at(-1);if(Object.hasOwn(adapters,key))return '\0snapshot:'+key;},load(id){if(id.startsWith('\0snapshot:'))return adapters[id.slice(10)];},transform(_code,id){if(id.replaceAll('\\','/').startsWith(root.replaceAll('\\','/'))&&!id.includes('node_modules'))generated.add(id.split('?')[0]);}},react(),tailwind()],resolve:{alias:{'@':resolve(root,'system/surface/workspace')}},build:{ssr:resolve(root,'tools/public-site/surface-snapshot-entry.tsx'),outDir:out,emptyOutDir:true,ssrEmitAssets:true,cssCodeSplit:false,rollupOptions:{output:{entryFileNames:'snapshot.mjs'}}},logLevel:'warn'});
const {snapshot}=await import(pathToFileURL(resolve(out,'snapshot.mjs')).href);
const data=snapshot();
const catalogPath=resolve(assets,'../i18n/catalog.js');
let catalogText=stripGeneratedSurfaceCopy(await readFile(catalogPath,'utf8'));
const scope=vm.createContext({window:{}});vm.runInContext(catalogText,scope);
const existing=new Set(Object.values(scope.window.OrdaXPublicI18nCatalog.messages['pt-BR']));
const html=[data.chrome,...Object.values(data.views)].join(' ');
const decode=value=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const copy=[...html.replace(/<time[\s\S]*?<\/time>/g,'').replace(/<[^>]*>/g,'\n').split('\n'),...[...html.matchAll(/(?:aria-label|title|alt|placeholder)="([^"]+)"/g)].map(m=>m[1])].map(v=>decode(v).trim()).filter(Boolean);
const additions=[...new Set(copy)].filter(value=>!existing.has(value)&&data.sourceCopy[value]).map(value=>[value,data.sourceCopy[value]]);
const block='  // BEGIN GENERATED SURFACE COPY\n'+additions.map(([pt,en])=>'  register("surface.'+createHash('sha256').update(pt).digest('hex').slice(0,12)+'", '+JSON.stringify(pt)+', '+JSON.stringify(en)+');').join('\n')+'\n  // END GENERATED SURFACE COPY\n';
await writeFile(catalogPath,catalogText.replace('  STATIC_PAIRS.forEach(',block+'  STATIC_PAIRS.forEach('),'utf8');
await writeFile(resolve(out,'missing-copy.json'),JSON.stringify([...new Set(copy)].filter(value=>!existing.has(value)&&!data.sourceCopy[value]),null,2));
delete data.sourceCopy;
const imageFiles=await readdir(resolve(out,'assets'));
const imageMap=[];
for(const name of imageFiles){
 const kind=name.startsWith('alpine-day-')?'day':name.startsWith('alpine-night-')?'night':null;
 if(kind){const target='public-surface-'+kind+'.jpg';imageMap.push([name,target]);await copyFile(resolve(out,'assets',name),resolve(assets,target));}
}
await copyFile(resolve(root,'system/surface/workspace/assets/demo-salvador-1.jpg'),resolve(assets,'public-space-city.jpg'));
function paths(markup){markup=markup.replace(/file:[^\s"'<>)]*demo-salvador-1\.jpg/g,'/assets/public-space-city.jpg');for(const [name,target] of imageMap)markup=markup.replaceAll('/assets/'+name,'/assets/'+target);return markup.replace(/\/assets\/ordax-symbol-[A-Za-z0-9_-]+\.png/g,'/assets/ordax-symbol.png');}
data.chrome=paths(data.chrome);for(const id of Object.keys(data.views))data.views[id]=paths(data.views[id]);
// Inline React styles become classes in the emitted stylesheet for the public CSP.
let inline='';let ordinal=0;
function csp(markup){return markup.replace(/<([a-z][a-z0-9-]*)([^>]*?) style="([^"]*)"([^>]*)>/g,(_m,tag,before,style,after)=>{const cls='snapshot-style-'+(++ordinal);inline+=' .demo-native .'+cls+'{'+style.replaceAll('&quot;','"')+'}';let attrs=before+after;if(/class="/.test(attrs))attrs=attrs.replace('class="','class="'+cls+' ');else attrs+=' class="'+cls+'"';return '<'+tag+attrs+'>';});}
data.chrome=csp(data.chrome);for(const id of Object.keys(data.views))data.views[id]=csp(data.views[id]);
let css='';
for(const filename of await readdir(resolve(out,'assets'))){if(filename.endsWith('.css'))css+=await readFile(resolve(out,'assets',filename),'utf8');}
const tree=postcss.parse(css);
tree.walkAtRules('import',rule=>rule.remove());
tree.walkComments(comment=>comment.remove());
tree.walkRules(rule=>{if(rule.parent.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;rule.selectors=rule.selectors.map(selector=>'.demo-native '+selector.replace(/(^|[ ,])(?:html|body|:root)(?=$|[ .:#[])/g,'$1.demo-native-root'));});
tree.walkAtRules('media',rule=>{if(/\bwidth\b/.test(rule.params)){rule.name='container';rule.params='public-surface '+rule.params;}});
await mkdir(assets,{recursive:true});
await writeFile(resolve(assets,'surface-snapshot.css'),paths(tree.toString()+inline).replaceAll('http://www.w3.org/2000/svg','http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'),'utf8');
// The emitted browser artifact contains markup and CSS only.
data.sources=await Promise.all([...generated].filter(p=>true).sort().map(async path=>({path:relative(root,path).replaceAll('\\','/'),sha256:createHash('sha256').update(/\.(?:tsx?|jsx?|mjs|css|json|svg)$/.test(path)?(await readFile(path,'utf8')).replaceAll('\r\n','\n'):await readFile(path)).digest('hex')})));
data.cssSha256=createHash('sha256').update((await readFile(resolve(assets,'surface-snapshot.css'),'utf8')).replaceAll('\r\n','\n')).digest('hex');
await writeFile(resolve(assets,'surface-snapshot.json'),JSON.stringify(data),'utf8');
console.log('PUBLIC_SURFACE_SNAPSHOT=PASS views='+Object.keys(data.views).length);
