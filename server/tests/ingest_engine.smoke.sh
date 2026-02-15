#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/charlie/bafang-box-order"
API_PORT="${API_PORT:-8798}"
BASE_URL="http://127.0.0.1:${API_PORT}"
SERVER_LOG="${ROOT_DIR}/server/tests/.ingest_engine_smoke_server.log"
STATUS_OUT="${ROOT_DIR}/server/tests/.ingest_engine_status.json"
FIXTURES_OUT="${ROOT_DIR}/server/tests/.ingest_engine_fixtures.json"
SUITE_OUT="${ROOT_DIR}/server/tests/.ingest_engine_suite.json"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[smoke] starting api server on ${BASE_URL}"
API_PORT="${API_PORT}" node "${ROOT_DIR}/server/index.mjs" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "${BASE_URL}/api/health" >/dev/null; then
    break
  fi
  sleep 0.2
done

if ! curl -sf "${BASE_URL}/api/health" >/dev/null; then
  echo "[smoke] api failed to start"
  tail -n 80 "${SERVER_LOG}" || true
  exit 1
fi

curl -sS "${BASE_URL}/api/orders/ingest-engine/status?store_id=store-songren" >"${STATUS_OUT}"
curl -sS "${BASE_URL}/api/orders/ingest-fixtures" >"${FIXTURES_OUT}"
curl -sS -X POST "${BASE_URL}/api/orders/ingest-test-suite" \
  -H "Content-Type: application/json" \
  -d '{
    "store_id":"store-songren",
    "inject_dirty":true,
    "max_cases":3
  }' >"${SUITE_OUT}"

node --input-type=module - <<'JS' "${STATUS_OUT}" "${FIXTURES_OUT}" "${SUITE_OUT}"
import fs from 'node:fs';

const [statusPath, fixturesPath, suitePath] = process.argv.slice(2);
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));

if (!status || typeof status !== 'object') throw new Error('status payload invalid');
if (!Number.isFinite(Number(status.menu_item_count)) || Number(status.menu_item_count) <= 0) {
  throw new Error('status.menu_item_count missing');
}
if (!status.llm_runtime || typeof status.llm_runtime !== 'object') {
  throw new Error('status.llm_runtime missing');
}
if (typeof status.llm_runtime.provider !== 'string' || !status.llm_runtime.provider) {
  throw new Error('status.llm_runtime.provider missing');
}
if (!Array.isArray(fixtures.fixtures) || fixtures.fixtures.length < 1) {
  throw new Error('fixtures payload missing');
}
if (!Number.isFinite(Number(suite.total_cases)) || Number(suite.total_cases) !== 3) {
  throw new Error('suite.total_cases invalid');
}
if (!Array.isArray(suite.results) || suite.results.length !== 3) {
  throw new Error('suite.results invalid');
}
console.log(`[smoke] status menu_item_count=${status.menu_item_count}`);
console.log(`[smoke] fixtures total=${fixtures.total}`);
console.log(`[smoke] suite accepted=${suite.accepted_cases} needs_review=${suite.needs_review_cases}`);
console.log('[smoke] ingest engine PASS');
JS

echo "[smoke] pass"
