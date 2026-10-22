#!/usr/bin/env python3
"""Exercise native media decoding without opening speakers, mic or camera."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


REQUIRED_ELEMENTS = (
    "alsasink", "playbin", "qtdemux", "matroskademux", "mpg123audiodec",
    "wavparse", "flacdec", "avdec_h264", "vp8dec", "vp9dec", "pngdec", "jpegdec",
)

# Encode a small deterministic fixture, then decode the actual container bytes.
# A fakesink verifies decoding; it deliberately makes no claim of physical sound.
FIXTURES = {
    "wav": (
        "audiotestsrc num-buffers=4 ! audioconvert ! wavenc",
        "wavparse ! audioconvert",
    ),
    "webm": (
        "videotestsrc num-buffers=4 ! video/x-raw,width=32,height=32 ! vp8enc ! webmmux",
        "matroskademux ! vp8dec",
    ),
    "mp4": (
        "videotestsrc num-buffers=4 ! video/x-raw,format=I420,width=32,height=32 ! openh264enc ! h264parse ! mp4mux",
        "qtdemux ! h264parse ! avdec_h264",
    ),
    "png": (
        "videotestsrc num-buffers=1 ! video/x-raw,format=RGB,width=32,height=32 ! pngenc",
        "pngdec",
    ),
    "jpeg": (
        "videotestsrc num-buffers=1 ! video/x-raw,width=32,height=32 ! jpegenc",
        "jpegdec",
    ),
}


def probe() -> dict:
    results = []
    with tempfile.TemporaryDirectory(prefix="ordax-media-") as directory:
        env = dict(os.environ, GST_REGISTRY=str(Path(directory) / "registry.bin"))

        def run(label: str, args: list[str]) -> None:
            try:
                completed = subprocess.run(
                    args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                    timeout=20, check=False, env=env,
                )
                ok = completed.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                ok = False
            results.append({"check": label, "passed": ok})

        for element in REQUIRED_ELEMENTS:
            run(f"element:{element}", ["gst-inspect-1.0", element])
        for extension, (encoder, decoder) in FIXTURES.items():
            filename = str(Path(directory) / f"sample.{extension}")
            run(f"encode:{extension}", [
                "gst-launch-1.0", "-q", *encoder.split(), "!", "filesink", f"location={filename}",
            ])
            run(f"decode:{extension}", [
                "gst-launch-1.0", "-q", "filesrc", f"location={filename}", "!",
                *decoder.split(), "!", "fakesink", "sync=false",
            ])
    return {
        "schema": "ordax.media-runtime-probe/1",
        "passed": all(item["passed"] for item in results),
        "checks": results,
        "physicalPlaybackProven": False,
        "captureActivated": False,
    }


if __name__ == "__main__":
    result = probe()
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result["passed"] else 1)
