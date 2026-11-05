#!/usr/bin/env bash
# Rebuild the municipal boundary layers in public/data/geo from the 国土数値情報 N03 zips.
#
#   bash pipeline/build_geometry.sh            # download (cached in data/raw/n03), rebuild everything, check codes
#   bash pipeline/build_geometry.sh --only 07  # rebuild one prefecture only
#
# Needs `npm ci` once (mapshaper is a devDependency) and python3 (standard library only).
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 -m pipeline.build_geometry "$@"
