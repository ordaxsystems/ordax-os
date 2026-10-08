#!/usr/bin/env python3
"""Render the read-only Store model preview from the single pinned source lock.

This is presentation metadata only, never an activation or download manifest.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "system/services/local-ai/source-lock.json"
DESTINATION = ROOT / "system/services/local-ai/model-candidate.generated.mjs"


def render(lock: dict) -> str:
    if lock.get("$schema") != "prototype-ordax.local-ai-source-lock/1":
        raise ValueError("model preview requires the canonical source lock")
    model, engine, distribution = lock["model"], lock["engine"], lock["distribution"]
    if (
        engine["id"] != "llama.cpp"
        or engine["artifact"]["platform"] != "linux-x86_64"
        or model["id"] != "qwen3.5-0.8b-q4_0"
        or model["format"] != "GGUF"
        or model["quantization"] != "Q4_0"
        or model["license"] != "Apache-2.0"
        or engine["license"] != "MIT"
        or distribution["signed_release_artifact_required"] is not True
    ):
        raise ValueError("model preview requires the reviewed candidate")
    fields = {
        "schema": "ordax.local-ai-model-candidate/1",
        "id": model["id"],
        "title": "Qwen3.5 0.8B · Q4_0",
        "modelFormat": model["format"],
        "quantization": model["quantization"],
        "engine": engine["id"],
        "artifactPlatform": engine["artifact"]["platform"],
        "modelBytes": model["size_bytes"],
        "engineBytes": engine["artifact"]["size_bytes"],
        "modelSha256": model["sha256"],
        "engineSha256": engine["artifact"]["sha256"],
        "license": model["license"],
        "engineLicense": engine["license"],
        "modelRevision": model["upstream_revision"],
        "releaseMode": "signed-system-release",
        "memoryMinimumBytes": None,
        "memoryRecommendedBytes": None,
        "benchmarkQualified": False,
        "independentInstallAvailable": False,
        "independentUpdateAvailable": False,
    }
    for field in ("modelBytes", "engineBytes"):
        if type(fields[field]) is not int or fields[field] <= 0:
            raise ValueError("invalid pinned artifact size")
    return (
        "// GENERATED FROM system/services/local-ai/source-lock.json. DO NOT EDIT.\n"
        "// Run: python tools/local-ai-model-catalog/render.py\n"
        "export const BUNDLED_LOCAL_AI_MODEL_CANDIDATE = Object.freeze(\n"
        + json.dumps(fields, ensure_ascii=False, sort_keys=True, indent=2)
        + "\n);\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render(json.loads(SOURCE.read_text(encoding="utf-8")))
    if args.check:
        if not DESTINATION.is_file() or DESTINATION.read_text(encoding="utf-8") != expected:
            raise SystemExit("Local AI model Store preview drifted from pinned source lock")
    else:
        DESTINATION.write_text(expected, encoding="utf-8")


if __name__ == "__main__":
    main()
