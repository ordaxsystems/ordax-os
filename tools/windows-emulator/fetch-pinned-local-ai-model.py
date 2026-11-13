#!/usr/bin/env python3
"""Windows-only adapter that reuses the canonical OS GGUF downloader."""
import argparse
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILDER_PATH = ROOT / "bootstrap" / "local-ai-runtime" / "build.py"


def load_builder():
    spec = importlib.util.spec_from_file_location("ordax_local_ai_runtime_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("canonical local AI builder cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fetch(cache_dir):
    builder = load_builder()
    lock = builder.load_source_lock()
    model = lock["model"]
    cache = Path(cache_dir).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    path = builder.download_exact(
        builder.model_url(lock),
        cache / model["filename"],
        model["sha256"],
        model["size_bytes"],
    )
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    path = fetch(args.cache_dir)
    print(f"WINDOWS_AURA_MODEL_VERIFIED={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
