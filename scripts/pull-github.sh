#!/usr/bin/env bash
# Pull only the upstream delta, preserving newer unrelated Adaptive source.
# Conflicting local edits abort BEFORE changing the mirror or workspace.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR="${HOME}/.git-mirrors/agent-shelter"
REMOTE="git@github.com:NeuralDEEPnet/agent-shelter.git"
SSH_KEY="${HOME}/.ssh/deploy_agent_shelter"
export GIT_SSH_COMMAND="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

if [ ! -d "$MIRROR/.git" ]; then
  echo "Mirror does not exist yet. Run push-github.sh first."
  exit 1
fi

echo "Fetching latest changes from GitHub..."
git -C "$MIRROR" fetch origin main

UPSTREAM_COMMIT=$(git -C "$MIRROR" rev-parse origin/main)
LOCAL_COMMIT=$(git -C "$MIRROR" rev-parse HEAD)

if [ "$UPSTREAM_COMMIT" = "$LOCAL_COMMIT" ]; then
  echo "Already up to date with GitHub."
  exit 0
fi

echo "Incoming commits from GitHub:"
git -C "$MIRROR" log --oneline HEAD..origin/main

# Never lose a dirty mirror or silently combine divergent histories.
test -z "$(git -C "$MIRROR" status --porcelain)" || { echo "Dirty mirror: reconcile before pulling." >&2; exit 1; }
git -C "$MIRROR" merge-base --is-ancestor "$LOCAL_COMMIT" "$UPSTREAM_COMMIT" || { echo "Divergent mirror: manual reconciliation required." >&2; exit 1; }
mapfile -d '' CHANGED < <(git -C "$MIRROR" diff --no-renames --name-only -z "$LOCAL_COMMIT" "$UPSTREAM_COMMIT")

# The registry manifest was already maintained locally as docs/listings/server.json;
# upstream moves it to the repository root. Preserve that newer local copy across
# the rename rather than letting the upstream's older copy replace it.
LOCAL_MANIFEST_MIGRATION=false
LOCAL_MANIFEST_SNAPSHOT=""
if [ -f "$SRC/docs/listings/server.json" ] &&
   ! git -C "$MIRROR" cat-file -e "$UPSTREAM_COMMIT:docs/listings/server.json" 2>/dev/null &&
   git -C "$MIRROR" cat-file -e "$UPSTREAM_COMMIT:server.json" 2>/dev/null; then
  LOCAL_MANIFEST_MIGRATION=true
  LOCAL_MANIFEST_SNAPSHOT=$(mktemp "/tmp/agent-shelter-server-json-XXXXXX")
  cp "$SRC/docs/listings/server.json" "$LOCAL_MANIFEST_SNAPSHOT"
  trap 'test -z "$LOCAL_MANIFEST_SNAPSHOT" || rm -f -- "$LOCAL_MANIFEST_SNAPSHOT"' EXIT
fi

# Save local source even if the subsequent conflict preflight refuses the import.
BACKUP_PARENT="$HOME/storage/private"
test -d "$BACKUP_PARENT" || { echo "Private backup directory missing." >&2; exit 1; }
BACKUP=$(mktemp "$BACKUP_PARENT/agent-shelter-source-before-pull-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.tar.gz")
tar -C "$SRC" --exclude='./.git' --exclude='node_modules' --exclude='./dist' --exclude='./dist-ssr' \
  --exclude='./generated' --exclude='.env*' --exclude='*.env' --exclude='*.db*' --exclude='*.sqlite*' \
  --exclude='*.log' --exclude='./logs' --exclude='*.key' --exclude='*.pem' -czf "$BACKUP" .
chmod 600 "$BACKUP"
echo "Private recovery archive: $BACKUP"

for path in "${CHANGED[@]}"; do
  # Package vendoring and environment/database files require explicit reconciliation.
  case "$path" in
    /*|../*|*/../*|.git/*|.env*|*/.env*|*.env|*.db*|*.sqlite*|*.key|*.pem|node_modules/*|dist/*|dist-ssr/*|generated/*|packages/*|package.json|package-lock.json|*.log|logs/*)
      echo "Refusing automatic import of protected path: $path" >&2; exit 1 ;;
  esac
  parent=$(dirname "$SRC/$path")
  test "$(realpath -m "$parent")" = "$parent" || { echo "Symlinked parent refused: $path" >&2; exit 1; }
  test ! -L "$SRC/$path" || { echo "Symlinked local file refused: $path" >&2; exit 1; }
  if git -C "$MIRROR" cat-file -e "$UPSTREAM_COMMIT:$path" 2>/dev/null; then
    mode=$(git -C "$MIRROR" ls-tree "$UPSTREAM_COMMIT" -- "$path")
    case "$mode" in 100644*|100755*) ;; *) echo "Non-regular upstream file refused: $path" >&2; exit 1 ;; esac
  fi
  if [ -e "$SRC/$path" ]; then
    test -f "$SRC/$path" || { echo "Local path is not a file: $path" >&2; exit 1; }
    actual=$(git hash-object --no-filters "$SRC/$path")
    base=$(git -C "$MIRROR" rev-parse "$LOCAL_COMMIT:$path" 2>/dev/null || true)
    incoming=$(git -C "$MIRROR" rev-parse "$UPSTREAM_COMMIT:$path" 2>/dev/null || true)
    if [ "$LOCAL_MANIFEST_MIGRATION" = true ] && [ "$path" = "docs/listings/server.json" ]; then
      continue
    fi
    if [ "$actual" != "$base" ] && [ "$actual" != "$incoming" ]; then
      echo "Local/upstream conflict: $path. No files changed; merge manually." >&2; exit 1
    fi
  fi
done

for path in "${CHANGED[@]}"; do
  if git -C "$MIRROR" cat-file -e "$UPSTREAM_COMMIT:$path" 2>/dev/null; then
    mkdir -p "$(dirname "$SRC/$path")"
    git -C "$MIRROR" show "$UPSTREAM_COMMIT:$path" > "$SRC/$path"
    mode=$(git -C "$MIRROR" ls-tree "$UPSTREAM_COMMIT" -- "$path")
    case "$mode" in 100755*) chmod 755 "$SRC/$path" ;; *) chmod 644 "$SRC/$path" ;; esac
  else
    rm -f -- "$SRC/$path"
  fi
done
if [ "$LOCAL_MANIFEST_MIGRATION" = true ]; then
  cp "$LOCAL_MANIFEST_SNAPSHOT" "$SRC/server.json"
  chmod 644 "$SRC/server.json"
fi
git -C "$MIRROR" merge --ff-only "$UPSTREAM_COMMIT"

echo "Successfully imported ${#CHANGED[@]} changed paths; unrelated local source preserved."
echo "Run 'npm run check:types' to verify the incoming code."
