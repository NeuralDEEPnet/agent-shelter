#!/usr/bin/env bash
# Pull updates from GitHub into agent-shelter safely.
# Preserves local .env files, SQLite databases, and local credentials.
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

# Pull into mirror
git -C "$MIRROR" merge --ff-only origin/main

# Sync updated source into working directory
tar -C "$MIRROR" \
  --exclude="./.git" \
  --exclude="node_modules" --exclude="./dist" --exclude="./dist-ssr" --exclude="./packages" \
  --exclude=".env" --exclude=".env.*" --exclude="*.env" \
  --exclude="*.db" --exclude="*.db-shm" --exclude="*.db-wal" \
  --exclude="*.log" --exclude="./logs" \
  -cf - . | tar -C "$SRC" -xf -

echo "Successfully synchronized external changes into agent-shelter!"
echo "Run 'npm run check:types' to verify the incoming code."
