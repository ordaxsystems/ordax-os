import {createHash} from 'node:crypto';

// Build-only compatibility for the exact locked upstream files. Keep library
// behavior and CSS intact; change only the delivery of trusted bundled styles.
// Unexpected dependency updates must fail rather than silently lose the policy.
const targets = [
  {name:'sonner', file:'/node_modules/sonner/dist/index.mjs', hash:'f04470f1daac31d00185b2361b4da0c7b25e51dbec0f13f785ce8ccc68211a9a'},
  {name:'react-style-singleton', file:'/node_modules/react-style-singleton/dist/es2015/singleton.js', hash:'95c7ffcbdac6ebf19e85ea723995e153b90182b34843ed6b1bfc3d896081e51d'},
];

export function adaptDependencyStyles(code, id) {
  const target=targets.find(target=>id.replaceAll('\\','/').split('?')[0].endsWith(target.file));
  if(!target)return null;
  if(createHash('sha256').update(code).digest('hex')!==target.hash)throw Error(`Review required: ${target.name} style adapter input changed`);
  if(target.name==='sonner'){
    const start=code.indexOf('function __insertCSS(code) {');
    const end=code.indexOf('\nimport React');
    return {name:target.name, code:code.slice(0,start)+`function __insertCSS(code) {
  if (!code || typeof document === 'undefined') return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(code);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
`+code.slice(end)};
  }
  const start=code.indexOf('export var stylesheetSingleton');
  return {name:target.name, code:`function makeStyleTag() {
  return typeof document === 'undefined' ? null : new CSSStyleSheet();
}
function injectStyles(sheet, css) { sheet.replaceSync(css); }
function insertStyleTag(sheet) {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
`+code.slice(start).replace('stylesheet.parentNode && stylesheet.parentNode.removeChild(stylesheet);',
    'document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== stylesheet);')};
}

/** @returns {import('vite').Plugin} */
export function dependencyStylesPlugin() {
  const seen=new Set();
  return {
    name:'ordax-bundled-dependency-styles', apply:'build', enforce:'pre',
    buildStart(){seen.clear();},
    transform(code,id){
      const result=adaptDependencyStyles(code,id);
      if(!result)return null;
      seen.add(result.name);
      return {code:result.code,map:null};
    },
    buildEnd(error){
      if(!error&&seen.size!==targets.length)throw Error('Review required: bundled dependency stylesheet coverage changed');
    },
  };
}
