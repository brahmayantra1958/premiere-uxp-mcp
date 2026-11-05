#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
[ "$(uname -s)" = Darwin ] || { echo 'This installer requires macOS.' >&2; exit 1; }
version=24.21.0
case "$(uname -m)" in
  arm64) arch=arm64; checksum=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 ;;
  x86_64) arch=x64; checksum=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 ;;
  *) echo 'Unsupported Mac architecture.' >&2; exit 1 ;;
esac
directory="$PWD/artifacts/tools/node"
archive="$directory/node-v$version-darwin-$arch.tar.gz"
mkdir -p -- "$directory"
verify() { [ "$(shasum -a 256 "$1" | awk '{print $1}')" = "$checksum" ]; }
if [ ! -f "$archive" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$version/node-v$version-darwin-$arch.tar.gz" -o "$archive.download"
  verify "$archive.download" || { echo 'Node archive checksum mismatch' >&2; exit 1; }
  mv -- "$archive.download" "$archive"
fi
verify "$archive" || { echo 'Node archive checksum mismatch' >&2; exit 1; }
node="$directory/node-v$version-darwin-$arch/bin/node"
if [ ! -x "$node" ]; then tar -xzf "$archive" -C "$directory"; fi
exec "$node" installer/install.mjs "$@"
