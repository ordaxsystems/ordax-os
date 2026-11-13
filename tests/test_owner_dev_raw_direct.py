"""The Owner Dev RAW entrypoint must delegate to the unique disposable producer."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "tools/creator/owner_dev_raw.py"
spec = importlib.util.spec_from_file_location("owner_dev_raw", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OwnerDevRawTests(unittest.TestCase):
    def test_forwards_exact_inputs_to_canonical_producer(self):
        args = ["owner_dev_raw.py", "--contract", "geometry.json",
                "--stage-root", "staged", "--output-root", "image"]
        with patch("sys.argv", args), patch.object(module.subprocess, "call", return_value=0) as run:
            self.assertEqual(module.main(), 0)
            argv = run.call_args.args[0]
            self.assertEqual(Path(argv[1]), module.ROOT / "tools/creator/proof/disposable_media.py")
            self.assertEqual(argv[-6:], ["--contract", "geometry.json", "--stage-root", "staged",
                                         "--output-root", "image"])

    def test_producer_failure_propagates(self):
        with patch("sys.argv", ["owner_dev_raw.py", "--contract", "a",
                                "--stage-root", "b", "--output-root", "c"]), \
             patch.object(module.subprocess, "call", return_value=1):
            self.assertEqual(module.main(), 1)


if __name__ == "__main__":
    unittest.main()
