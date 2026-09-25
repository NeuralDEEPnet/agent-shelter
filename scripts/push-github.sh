#!/usr/bin/env bash
# Push a SANITISED snapshot of agent-shelter to the public GitHub repo NeuralDEEPnet/agent-shelter.
# Excludes live secrets, .env files, and SQLite databases.
# Vendors local shared packages into ./packages so external agents can install cleanly.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR="${HOME}/.git-mirrors/agent-shelter"
REMOTE="git@github.com:NeuralDEEPnet/agent-shelter.git"
SSH_KEY="${HOME}/.ssh/deploy_agent_shelter"
export GIT_SSH_COMMAND="ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
MSG="${1:-Update agent-shelter}"

mkdir -p "$MIRROR"
if [ ! -d "$MIRROR/.git" ]; then
  git -C "$MIRROR" init -q -b main
  git -C "$MIRROR" remote add origin "$REMOTE"
  git -C "$MIRROR" config user.name "Adaptive (agent-shelter)"
  git -C "$MIRROR" config user.email "work@neuraldeep.net"
  # Fetch existing remote history if present
  git -C "$MIRROR" fetch origin main 2>/dev/null && git -C "$MIRROR" reset --soft origin/main 2>/dev/null || true
fi

# Source only. Anything env/db/log/build/dependency never leaves this box.
find "$MIRROR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
tar -C "$SRC" \
  --exclude="./.git" \
  --exclude="node_modules" --exclude="./dist" --exclude="./dist-ssr" --exclude="./generated" \
  --exclude=".env" --exclude=".env.*" --exclude="*.env" \
  --exclude="*.db" --exclude="*.db-shm" --exclude="*.db-wal" --exclude="*.sqlite*" \
  --exclude="*.log" --exclude="./logs" \
  --exclude="*.pem" --exclude="*.key" \
  --exclude="./dev-api-exports.d.ts" \
  -cf - . | tar -C "$MIRROR" -xf -

# Vendor shared packages so external agents can run npm install without missing ../shared
mkdir -p "$MIRROR/packages"
if [ -d "/home/computer/shared/model-router" ]; then
  tar -C "/home/computer/shared/model-router" --exclude="node_modules" -cf - . | mkdir -p "$MIRROR/packages/model-router" && tar -C "$MIRROR/packages/model-router" -xf -
fi
if [ -d "/home/computer/shared/mpp-kit" ]; then
  tar -C "/home/computer/shared/mpp-kit" --exclude="node_modules" -cf - . | mkdir -p "$MIRROR/packages/mpp-kit" && tar -C "$MIRROR/packages/mpp-kit" -xf -
fi

# Update package.json in mirror to point to vendored packages
node -e '
const fs = require("fs");
const p = process.argv[1];
if (fs.existsSync(p)) {
  let content = fs.readFileSync(p, "utf8");
  content = content.replace(/"file:\.\.\/shared\/model-router"/g, "\"file:./packages/model-router\"");
  content = content.replace(/"file:\.\.\/shared\/mpp-kit"/g, "\"file:./packages/mpp-kit\"");
  fs.writeFileSync(p, content);
}
' "$MIRROR/package.json"

cat > "$MIRROR/.gitignore" <<'EOF'
node_modules
dist
dist-ssr
generated
.env
.env.*
*.db
*.db-shm
*.db-wal
*.log
logs
.DS_Store
EOF

# Secret scan — abort on anything that looks like a live credential in source code (excluding test mock fixtures).
PATTERN='(hf_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abp]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----|M[A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})'
if grep -rEIl --exclude-dir=.git --exclude="*.test.ts" "$PATTERN" "$MIRROR" >/tmp/shelter-secret-hits 2>/dev/null; then
  echo "REFUSING TO PUSH — secret-shaped strings found in:" >&2
  cat /tmp/shelter-secret-hits >&2
  exit 1
fi

git -C "$MIRROR" add -A
if git -C "$MIRROR" diff --cached --quiet; then
  echo "Nothing changed since the last push."
  exit 0
fi
git -C "$MIRROR" commit -q -m "$MSG"
git -C "$MIRROR" push -q -u origin main
echo "Pushed to GitHub: $(git -C "$MIRROR" log --oneline -1)"
