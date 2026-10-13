import hashlib,json,re,struct,subprocess
from pathlib import Path
from urllib.parse import unquote
root=Path.cwd();out=root/'out/meridian-freeze-audit';ssot=root/'docs/design/MERIDIAN-VISUAL-SYSTEM.md'
mfpath=root/'docs/evidence/meridian-visual-freeze/manifest.json'
manifest=json.loads(mfpath.read_text(encoding='utf-8-sig'));document=ssot.read_text(encoding='utf-8-sig');results=[]
def check(name,passed,**details):results.append(dict(name=name,status='PASS' if passed else 'FAIL',**details))
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def git(*args):return subprocess.run(['git',*args],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode('utf-8').strip()
def slugs(text):
    used={};values=set(re.findall(r'<[^>]+\bid=["\x27]([^"\x27]+)',text))
    for title in re.findall(r'^#{1,6}\s+(.+?)(?:\s+#+)?\s*$',text,re.M):
        title=re.sub(r'!?\[([^\]]+)\]\([^)]+\)',r'\1',title)
        slug=''.join(c for c in title.lower() if c.isalnum() or c in ' _-').replace(' ','-')
        suffix=used.get(slug,0);used[slug]=suffix+1;values.add(slug if suffix==0 else f'{slug}-{suffix}')
    return values
links=[]
def links_in(file,text):
    for m in re.finditer(r'!?\[[^\]]*\]\(([^)]+)\)',text):
        target=m[1].strip().split(' "')[0].strip('<>')
        if re.match(r'^[a-z][a-z0-9+.-]*:',target,re.I):continue
        rel,_,anchor=target.partition('#');path=(file.parent/unquote(rel)).resolve() if rel else file
        exists=path.exists();anchor_ok=not anchor or exists and path.suffix=='.md' and unquote(anchor) in slugs(path.read_text(encoding='utf-8-sig'))
        contained=path.is_relative_to(root.resolve())
        row={'source':str(file.relative_to(root)),'target':target,'exists':exists,'anchorOK':bool(anchor_ok),'insideRepository':contained}
        links.append(row);check('link '+row['source']+' -> '+target,exists and anchor_ok and contained,**row)
links_in(ssot,document)
for relative in ['docs/README.md','docs/DESKTOP-IDENTITY.md','tools/meridian-preview/README.md']:
    delta=git('diff','--unified=0','7782b76','e7cf628','--',relative)
    added='\n'.join(l[1:] for l in delta.splitlines() if l.startswith('+') and not l.startswith('+++'))
    links_in(root/relative,added)
check('visual owner path',manifest['visualOwner']=='docs/design/MERIDIAN-VISUAL-SYSTEM.md')
actual_owner_hash=digest(ssot)
check('visual owner SHA256',actual_owner_hash==manifest['visualOwnerSha256'],expected=manifest['visualOwnerSha256'],actual=actual_owner_hash)
source_hashes=[]
for relative,expected in manifest['sourceSha256'].items():
    path=root/relative;actual=digest(path) if path.is_file() else None
    check('source SHA256 '+relative,actual==expected,expected=expected,actual=actual)
    source_hashes.append({'path':relative,'sha256':actual})
references=[];ids=[];doc_refs={}
for line in document.splitlines():
    if line.startswith('| REF-'):
        cells=[c.strip() for c in line.strip('|').split('|')];link=re.search(r'\]\(([^)]+)\)',cells[2])
        doc_refs[cells[0]]={'roleViewport':cells[1],'path':str((ssot.parent/link[1]).resolve().relative_to(root.resolve())).replace('\\','/'),'provenance':cells[3]}
for ref in manifest['referenceCaptures']:
    path=root/ref['path'];data=path.read_bytes();valid=data[:8]==b'\x89PNG\r\n\x1a\n';dims=struct.unpack('>II',data[16:24]) if valid else None
    expected_dims=tuple(map(int,re.search(r'(\d+)[×x](\d+)',ref['roleViewport']).groups()))
    check('reference SHA256 '+ref['id'],digest(path)==ref['sha256'])
    check('reference PNG viewport '+ref['id'],dims==expected_dims,actual=dims,expected=expected_dims)
    table=doc_refs.get(ref['id']);check('reference table/manifest '+ref['id'],table=={k:ref[k] for k in ['roleViewport','path','provenance']},document=table)
    ids.append(ref['id']);references.append(dict(ref,actualViewport=dims))
check('REF ids unique',len(ids)==len(set(ids)));check('REF table complete',set(ids)==set(doc_refs))
declared_refs=set(re.findall(r'\bREF-[A-Z][A-Z-]*\b',document));check('All referenced REF ids declared',declared_refs<=set(ids),unknown=sorted(declared_refs-set(ids)))
newcap=json.loads((root/'docs/evidence/meridian-visual-freeze/new-captures.json').read_text(encoding='utf-8-sig'))
for cap in newcap['captures']:
    relative='docs/evidence/meridian-visual-freeze/'+cap['file'];refs=[r for r in references if r['path']==relative]
    expected_material='ink' if '-grafite-' in cap['file'] else 'paper'
    check('new capture metadata '+cap['file'],len(refs)==1 and refs[0]['actualViewport']==(cap['width'],cap['height']) and cap['material']==expected_material)
check('new capture source baseline',newcap['head']==manifest['initialHead']=='7782b76daa0fcf4eb4229dd124be61d7b0abaeb9')
css=(root/'system/surface/experiments/meridian/meridian.tokens.css').read_text(encoding='utf-8-sig')
def props(block):return dict((k,v.strip()) for k,v in re.findall(r'(--md-[\w-]+)\s*:\s*([^;]+);',block))
paper=props(re.search(r'\[data-meridian\]\s*\{([^}]+)\}',css)[1])
ink={**paper,**props(re.search(r'\[data-meridian\]\[data-material="ink"\]\s*\{([^}]+)\}',css)[1])};palette=[]
for line in document.splitlines():
    m=re.match(r'\|\s*[^|]+/\s*(--md-[\w-]+)\s*\|\s*(#[0-9a-f]+)\s*\|\s*(#[0-9a-f]+)\s*\|',line,re.I)
    if m:
        token,arg,gra=m.groups();palette.append(token);check('palette snapshot '+token,paper.get(token)==arg and ink.get(token)==gra,actual=[paper.get(token),ink.get(token)],document=[arg,gra])
check('palette rows present',len(palette)==15,rows=len(palette))
check('aliases owner',['var(--md-subtle)','var(--md-accent-soft)']==[paper.get('--md-surface-alt'),paper.get('--md-clay-soft')])
check('no undefined literal md token',set(re.findall(r'--md-[\w-]+',document))<=set(paper),unknown=sorted(set(re.findall(r'--md-[\w-]+',document))-set(paper)))
check('spacing and track nominal snapshot',[paper.get('--md-space-'+str(i)) for i in range(1,8)]==['4px','8px','12px','16px','24px','32px','48px'] and paper['--md-rail-width']=='208px' and paper['--md-rail-compact']=='72px' and paper['--md-bar']==paper['--md-dock']=='66px')
check('motion and font owner',paper['--md-duration']=='180ms' and '--ordax-font' in paper['--md-font'])
table_errors=[];expected_cols=None
for number,line in enumerate(document.splitlines(),1):
    if line.startswith('|') and line.endswith('|'):
        count=len(re.split(r'(?<!\\)\|',line))-2
        if expected_cols is not None and count!=expected_cols:table_errors.append({'line':number,'columns':count,'expected':expected_cols})
        expected_cols=count if expected_cols is None else expected_cols
    else:expected_cols=None
check('Markdown table columns',not table_errors,errors=table_errors)
check('Markdown fences balanced',len(re.findall(r'^\s*'+chr(96)+r'{3,}',document,re.M))%2==0)
check('MVS ids unique',len(re.findall(r'\|\s*MVS-\d+\s*\|',document))==len(set(re.findall(r'\|\s*(MVS-\d+)\s*\|',document)))==9)
delta_paths=git('diff','--name-only','7782b76','e7cf628').splitlines()
check('Freeze diff documentation only',all(p.startswith('docs/') or p=='tools/meridian-preview/README.md' for p in delta_paths),paths=delta_paths)
check('Freeze diff source/runtime empty',git('diff','--name-only','7782b76','e7cf628','--','system','tests','tools/browser-proof','tools/meridian-preview',':!tools/meridian-preview/README.md')=='')
check('branch',git('rev-parse','--abbrev-ref','HEAD')=='codex/meridian-design-lab');check('HEAD',git('rev-parse','HEAD')=='e7cf628a01878c484d47997721518fe6f2330c10')
check('main unchanged',git('rev-parse','main')==manifest['mainInitialFinal']=='fafed4a8916587ad35bc07c2f3baa1a60d561b1e')
for sha in ['44d2ef0','7782b76','ebd58cd','2b609ed']:check('ancestor '+sha,subprocess.run(['git','merge-base','--is-ancestor',sha,'HEAD'],cwd=root).returncode==0)
record={'date':'2026-10-13','head':git('rev-parse','HEAD'),'main':git('rev-parse','main'),'results':results,'links':links,'references':references,'sourceHashes':source_hashes,'notRun':['browser matrix','Foundation','build','CI','kernel','USB','hardware']}
(out/'checks.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checks':len(results),'pass':sum(r['status']=='PASS' for r in results),'fail':[r for r in results if r['status']=='FAIL'],'links':len(links),'references':len(references),'sourceHashes':len(source_hashes)},ensure_ascii=False))
raise SystemExit(any(r['status']=='FAIL' for r in results))
