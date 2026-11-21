"""Same-commit Surface release assembly contracts; no external source."""
import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
P=Path(__file__).resolve().parents[1]/'tools/surface-source/assemble.py'
sp=importlib.util.spec_from_file_location('surface_assemble',P);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def git(p,*a):
 return subprocess.run(['git','-C',str(p),*a],capture_output=True,text=True,check=True).stdout.strip()
class SameCommitAssembly(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup)
  self.root=Path(t.name);self.os=self.root/'os';self.os.mkdir()
  git(self.os,'init','-q');git(self.os,'config','user.name','test');git(self.os,'config','user.email','test@invalid.local')
  for rel,data in [('system/entrypoint',b'#!/bin/sh\n'),('system/surface/ui/surface.mjs',b'UI\n'),('system/surface/workspace/view.tsx',b'WORKSPACE\n'),('system/surface/runtime/host.py',b'HOST\n')]:
   p=self.os/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  self.lock=self.os/'docs/contracts/surface-source.json';self.lock.parent.mkdir(parents=True)
  self.policy={'$schema':'prototype-ordax.surface-source/2','status':'canonical','source_repository':'ordaxsystems/ordax-os','source_ref':'same-commit','source_policy':'tracked-git-blobs-only','visual_source_paths':['system/surface/ui','system/surface/workspace'],'physical_disk_write_allowed':False}
  self.write();git(self.os,'add','-A');git(self.os,'commit','-qm','proof')
 def write(self):self.lock.write_text(json.dumps(self.policy))
 def test_same_commit_and_one_source(self):
  out=self.root/'out';receipt=m.assemble(self.os,out);sha=git(self.os,'rev-parse','HEAD')
  self.assertEqual(receipt['os_commit'],sha);self.assertEqual(receipt['surface_source_commit'],sha)
  self.assertEqual(receipt['visual_file_count'],2);self.assertTrue(receipt['single_visual_source'])
  self.assertEqual((out/'system/surface/ui/surface.mjs').read_bytes(),b'UI\n')
  self.assertEqual((out/'system/surface/runtime/host.py').read_bytes(),b'HOST\n')
 def test_refuse_overwrite(self):
  out=self.root/'out';m.assemble(self.os,out)
  with self.assertRaises(m.source.SurfaceSourceError):m.assemble(self.os,out)
 def test_refuse_dirty_visual(self):
  (self.os/'system/surface/ui/surface.mjs').write_bytes(b'TAMPER')
  with self.assertRaises(m.source.SurfaceSourceError):m.assemble(self.os,self.root/'out')
 def test_refuse_foreign_contract(self):
  self.policy['source_repository']='ordaxsystems/ordax-surface';self.write()
  with self.assertRaises(m.source.SurfaceSourceError):m.assemble(self.os,self.root/'out')
 def test_refuse_inside_os(self):
  with self.assertRaises(m.source.SurfaceSourceError):m.assemble(self.os,self.os/'out')
if __name__=='__main__':unittest.main()
