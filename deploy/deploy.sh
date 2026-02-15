#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bafang-box-order}"
BRANCH="${BRANCH:-main}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required" >&2
  exit 1
fi

cd "$APP_DIR"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

docker compose ps
