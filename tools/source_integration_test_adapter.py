"""Import the single OS-owned source-advance tool from its canonical path."""
import importlib.util
from pathlib import Path


def advance_module():
    path = Path(__file__).resolve().parent / "source-integration" / "advance.py"
    spec = importlib.util.spec_from_file_location("ordax_source_advance", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("canonical source-advance tool missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
