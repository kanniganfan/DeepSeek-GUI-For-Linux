#!/bin/bash
set -euo pipefail

# macOS all-platform release: build macOS dmg/zip, Windows NSIS, Linux AppImage,
# create a GitHub draft release, upload all assets, and optionally publish/R2-promote.
#
# Usage:
#   bash ./scripts/release-all-mac.sh
#   bash ./scripts/release-all-mac.sh --r2
#   bash ./scripts/release-all-mac.sh --stable --r2 --publish
#   bash ./scripts/release-all-mac.sh --tag v0.1.3 --frontier --r2-upload-only
#   bash ./scripts/release.sh --all --r2 --publish
#
# Release notes default: summarize conventional commits since the previous tag.
#   --notes "..."        custom text only
#   --notes-file path    markdown file
#   --no-commit-notes    generic build info only
#
# Platform switches:
#   --skip-mac           skip macOS assets
#   --skip-win           skip Windows assets
#   --skip-linux         skip Linux assets
#
# Speed knobs:
#   MAC_RELEASE_PARALLEL=force      force parallel arm64/x64 builds even when signing
#   RELEASE_UPLOAD_CONCURRENCY=4    GitHub/R2 upload concurrency
#   DEEPSEEK_GUI_RUNTIME_CACHE=0    disable bundled runtime cache

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

print_help() {
  awk 'NR > 3 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_help
  exit 0
fi

# shellcheck source=lib/release-common.sh
source "${ROOT}/scripts/lib/release-common.sh"
release_load_local_env

PUBLISH=false
CUSTOM_NOTES=""
NOTES_FILE=""
RELEASE_NOTES_FROM_COMMITS=1
RELEASE_TAG=""
P12_PATH="${P12_PATH:-${CSC_LINK:-}}"
P12_PASSWORD="${P12_PASSWORD:-${CSC_KEY_PASSWORD:-}}"
P8_PATH="${P8_PATH:-${APPLE_API_KEY:-}}"
KEY_ID="${KEY_ID:-${APPLE_API_KEY_ID:-}}"
ISSUER="${ISSUER:-${APPLE_API_ISSUER:-}}"
RELEASE_CHANNEL="${RELEASE_CHANNEL:-frontier}"
R2_UPLOAD="${R2_UPLOAD:-false}"
R2_PROMOTE="${R2_PROMOTE:-false}"
RELEASE_UPLOAD_CONCURRENCY="${RELEASE_UPLOAD_CONCURRENCY:-4}"
MAC_RELEASE_PARALLEL="${MAC_RELEASE_PARALLEL:-1}"
INCLUDE_MAC=true
INCLUDE_WIN=true
INCLUDE_LINUX=true
APP_BUILT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=true; shift ;;
    --r2) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --r2-upload-only) R2_UPLOAD=true; R2_PROMOTE=false; shift ;;
    --r2-promote) R2_UPLOAD=true; R2_PROMOTE=true; shift ;;
    --tag) RELEASE_TAG="$2"; shift 2 ;;
    --channel) RELEASE_CHANNEL="$2"; shift 2 ;;
    --stable) RELEASE_CHANNEL=stable; shift ;;
    --frontier) RELEASE_CHANNEL=frontier; shift ;;
    --skip-mac) INCLUDE_MAC=false; shift ;;
    --skip-win) INCLUDE_WIN=false; shift ;;
    --skip-linux) INCLUDE_LINUX=false; shift ;;
    --p12) P12_PATH="$2"; shift 2 ;;
    --p12-password) P12_PASSWORD="$2"; shift 2 ;;
    --p8) P8_PATH="$2"; shift 2 ;;
    --key-id) KEY_ID="$2"; shift 2 ;;
    --issuer) ISSUER="$2"; shift 2 ;;
    --notes) CUSTOM_NOTES="$2"; shift 2 ;;
    --notes-file) NOTES_FILE="$2"; shift 2 ;;
    --no-commit-notes) RELEASE_NOTES_FROM_COMMITS=0; shift ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *) die "Unknown flag: $1" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "release-all-mac.sh must run on macOS."
$INCLUDE_MAC || $INCLUDE_WIN || $INCLUDE_LINUX || die "At least one platform must be enabled."

