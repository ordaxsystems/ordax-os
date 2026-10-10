# Binary media slot — Developer Base boot splash

This folder is reserved exclusively for two *byte-verified* source-controlled assets:

- `frames.rgb565.zst` — 1280x720 RGB565, 24fps, 212 frames; SHA-256 `691247dc90a44ffcbeb6c3ae953f756b74f2fff5f0cd3e84f98de36c5747f2ab`.
- `boot-audio.wav` — original user-provided soundtrack decoded to PCM, 48000Hz stereo; SHA-256 `78c35e843facdf25033d207acd82f6ba4354cdd75763bca48494a86c36e9b1f0`.

The Developer Base builder rejects missing, symlinked, mismatched or oversized assets. These files are **not** present in this draft PR yet. They must be uploaded here before CI promotion. Do not upload the source MP4 or ZIP here; the runtime has no MP4 decoder. Do not use remote runtime downloads or embed binary data as text.
