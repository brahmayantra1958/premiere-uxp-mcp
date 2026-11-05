#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
node=$(/usr/bin/plutil -extract executable raw -o - "$PWD/artifacts/install/node.json")
exec "$node" "$PWD/installer/connect.mjs"
