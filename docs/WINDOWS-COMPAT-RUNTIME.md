# OrdaX Windows Compatibility Runtime

Status: **OWNER/DEVELOPMENT BUILD FOUNDATION — NOT EXECUTABLE**

This document defines the first concrete runtime candidate behind the application-compatibility contracts. It does not authorize Windows application installation or execution.

## Runtime choice

The initial candidate is Wine 11.0 stable, built for an x86_64 Linux host with the new WoW64 architecture and PE targets for both i386 and x86_64.

The upstream source is pinned by exact URL, size and SHA-256 in `bootstrap/windows-compat-runtime/source.json`. The build does not consume an unpinned distribution `wine` package and does not install Wine into the Stable Base.

The runtime reuses the canonical Alpine 3.22.5 source identity owned by `bootstrap/stable-base/source.json`, but it is a separate optional artifact. Compatibility failure must not affect boot, Recovery or Surface availability.

## Security boundary

The first runtime is deliberately narrower than generic desktop Wine. Integrations that would create additional host/device authority stay disabled until OrdaX owns explicit grants and adapters for them.

Disabled in the initial build policy:

- raw USB passthrough;
- packet capture;
- digital camera passthrough;
- scanner passthrough;
- printing passthrough;
- Video4Linux capture;
- direct Wayland driver path;
- PulseAudio path;
- DBus dynamic-device integration;
- OpenCL;
- Kerberos/GSSAPI/LDAP/Samba NetAPI integrations.

The initial graphical path is Wine X11 -> OrdaX XWayland. Audio targets ALSA. TLS uses GnuTLS. GStreamer is retained for media support. Vulkan and OpenGL dependencies are included for later graphics validation, but this source/build foundation does not grant GPU/device authority by itself.

## Dependency locking

Dependency discovery is intentionally separated from build authority.

`bootstrap/windows-compat-runtime/discover_lock.py`:

1. validates the non-executable source contract;
2. verifies the exact Wine source bytes;
3. reuses the pinned Alpine 3.22.5 minirootfs identity;
4. resolves the complete transitive APK closure for build dependencies;
5. resolves a separate complete transitive APK closure for runtime dependencies;
6. emits review-only evidence.

The discovery output is not automatically trusted. It must be reviewed and then committed back into the source contract before a builder is allowed to consume exact package versions.

This prevents a future build from silently picking newer packages because an Alpine repository changed.

## Current gates

Current state:

```text
WINE_SOURCE_PINNED=YES
WINE_SOURCE_BYTES_CI_VERIFICATION=IN_PROGRESS
ALPINE_IDENTITY_PINNED=YES
APK_BUILD_LOCK_PINNED=NO
APK_RUNTIME_LOCK_PINNED=NO
WINE_COMPILED=NO
WINE_RUNTIME_ARTIFACT=NO
WINDOWS_EXECUTION_ADAPTER=NO
WINDOWS_INSTALLATION_ADAPTER=NO
STABLE_MVP_ENABLED=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```

The next transition is permitted only after lock-discovery evidence is green and the exact closures are reviewed.

## Planned build path

After the locks are committed, the builder will:

```text
pinned Alpine rootfs
 + exact build package closure
 + exact Wine 11.0 source bytes
 + MinGW i386/x86_64 PE cross compilers
 -> configure --enable-archs=i386,x86_64
 -> build
 -> clean runtime rootfs with exact runtime package closure
 -> install Wine under /opt/ordax/windows-compat/wine
 -> verify required loaders/drivers/DLL trees
 -> normalize tree
 -> deterministic EROFS candidate
 -> provenance + tree manifest
```

The artifact remains Owner/Development-only until runtime sandboxing, profile materialization, launch authorization and application-level proofs exist.
