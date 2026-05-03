#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "release requires a git repository." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash changes before releasing." >&2
  git status --short
  exit 1
fi

CURRENT=$(node -p "require('./package.json').version")
SUGGESTED=$(node scripts/suggest-bump.mjs)
NEXT=$(node scripts/next-version.mjs "$CURRENT" "$SUGGESTED")

printf "Current version: %s\n" "$CURRENT"
printf "Suggested bump:  %s\n" "$SUGGESTED"
printf "Next version:    %s\n" "$NEXT"
printf "Choose bump [major/minor/patch] or enter explicit version [%s]: " "$SUGGESTED"
read -r CHOICE

if [ -z "$CHOICE" ]; then
  CHOICE=$SUGGESTED
fi

case "$CHOICE" in
  major|minor|patch)
    VERSION=$(node scripts/next-version.mjs "$CURRENT" "$CHOICE")
    ;;
  v*)
    VERSION=${CHOICE#v}
    ;;
  *)
    VERSION=$CHOICE
    ;;
esac

node scripts/set-version.mjs "$VERSION"
npm run build

git add package.json package-lock.json public/manifest.json
git commit -m "chore(release): v${VERSION}"
git tag "v${VERSION}"

echo "Created release commit and tag v${VERSION}."
echo "Push with: git push && git push origin v${VERSION}"
