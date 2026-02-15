#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
else
  SUDO=""
fi

APP_DIR="${APP_DIR:-/opt/bafang-box-order}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
AUTH_JWT_SECRET="${AUTH_JWT_SECRET:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-0000}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
POS_LLM_API_KEY="${POS_LLM_API_KEY:-}"

require_var() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing required variable: $name" >&2
    exit 1
  fi
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|g" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

require_var "REPO_URL" "$REPO_URL"
require_var "DOMAIN" "$DOMAIN"
require_var "EMAIL" "$EMAIL"
require_var "AUTH_JWT_SECRET" "$AUTH_JWT_SECRET"

export DEBIAN_FRONTEND=noninteractive

if ! command -v git >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y git
fi

if ! command -v docker >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker.io docker-compose-plugin
  $SUDO systemctl enable docker
  $SUDO systemctl start docker
fi

if ! docker compose version >/dev/null 2>&1; then
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-compose-plugin
fi

$SUDO mkdir -p "$(dirname "$APP_DIR")"
$SUDO chown -R "$USER":"$USER" "$(dirname "$APP_DIR")"

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [[ ! -f ".env" ]]; then
  cp .env.production.example .env
fi

upsert_env ".env" "DOMAIN" "$DOMAIN"
upsert_env ".env" "EMAIL" "$EMAIL"
upsert_env ".env" "AUTH_JWT_SECRET" "$AUTH_JWT_SECRET"
upsert_env ".env" "ADMIN_PASSWORD" "$ADMIN_PASSWORD"
upsert_env ".env" "OPENAI_API_KEY" "$OPENAI_API_KEY"
upsert_env ".env" "POS_LLM_API_KEY" "$POS_LLM_API_KEY"

docker compose up -d --build --remove-orphans
docker compose ps

echo "Done. App should be live at https://${DOMAIN}"
