#!/bin/sh
set -eu

images_dir=${1:?Buildroot images directory is required}
: "${TARGET_DIR:?Buildroot TARGET_DIR is required}"

rootfs_tar="$images_dir/rootfs.tar"
if [ ! -f "$rootfs_tar" ] || [ -L "$rootfs_tar" ]; then
  echo "ordax-independent-base: rootfs.tar is missing or unsafe" >&2
  exit 1
fi
if [ ! -d "$TARGET_DIR" ] || [ -L "$TARGET_DIR" ]; then
  echo "ordax-independent-base: TARGET_DIR is missing or unsafe" >&2
  exit 1
fi

# Buildroot's generic tar image is a build-tool artifact and may prefix members
# with './'.  The OrdaX Dev Channel deliberately rejects such non-canonical
# paths.  Re-export the already-built target tree as the product-facing tar:
# canonical relative names only, stable ordering/ownership/mtime, symlinks
# preserved, and no recursive implicit entries.
tmp="$rootfs_tar.ordax.tmp"
rm -f "$tmp"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

(
  cd "$TARGET_DIR"
  LC_ALL=C find . -mindepth 1 -printf '%P\0' \
    | LC_ALL=C sort -z \
    | tar \
        --null \
        --no-recursion \
        --files-from=- \
        --format=gnu \
        --numeric-owner \
        --owner=0 \
        --group=0 \
        --mtime='@0' \
        -cf "$tmp"
)

if [ ! -s "$tmp" ] || [ -L "$tmp" ]; then
  echo "ordax-independent-base: canonical rootfs.tar was not produced" >&2
  exit 1
fi
mv -f "$tmp" "$rootfs_tar"
trap - EXIT HUP INT TERM
