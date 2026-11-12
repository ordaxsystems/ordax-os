import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {adaptDependencyStyles,dependencyStylesPlugin} from '../tools/surface-web/dependency-styles.mjs';

const sonnerId='/node_modules/sonner/dist/index.mjs';
const singletonId='/node_modules/react-style-singleton/dist/es2015/singleton.js';
const sonner=await readFile(new URL('../node_modules/sonner/dist/index.mjs',import.meta.url),'utf8');
const singleton=await readFile(new URL('../node_modules/react-style-singleton/dist/es2015/singleton.js',import.meta.url),'utf8');
class Sheet { replaceSync(css){this.css=css;} }

test('locked dependency adapters reject changed inputs and ignore unrelated modules',()=>{
  assert.equal(adaptDependencyStyles('anything','/app/style.js'),null);
  for(const [source,id] of [[sonner,sonnerId],[singleton,singletonId]]){
    assert.throws(()=>adaptDependencyStyles(source+'\n',id),/input changed/);
    assert.ok(adaptDependencyStyles(source,'C:\\workspace'+id.replaceAll('/','\\')));
  }
});

test('toast delivery preserves exact upstream CSS without style elements',()=>{
  const output=adaptDependencyStyles(sonner,sonnerId).code;
  const helper=output.slice(0,output.indexOf('\nimport React'));
  const document={adoptedStyleSheets:[{existing:true}]};
  const css='[data-sonner-toaster] { color: red; }';
  runInNewContext(helper+'\n__insertCSS(css);',{document,CSSStyleSheet:Sheet,css});
  assert.equal(document.adoptedStyleSheets.length,2);
  assert.equal(document.adoptedStyleSheets[0].existing,true);
  assert.equal(document.adoptedStyleSheets[1].css,css);
  assert.doesNotThrow(()=>runInNewContext(helper+'\n__insertCSS(css);',{css}));
  assert.equal(output.slice(output.indexOf('\nimport React')),sonner.slice(sonner.indexOf('\nimport React')));
});

test('modal style singleton preserves reference counts and removes only its own sheet',()=>{
  const source=adaptDependencyStyles(singleton,singletonId).code.replace('export var stylesheetSingleton','var stylesheetSingleton');
  const original={existing:true};
  const document={adoptedStyleSheets:[original]};
  const create=runInNewContext(source+'\nstylesheetSingleton;',{document,CSSStyleSheet:Sheet});
  const a=create(),b=create();
  a.add('body[data-scroll-locked] {margin-right:17px}');
  const sheet=document.adoptedStyleSheets[1];
  a.add('ignored while referenced');
  b.add('.other{display:block}');
  assert.equal(document.adoptedStyleSheets.length,3);
  assert.equal(sheet.css,'body[data-scroll-locked] {margin-right:17px}');
  a.remove();
  assert.ok(document.adoptedStyleSheets.includes(sheet));
  a.remove();
  assert.equal(document.adoptedStyleSheets.includes(sheet),false);
  assert.equal(document.adoptedStyleSheets[0],original);
  b.remove();
  assert.equal(document.adoptedStyleSheets.length,1);
  a.add('.reopened{color:green}');
  assert.equal(document.adoptedStyleSheets[1].css,'.reopened{color:green}');
  a.remove();
});

test('build refuses incomplete dependency coverage',()=>{
  const plugin=dependencyStylesPlugin();
  plugin.buildStart();
  assert.throws(()=>plugin.buildEnd(),/coverage changed/);
  plugin.transform(sonner,sonnerId);
  plugin.transform(singleton,singletonId);
  assert.doesNotThrow(()=>plugin.buildEnd());
});
