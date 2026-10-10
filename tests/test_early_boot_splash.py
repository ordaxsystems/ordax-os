"""Pre-Surface source tests: no video decoder, no boot-blocking graphics dependency."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "bootstrap/boot-splash"
FRAME_BYTES = 640 * 360 * 2

class EarlyBootSplashTests(unittest.TestCase):
    def test_media_compiler_preserves_original_sound_and_exact_hashes(self):
        text = (SRC / "prepare.py").read_text(encoding="utf-8")
        self.assertIn("bcab385c001833529cd40b9bb8685e5eb33b7fec12b308d4a3a047965f500769", text)
        self.assertIn("'acodec','pcm_s16le'", text)
        self.assertIn("'ar','48000'", text)
        self.assertIn("'ac','2'", text)
        self.assertIn("FRAMES = 640, 360, 12, 106", text)
        self.assertIn("source SHA-256 mismatch", text)
        self.assertIn("compiled asset mismatch", text)
        self.assertIn("'boot_blocking':False", text)
        self.assertIn("'repeat':False", text)

    def test_lifecycle_requires_real_framebuffer_and_audio_device(self):
        start = (SRC / "ordax-boot-splash").read_text(encoding="utf-8")
        stop = (SRC / "ordax-boot-splash-stop").read_text(encoding="utf-8")
        self.assertIn("[ -c /dev/fb0 ]", start)
        self.assertIn("command -v zstd", start)
        self.assertIn("command -v aplay", start)
        self.assertIn("[ -d /dev/snd ]", start)
        self.assertIn("trap cleanup EXIT", start)
        self.assertIn('AUDIO_PID=$!', start)
        self.assertIn("mkfifo -m 600", start)
        self.assertIn('/bin/busybox timeout -k 1 1', stop)
        self.assertIn('printf stop >"$1"', stop)
        self.assertNotIn("ffplay", start + stop)
        self.assertNotIn("webkit", start.lower() + stop.lower())

    @unittest.skipUnless(shutil.which("cc"), "C compiler unavailable")
    def test_compiled_renderer_checks_raw_stream_and_refuses_fake_fb(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary = str(Path(tmp) / "ordax-fb-splash")
            result = subprocess.run(["cc","-O2","-std=c11","-Wall","-Wextra","-Werror",
                                    str(SRC/"fb_splash.c"),"-o",binary],capture_output=True,text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            valid = subprocess.run([binary,"--verify-stream"],input=b"\x00" * FRAME_BYTES,
                                   capture_output=True,timeout=10)
            self.assertEqual(valid.returncode, 0, valid.stderr.decode(errors="replace"))
            self.assertIn(b"frames=1", valid.stdout)
            truncated = subprocess.run([binary,"--verify-stream"],input=b"\x00" * (FRAME_BYTES-1),
                                       capture_output=True,timeout=10)
            self.assertNotEqual(truncated.returncode, 0)
            missing_fb = subprocess.run([binary,"--framebuffer","/tmp/nonexistent-ordax-fb"],
                                        input=b"",capture_output=True,timeout=10)
            self.assertNotEqual(missing_fb.returncode, 0)

if __name__ == "__main__":
    unittest.main()
