#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_URL="${KOINOS_INTEGRATION_TESTS_REPO:-https://github.com/koinos/koinos-integration-tests.git}"
REF="${KOINOS_INTEGRATION_TESTS_REF:-74b64d739a98045630cb61557e1f141c04cd1eb1}"
DEST="${KOINOS_INTEGRATION_TESTS_DIR:-/private/tmp/knodel-koinos-integration-tests}"

usage() {
  cat <<EOF
usage: scripts/fetch-koinos-integration-tests.sh

Fetches the upstream koinos/koinos-integration-tests repository at a pinned ref.

Environment:
  KOINOS_INTEGRATION_TESTS_REPO  Git repository URL
                                 default: $REPO_URL
  KOINOS_INTEGRATION_TESTS_REF   Branch, tag, or commit to checkout
                                 default: $REF
  KOINOS_INTEGRATION_TESTS_DIR   Destination directory
                                 default: $DEST
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

case "$DEST" in
  ""|"/"|"/tmp"|"/private/tmp") echo "error: refusing unsafe destination: $DEST" >&2; exit 2 ;;
esac

mkdir -p "$(dirname "$DEST")"

if [[ -d "$DEST/.git" ]]; then
  git -C "$DEST" remote set-url origin "$REPO_URL"
else
  if [[ -e "$DEST" ]]; then
    echo "error: destination exists but is not a git checkout: $DEST" >&2
    exit 2
  fi
  git clone --no-checkout "$REPO_URL" "$DEST"
fi

git -C "$DEST" fetch --depth 1 origin "$REF"
git -C "$DEST" checkout --detach FETCH_HEAD

COMMIT="$(git -C "$DEST" rev-parse HEAD)"
PIN_FILE="$DEST/.knodel-pin"
{
  echo "repo=$REPO_URL"
  echo "ref=$REF"
  echo "commit=$COMMIT"
  echo "fetched_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "root=$ROOT_DIR"
} > "$PIN_FILE"

echo "koinos-integration-tests=$DEST"
echo "commit=$COMMIT"
echo "pin_file=$PIN_FILE"