ensure_app_built() {
  if [[ "${APP_BUILT}" == "true" ]]; then
    return
  fi
  cyan "Building renderer/main once..."
  npm run build || die "electron-vite build failed"
  APP_BUILT=true
}

build_mac_arch() {
  local arch="$1"
  local output_dir="$2"
  local log_file="$3"

  mkdir -p "${output_dir}" "$(dirname "${log_file}")"
  cyan "  ${arch}: building dmg + zip -> ${output_dir}"
  DEEPSEEK_GUI_DIST_DIR="${output_dir}" \
    npx --yes electron-builder@26.8.1 --config electron-builder.config.cjs --publish never --mac dmg "--${arch}" \
    >"${log_file}" 2>&1
  DEEPSEEK_GUI_DIST_DIR="${output_dir}" \
    node "${ROOT}/scripts/zip-mac-app.cjs" "${arch}" \
    >>"${log_file}" 2>&1
}

copy_mac_arch_artifacts() {
  local arch="$1"
  local output_dir="$2"
  local files=()

  shopt -s nullglob
  files=("${output_dir}"/DeepSeek-GUI-*-mac-"${arch}".*)
  shopt -u nullglob

  [[ ${#files[@]} -gt 0 ]] || die "No macOS ${arch} artifacts found in ${output_dir}"
  cp -p "${files[@]}" "${ROOT}/dist/"
}

build_macos_parallel() {
  local build_root="${ROOT}/dist/.mac-build"
  local arm64_output="${build_root}/arm64"
  local x64_output="${build_root}/x64"
  local arm64_log="${build_root}/arm64.log"
  local x64_log="${build_root}/x64.log"
  local arm64_pid
  local x64_pid
  local failures=0

  rm -rf "${build_root}"
  mkdir -p "${ROOT}/dist" "${build_root}"

  ensure_app_built

  cyan "Preparing electron-builder..."
  npx --yes electron-builder@26.8.1 --version >/dev/null \
    || die "Failed to prepare electron-builder"

  cyan "Building macOS arm64 and x64 in parallel..."
  build_mac_arch arm64 "${arm64_output}" "${arm64_log}" &
  arm64_pid=$!
  build_mac_arch x64 "${x64_output}" "${x64_log}" &
  x64_pid=$!

  if wait "${arm64_pid}"; then
    green "  ✓ arm64 build complete"
  else
    red "  ✗ arm64 build failed; last log lines:"
    tail -n 120 "${arm64_log}" >&2 || true
    failures=1
  fi

  if wait "${x64_pid}"; then
    green "  ✓ x64 build complete"
  else
    red "  ✗ x64 build failed; last log lines:"
    tail -n 120 "${x64_log}" >&2 || true
    failures=1
  fi

  [[ "${failures}" -eq 0 ]] || die "macOS parallel build failed"

  copy_mac_arch_artifacts arm64 "${arm64_output}"
  copy_mac_arch_artifacts x64 "${x64_output}"
  node "${ROOT}/scripts/generate-mac-latest.cjs" "${ROOT}/dist" \
    || die "Failed to generate merged latest-mac.yml"
}

build_macos() {
  if [[ "${INCLUDE_MAC}" != "true" ]]; then
    return
  fi

  if $SIGNING && [[ "${MAC_RELEASE_PARALLEL}" != "force" ]]; then
    cyan "Building macOS serially because Developer ID signing is enabled."
    npm run dist:mac || die "macOS build failed"
    APP_BUILT=true
    return
  fi

  if [[ "${MAC_RELEASE_PARALLEL}" == "0" ]]; then
    cyan "Building macOS serially (MAC_RELEASE_PARALLEL=0)..."
    npm run dist:mac || die "macOS build failed"
    APP_BUILT=true
    return
  fi

  build_macos_parallel
}

build_windows() {
  if [[ "${INCLUDE_WIN}" != "true" ]]; then
    return
  fi

  ensure_app_built
  cyan "Building Windows x64 NSIS installer from macOS..."
  npx --yes electron-builder@26.8.1 --config electron-builder.config.cjs --publish never --win nsis --x64 \
    || die "Windows build failed"
}

build_linux() {
  if [[ "${INCLUDE_LINUX}" != "true" ]]; then
    return
  fi

  ensure_app_built
  cyan "Building Linux x64 AppImage from macOS..."
  npx --yes electron-builder@26.8.1 --config electron-builder.config.cjs --publish never --linux AppImage --x64 \
    || die "Linux build failed"
}

collect() {
  local label="$1"
  shift
  local matched=()
  local pattern file

  shopt -s nullglob
  for pattern in "$@"; do
    for file in ${pattern}; do
      [[ -f "${file}" ]] || continue
      matched+=("${file}")
    done
  done
  shopt -u nullglob

  if [[ ${#matched[@]} -eq 0 ]]; then
    red "  ✗ ${label}"
    die "Missing asset: ${label}"
  fi

  for file in "${matched[@]}"; do
    ASSETS+=("${file}")
    green "  ✓ ${label}: ${file}"
  done
}

collect_optional() {
  local label="$1"
  shift
  local matched=()
  local pattern file

  shopt -s nullglob
  for pattern in "$@"; do
    for file in ${pattern}; do
      [[ -f "${file}" ]] || continue
      matched+=("${file}")
    done
  done
  shopt -u nullglob

  if [[ ${#matched[@]} -eq 0 ]]; then
    yellow "  • ${label}: none"
    return
  fi

  for file in "${matched[@]}"; do
    ASSETS+=("${file}")
    green "  ✓ ${label}: ${file}"
  done
}

require_file() {
  local label="$1"
  local path="$2"
  [[ -f "${path}" ]] || die "Missing ${label}: ${path}"
  green "  ✓ ${label}: ${path}"
}

upload_github_assets() {
  local tag="$1"
  shift
  local concurrency="${RELEASE_UPLOAD_CONCURRENCY}"
  local failures=0
  local pids=()
  local files=()

  if ! [[ "${concurrency}" =~ ^[1-9][0-9]*$ ]]; then
    concurrency=4
  fi

  for asset in "$@"; do
    green "  ↑ $(basename "${asset}")"
    gh release upload "${tag}" "${asset}" --clobber &
    pids+=("$!")
    files+=("${asset}")

    if [[ ${#pids[@]} -ge ${concurrency} ]]; then
      if wait "${pids[0]}"; then
        green "  ✓ $(basename "${files[0]}")"
      else
        red "  ✗ $(basename "${files[0]}")"
        failures=1
      fi
      pids=("${pids[@]:1}")
      files=("${files[@]:1}")
    fi
  done

  for i in "${!pids[@]}"; do
    if wait "${pids[$i]}"; then
      green "  ✓ $(basename "${files[$i]}")"
    else
      red "  ✗ $(basename "${files[$i]}")"
      failures=1
    fi
  done

  [[ "${failures}" -eq 0 ]] || die "One or more GitHub release uploads failed."
}

release_check_prerequisites
release_apply_signing_env
release_acquire_lock

cyan "Computing release version..."
if [[ -n "${RELEASE_TAG}" ]]; then
  RELEASE_BUMP=none
fi
release_compute_version

cyan "  Base:    ${BASE_VERSION}"
cyan "  Latest:  ${LATEST_TAG:-<none>}"
cyan "  Next:    ${RELEASE_VERSION}  (tag: ${TAG_NAME})"
release_export_update_channel
release_export_app_version

release_ensure_tag_available
release_prepare_builder_cache
release_clean_dist_artifacts

cyan "Building selected platforms on macOS..."
build_macos
build_windows
build_linux

release_write_meta_file

ASSETS=()
R2_PLATFORMS=()

if [[ "${INCLUDE_MAC}" == "true" ]]; then
  collect "macOS arm64 dmg" "dist/DeepSeek-GUI-*-mac-arm64.dmg"
  collect "macOS x64 dmg" "dist/DeepSeek-GUI-*-mac-x64.dmg"
  collect "macOS arm64 zip" "dist/DeepSeek-GUI-*-mac-arm64.zip"
  collect "macOS x64 zip" "dist/DeepSeek-GUI-*-mac-x64.zip"
  collect_optional "macOS blockmap" "dist/DeepSeek-GUI-*-mac-*.blockmap"
  require_file "macOS update metadata" "dist/latest-mac.yml"
  R2_PLATFORMS+=(mac)
fi

if [[ "${INCLUDE_WIN}" == "true" ]]; then
  collect "Windows exe" "dist/DeepSeek-GUI-*-win-*.exe"
  collect "Windows blockmap" "dist/DeepSeek-GUI-*-win-*.exe.blockmap"
  require_file "Windows update metadata" "dist/latest.yml"
  R2_PLATFORMS+=(win)
fi

if [[ "${INCLUDE_LINUX}" == "true" ]]; then
  collect "Linux AppImage" "dist/DeepSeek-GUI-*-linux-x86_64.AppImage"
  collect_optional "Linux blockmap" "dist/DeepSeek-GUI-*-linux-x86_64.AppImage.blockmap"
  require_file "Linux update metadata" "dist/latest-linux.yml"
  R2_PLATFORMS+=(linux)
fi

NOTES_TMP=$(mktemp "${TMPDIR:-/tmp}/release-notes.XXXXXX")
UNSIGNED_NOTE=""
if [[ "${INCLUDE_MAC}" == "true" ]] && ! $SIGNING; then
  UNSIGNED_NOTE=$(
    cat <<'EOF'

### ⚠️ macOS: Unsigned Build

This is an unsigned build. macOS Gatekeeper will block first launch.
Run this after downloading:

```sh
xattr -cr "DeepSeek GUI.app"
# or
npm run mac:unquarantine
```
EOF
  )
fi

RELEASE_PLATFORMS_NOTE="macOS (arm64 + Intel x64) · Windows x64 · Linux AppImage x64"
export RELEASE_PLATFORMS_NOTE
release_write_notes_file "${NOTES_TMP}"
echo "${UNSIGNED_NOTE}" >>"${NOTES_TMP}"

cyan "Creating GitHub release ${TAG_NAME}..."
GITHUB_RELEASE_FLAGS=(--draft)
if [[ "${RELEASE_CHANNEL}" == "frontier" ]]; then
  GITHUB_RELEASE_FLAGS+=(--prerelease)
fi
gh release create "${TAG_NAME}" \
  --title "${RELEASE_NAME}" \
  --notes-file "${NOTES_TMP}" \
  --target "$(release_git branch --show-current)" \
  "${GITHUB_RELEASE_FLAGS[@]}" \
  || die "gh release create failed"

cyan "Uploading ${#ASSETS[@]} asset(s) to GitHub (concurrency ${RELEASE_UPLOAD_CONCURRENCY})..."
upload_github_assets "${TAG_NAME}" "${ASSETS[@]}"

if [[ "${R2_UPLOAD}" == "true" ]]; then
  for platform in "${R2_PLATFORMS[@]}"; do
    cyan "Uploading ${platform} asset metadata to R2 (${TAG_NAME})..."
    node "${ROOT}/scripts/publish-r2.mjs" upload --platform "${platform}" --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
      || die "R2 upload failed for ${platform} assets"
  done
fi

if [[ "${R2_PROMOTE}" == "true" ]]; then
  cyan "Promoting ${TAG_NAME} as R2 latest..."
  node "${ROOT}/scripts/publish-r2.mjs" promote --tag "${TAG_NAME}" --channel "${RELEASE_CHANNEL}" \
    || die "R2 promote failed"
fi

if $PUBLISH; then
  cyan "Publishing release ${TAG_NAME}..."
  gh release edit "${TAG_NAME}" --draft=false \
    || die "gh release edit --draft=false failed"
  verify_release_state "${#ASSETS[@]}" false "published"
  FINAL_RELEASE_STATE="published"
else
  verify_release_state "${#ASSETS[@]}" true "draft"
  FINAL_RELEASE_STATE="draft"
fi

rm -f "${NOTES_TMP}"

echo
green "All-platform release ${TAG_NAME} ready (${FINAL_RELEASE_STATE})."
cyan "  Meta: dist/.release-meta.env"
cyan "  Channel: ${RELEASE_CHANNEL}"
cyan "  Platforms: ${R2_PLATFORMS[*]}"
cyan "  GitHub: https://github.com/XingYu-Zhong/DeepSeek-GUI/releases/tag/${TAG_NAME}"
