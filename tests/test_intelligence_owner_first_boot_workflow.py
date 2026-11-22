"""Regression for same-commit Intelligence preseed in the Owner USB workflow.

This is a narrow source/workflow check. It never builds the image or touches media.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
OWNER = ROOT / ".github/workflows/creator-owner-dev-git.yml"

def owner_shell_lines():
    lines = OWNER.read_text(encoding="utf-8").splitlines()
    anchor = next(i for i, line in enumerate(lines) if "intelligence_status=$(python3 - <<'PY'" in line)
    headers = [i for i in range(anchor) if lines[i] == "        run: |"]
    if not headers:
        raise AssertionError("Owner first-boot shell block missing")
    head = headers[-1]
    end = next((i for i in range(anchor+1, len(lines))
                if lines[i].strip() and len(lines[i])-len(lines[i].lstrip())<=8),len(lines))
    block = lines[head+1:end]
    for row in block:
        if row.strip() and not row.startswith("          "):
            raise AssertionError("Owner CI run block has invalid YAML scalar indentation")
    return [row[10:] if row.strip() else "" for row in block]

class IntelligenceOwnerFirstBootWorkflowTests(unittest.TestCase):
    def test_same_commit_status_heredoc_is_executable(self):
        lines=owner_shell_lines()
        start=next(i for i,line in enumerate(lines) if line.startswith("intelligence_status=$(python3 - <<'PY'"))
        end=next(i for i in range(start+1,len(lines)) if lines[i]==")")
        segment=lines[start:end+1]
        self.assertEqual(segment[-2:],[ "PY", ")" ])
        self.assertEqual(segment[1], "import json")
        self.assertTrue(any("policy['source_revision']=='same-os-commit'" in row for row in segment))
        self.assertTrue(any("policy['activation_authorized'] is False" in row for row in segment))
        for line in segment:
            self.assertFalse(line.startswith(" "), f"Python heredoc line unexpectedly indented: {line!r}")
        python_block="\n".join(segment[1:-2])+"\n"
        compile(python_block,"<owner-ci-intelligence-source-policy>","exec")
        if os.name=="posix":
            script="\n".join(segment+['test "$intelligence_status" = canonical'])
            run=subprocess.run(["/bin/sh","-eu","-c",script],cwd=ROOT,
                               capture_output=True,text=True,timeout=10)
            self.assertEqual(run.returncode,0,run.stderr)

    def test_owner_uses_same_commit_ready_without_external_materializer(self):
        code="\n".join(owner_shell_lines())
        self.assertIn("system/intelligence/owner-stage.sh status",code)
        self.assertIn("system/intelligence/owner-stage.sh ready",code)
        self.assertIn(".intelligence-file-hashes",code)
        self.assertIn(".intelligence-source-sha",code)
        self.assertIn("--assembled-root \"$prepared_source\"",code)
        self.assertNotIn("ordax-intelligence.git",code)
        self.assertNotIn("tools/intelligence-source/materialize.py",code)
        self.assertIn("ORDAX_OWNER_FIRST_BOOT_INTELLIGENCE_SAME_COMMIT_READY=YES",code)

if __name__=="__main__":
    unittest.main()
