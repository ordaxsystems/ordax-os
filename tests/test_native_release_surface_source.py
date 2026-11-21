"""Verify same-commit Native Surface receipts, never cross-repo pins."""
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
P=Path(__file__).resolve().parents[1]/'tools/native-release-assembly/build.py'
sp=importlib.util.spec_from_file_location('native_surface_proof',P);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
SHA='a'*40
class NativeSameCommitProof(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.root=Path(t.name)
  self.system=self.root/'candidate/system'
  for rel,data in [('surface/ui/surface.mjs',b'UI\n'),('surface/workspace/view.tsx',b'WORKSPACE\n')]:
   p=self.system/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  p=self.root/'docs/contracts/surface-source.json';p.parent.mkdir(parents=True)
  p.write_text(json.dumps({'$schema':'prototype-ordax.surface-source/2','source_ref':'same-commit','source_repository':'ordaxsystems/ordax-os','visual_source_paths':['system/surface/ui','system/surface/workspace']}))
  h=hashlib.sha256()
  for f in sorted((self.system/'surface').rglob('*')):
   if f.is_file():
    h.update(f.relative_to(self.system.parent).as_posix().encode()+b'\0')
    h.update(hashlib.sha256(f.read_bytes()).digest())
  self.receipt={'$schema':'prototype-ordax.surface-assembly/2','os_commit':SHA,'surface_source_repository':'ordaxsystems/ordax-os','surface_source_commit':SHA,'user_interface_owner':'ordaxsystems/ordax-os','single_visual_source':True,'visual_paths':['system/surface/ui','system/surface/workspace'],'visual_file_count':2,'visual_source_sha256':h.hexdigest()}
  self.save()
 def save(self):(self.system/'surface/source-provenance.json').write_text(json.dumps(self.receipt))
 def verify(self):
  with patch.object(m,'ROOT',self.root),patch.object(m,'git_head',return_value=SHA):
   return m.verify_same_commit_surface_system(self.system)
 def test_valid_receipt(self):self.assertEqual(self.verify(),self.receipt)
 def test_changed_bytes(self):
  (self.system/'surface/ui/surface.mjs').write_bytes(b'TAMPER')
  with self.assertRaises(m.AssemblyError):self.verify()
 def test_wrong_sha(self):
  self.receipt['surface_source_commit']='b'*40;self.save()
  with self.assertRaises(m.AssemblyError):self.verify()
 def test_wrong_owner(self):
  self.receipt['user_interface_owner']='ordaxsystems/ordax-surface';self.save()
  with self.assertRaises(m.AssemblyError):self.verify()
 def test_missing_receipt(self):
  (self.system/'surface/source-provenance.json').unlink()
  with self.assertRaises(m.AssemblyError):self.verify()
if __name__=='__main__':unittest.main()
