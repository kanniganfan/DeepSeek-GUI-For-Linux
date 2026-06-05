#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# release.sh — macOS GitHub Release wrapper
#
# Default behavior builds macOS artifacts and creates a draft GitHub release
# with the next version tag. Use --all to build macOS, Windows, and Linux on
# macOS, then upload/publish the combined release from this machine.
#
#   bash ./scripts/release-mac.sh              # or bash ./scripts/release.sh
#   bash ./scripts/release.sh --all --r2 --publish
#
# =============================================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--all" ]]; then
  shift
  exec bash "${ROOT}/scripts/release-all-mac.sh" "$@"
fi

exec "${ROOT}/scripts/release-mac.sh" "$@"
