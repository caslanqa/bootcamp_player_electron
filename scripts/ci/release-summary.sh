#!/usr/bin/env bash
# Render the release into the workflow run's summary page.
set -uo pipefail

readonly OUT="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
readonly DIR="${INSTALLER_DIR:-installers}"

VERSION="${VERSION:-unknown}"
REPO="${REPO:-}"

human_size() {
  # Portable-ish: du reports KB blocks on both macOS and Linux with -k.
  local kb
  kb="$(du -k "$1" 2>/dev/null | cut -f1)"
  [ -z "$kb" ] && { echo "-"; return; }
  awk "BEGIN { printf \"%.0f MB\", $kb / 1024 }"
}

{
  echo "# 🚀 Bootcamp Player ${VERSION}"
  echo ""

  if [ -n "$REPO" ]; then
    echo "**Release:** https://github.com/${REPO}/releases/tag/${VERSION}"
    echo ""
  fi

  if [ ! -d "$DIR" ]; then
    echo "> ⚠️ No \`$DIR\` directory — nothing was uploaded."
  else
    echo "### 📦 Assets"
    echo ""
    echo "| File | Size |"
    echo "|------|------|"
    found=0
    for file in "$DIR"/*; do
      [ -f "$file" ] || continue
      found=1
      echo "| \`$(basename "$file")\` | $(human_size "$file") |"
    done
    [ "$found" = 0 ] && echo "| _none_ | - |"
    echo ""
    echo "Installers are unsigned — see **Installing** in the README for the"
    echo "one-time Gatekeeper / SmartScreen step on each platform."
  fi
} >>"$OUT"
