#!/bin/bash
set -euo pipefail

# NanoClaw Quick Setup for Root Signals
# Usage: bash scripts/quicksetup.sh
#
# Required env vars (or will be prompted):
#   ANTHROPIC_AUTH_TOKEN  - Claude subscription token or API key
#   SLACK_BOT_TOKEN       - Slack bot token (xoxb-...)
#   SLACK_APP_TOKEN       - Slack app token (xapp-...)
#   SLACK_CHANNEL_ID      - Slack channel ID (C...)
#   SLACK_CHANNEL_NAME    - Slack channel name
#
# Optional:
#   ASSISTANT_NAME        - defaults to Justiina
#   FIREFLIES_API_KEY     - Fireflies API token for meeting summaries
#   CHANNEL_IS_MAIN       - set to "true" for main channel (no trigger required)

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

ASS_NAME="${ASSISTANT_NAME:-Justiina}"

echo "=== NanoClaw Quick Setup ==="
echo "Assistant: $ASS_NAME"
echo

# --- Prompt for missing vars ---

if [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  read -rp "Anthropic auth token: " ANTHROPIC_AUTH_TOKEN
fi
if [ -z "${SLACK_BOT_TOKEN:-}" ]; then
  read -rp "Slack Bot Token (xoxb-...): " SLACK_BOT_TOKEN
fi
if [ -z "${SLACK_APP_TOKEN:-}" ]; then
  read -rp "Slack App Token (xapp-...): " SLACK_APP_TOKEN
fi
if [ -z "${SLACK_CHANNEL_ID:-}" ]; then
  read -rp "Slack Channel ID (C...): " SLACK_CHANNEL_ID
fi
if [ -z "${SLACK_CHANNEL_NAME:-}" ]; then
  read -rp "Slack Channel Name: " SLACK_CHANNEL_NAME
fi

CHANNEL_IS_MAIN="${CHANNEL_IS_MAIN:-false}"
FOLDER_NAME="slack_$(echo "$SLACK_CHANNEL_NAME" | tr '-' '_')"

# --- Write .env ---

echo "[1/8] Writing .env..."
cat > .env <<EOF
ASSISTANT_NAME=$ASS_NAME
SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN
SLACK_APP_TOKEN=$SLACK_APP_TOKEN
ONECLI_URL=http://172.17.0.1:10254
FIREFLIES_API_KEY=${FIREFLIES_API_KEY:-}
EOF
mkdir -p data/env && cp .env data/env/env

# --- Install OneCLI ---

echo "[2/8] Installing OneCLI gateway..."
if ! curl -sf http://172.17.0.1:10254/overview >/dev/null 2>&1; then
  curl -fsSL onecli.sh/install | sh
else
  echo "  OneCLI already running."
fi

if ! command -v onecli >/dev/null 2>&1; then
  curl -fsSL onecli.sh/cli/install | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
onecli config set api-host http://172.17.0.1:10254 >/dev/null

# --- Register Anthropic credential ---

echo "[3/8] Registering Anthropic credential..."
if onecli secrets list 2>/dev/null | grep -q Anthropic; then
  echo "  Anthropic secret already exists."
else
  onecli secrets create --name Anthropic --type anthropic \
    --value "$ANTHROPIC_AUTH_TOKEN" --host-pattern api.anthropic.com
fi

# --- Build ---

echo "[4/8] Building NanoClaw..."
npm run build 2>&1 | tail -1

# --- Build container (if needed) ---

echo "[5/8] Building agent container..."
if docker image inspect nanoclaw-agent:latest >/dev/null 2>&1; then
  echo "  Container image already exists."
else
  bash container/build.sh 2>&1 | tail -3
fi

# --- Register Slack channel ---

echo "[6/8] Registering Slack channel..."
EXISTING=$(sqlite3 store/messages.db "SELECT COUNT(*) FROM registered_groups WHERE jid = 'slack:$SLACK_CHANNEL_ID';" 2>/dev/null || echo "0")
if [ "$EXISTING" = "0" ]; then
  REGISTER_FLAGS="--jid slack:$SLACK_CHANNEL_ID --name $SLACK_CHANNEL_NAME --folder $FOLDER_NAME --trigger @$ASS_NAME --channel slack"
  if [ "$CHANNEL_IS_MAIN" = "true" ]; then
    REGISTER_FLAGS="$REGISTER_FLAGS --no-trigger-required --is-main"
  fi
  npx tsx setup/index.ts --step register -- $REGISTER_FLAGS 2>&1 | tail -3
  # Fix identity in group CLAUDE.md
  sed -i "s/# Andy/# $ASS_NAME/g; s/You are Andy/You are $ASS_NAME/g" "groups/$FOLDER_NAME/CLAUDE.md"
else
  echo "  Channel already registered."
fi

# --- Mount allowlist ---

echo "[7/8] Setting up mount allowlist..."
mkdir -p "$HOME/.config/nanoclaw"
if [ ! -f "$HOME/.config/nanoclaw/mount-allowlist.json" ]; then
  cat > "$HOME/.config/nanoclaw/mount-allowlist.json" <<'MEOF'
{
  "allowedRoots": [
    {
      "path": "/home/exedev/repos",
      "allowReadWrite": true,
      "description": "Git repositories"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": false
}
MEOF
else
  echo "  Allowlist already exists."
fi

# --- Clear stale sessions ---

echo "[8/8] Clearing stale sessions..."
rm -rf "data/sessions/$FOLDER_NAME"

echo
echo "=== Setup complete ==="
echo "Start with: npm run dev"
echo "Or install as systemd service:"
echo "  sudo cp scripts/nanoclaw.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload && sudo systemctl enable --now nanoclaw"
echo
echo "Test in Slack: @$ASS_NAME hello"
