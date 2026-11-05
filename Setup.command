#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec /bin/bash installer/bootstrap-macos.sh "$@"
