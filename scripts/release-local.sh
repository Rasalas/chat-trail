#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

VERSION=${VERSION:-$(node -p "require('./package.json').version")}
OUT_DIR="releases"
ZIP_NAME="chat-trail-chrome-v${VERSION}.zip"
ZIP_PATH="${OUT_DIR}/${ZIP_NAME}"

rm -rf dist/chrome
npm run build
mkdir -p "$OUT_DIR"rm -f "$ZIP_PATH"

if command -v zip >/dev/null 2>&1; then
  (cd dist/chrome && zip -qr "../../${ZIP_PATH}" . -x '*.map' -x '*.DS_Store')
else
  echo "zip command not found. Install zip or run on macOS/Linux with zip available." >&2
  exit 1
fi

echo "$ZIP_PATH"
