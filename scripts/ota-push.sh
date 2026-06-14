#!/usr/bin/env bash
# Helper to push these JS-only fixes over EAS Update (OTA) to the preview channel.
# Usage:
#   bash scripts/ota-push.sh check      # show eas-cli version + logged-in account
#   bash scripts/ota-push.sh publish    # publish an update to branch "preview"
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-check}" in
  check)
    echo "=== eas-cli version ==="
    npx eas-cli --version
    echo "=== logged-in account ==="
    npx eas-cli whoami
    ;;
  publish)
    npx eas-cli update \
      --branch preview \
      --environment preview \
      --message "fixes (scrollbar/rewind/re-center/mastery dropdown/sequential-loop) + in-app update check (startup auto-check + Settings > 应用更新)"
    ;;
  *)
    echo "unknown command: ${1:-}" >&2
    exit 2
    ;;
esac
