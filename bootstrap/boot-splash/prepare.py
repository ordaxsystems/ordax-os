#!/usr/bin/env python3
"""Build-time OrdaX early-boot media compiler. Runtime has no video decoder."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ORIGINAL_SHA = 'bcab385c001833529cd40b9bb8685e5eb33b7fec12b308d4a3a047965f500769'
WIDTH, HEIGHT, FPS, FRAMES = 640, 360, 12, 106
EXPECTED = {
    'frames.rgb565.zst': '82103c596add28d2945b172c418e4e9d03c1e4b6e3600a4f1b1a76be931bdb38',
    'boot-audio.wav': '78c35e843facdf25033d207acd82f6ba4354cdd75763bca48494a86c36e9b1f0',
}

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1 << 20), b''):
            h.update(data)
    return h.hexdigest()

def run(args):
    subprocess.run(args, check=True, timeout=120)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--original', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if digest(args.original) != ORIGINAL_SHA:
        raise SystemExit('boot media source SHA-256 mismatch')
    args.output.mkdir(parents=True, exist_ok=True)
    raw = args.output / 'frames.rgb565'
    if not args.verify_only:
        run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(args.original),'-an',
             '-vf',f'fps={FPS},scale={WIDTH}:{HEIGHT}:flags=lanczos,format=rgb565le',
             '-pix_fmt','rgb565le','-f','rawvideo',str(raw)])
        if raw.stat().st_size != WIDTH*HEIGHT*2*FRAMES:
            raise SystemExit('unexpected frame count or frame size')
        run(['zstd','-T1','-q','-f','-8',str(raw),'-o',str(args.output/'frames.rgb565.zst')])
        run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(args.original),
             '-vn','-acodec','pcm_s16le','-ar','48000','-ac','2',str(args.output/'boot-audio.wav')])
        raw.unlink()
    for name, expected in EXPECTED.items():
        if digest(args.output / name) != expected:
            raise SystemExit(f'compiled asset mismatch: {name}; pin toolchain before release')
    manifest = {
        '$schema':'ordax.boot-splash-assets/1',
        'source_sha256': ORIGINAL_SHA, 'frame_width':WIDTH, 'frame_height':HEIGHT,
        'fps':FPS, 'frames':FRAMES,'video_encoding':'zstd-raw-rgb565le',
        'audio_encoding':'pcm-s16le-wav','audio_channels':2,'audio_hz':48000,
        'media_sha256':EXPECTED,'stage':'pre-surface-development-base',
        'repeat':False, 'boot_blocking':False,
    }
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
    print('ORDAX_BOOT_MEDIA=VERIFIED',json.dumps(EXPECTED,sort_keys=True))

if __name__=='__main__': main()
