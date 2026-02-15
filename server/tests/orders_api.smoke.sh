#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/charlie/bafang-box-order"
API_PORT="${API_PORT:-8797}"
BASE_URL="http://127.0.0.1:${API_PORT}"
SERVER_LOG="${ROOT_DIR}/server/tests/.orders_api_smoke_server.log"
INGEST_OUT="${ROOT_DIR}/server/tests/.orders_api_smoke_ingest.json"
REVIEW_OUT="${ROOT_DIR}/server/tests/.orders_api_smoke_review.json"
DECISION_OUT="${ROOT_DIR}/server/tests/.orders_api_smoke_decision.json"
STORE_INGEST_OUT="${ROOT_DIR}/server/tests/.orders_api_smoke_store_ingest.json"

mkdir -p "${ROOT_DIR}/server/tests"

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

INGEST_CODE="$(
  curl -sS -o "${INGEST_OUT}" -w "%{http_code}" \
    -X POST "${BASE_URL}/api/orders/ingest-pos-text" \
    -H "Content-Type: application/json" \
    -d '{
      "api_version":"1.1.0",
      "source_text":"招牌鍋貼 x2\n酸辣湯 ???",
      "metadata":{"smoke":"true"}
    }'
)"
if [[ "${INGEST_CODE}" == "404" ]]; then
  echo "[smoke] POST /api/orders/ingest-pos-text returned 404"
  exit 1
fi

STORE_INGEST_CODE="$(
  curl -sS -o "${STORE_INGEST_OUT}" -w "%{http_code}" \
    -X POST "${BASE_URL}/api/orders/stores/store-songren/ingest-pos-text" \
    -H "Content-Type: application/json" \
    -d '{
      "api_version":"1.1.0",
      "source_text":"電話: 02-0000-0000\n時間: 2026-02-14 12:35\n咖哩鍋貼 xO\n招牌鍋貼 x5 備註:同一袋",
      "metadata":{"smoke":"true","source":"store_scoped"}
    }'
)"
if [[ "${STORE_INGEST_CODE}" == "404" ]]; then
  echo "[smoke] POST /api/orders/stores/:storeId/ingest-pos-text returned 404"
  exit 1
fi

ORDER_ID="$(node --input-type=module -e "import fs from 'node:fs'; const v=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(v?.order_payload?.order?.order_id ?? ''));" "${INGEST_OUT}")"
TRACE_ID="$(node --input-type=module -e "import fs from 'node:fs'; const v=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(v?.order_payload?.audit_trace_id ?? v?.trace_id ?? ''));" "${INGEST_OUT}")"
if [[ -z "${ORDER_ID}" || -z "${TRACE_ID}" ]]; then
  echo "[smoke] ingest response missing order_id or trace_id"
  cat "${INGEST_OUT}"
  exit 1
fi

REVIEW_CODE="$(curl -sS -o "${REVIEW_OUT}" -w "%{http_code}" "${BASE_URL}/api/orders/review")"
if [[ "${REVIEW_CODE}" == "404" ]]; then
  echo "[smoke] GET /api/orders/review returned 404"
  exit 1
fi

DECISION_CODE="$(
  curl -sS -o "${DECISION_OUT}" -w "%{http_code}" \
    -X POST "${BASE_URL}/api/orders/review/decision" \
    -H "Content-Type: application/json" \
    -d "{
      \"api_version\":\"1.1.0\",
      \"order_id\":\"${ORDER_ID}\",
      \"audit_trace_id\":\"${TRACE_ID}\",
      \"review_queue_status\":\"pending_review\",
      \"decision\":\"request_changes\",
      \"reviewer_id\":\"smoke-bot\",
      \"note\":\"smoke\"
    }"
)"
if [[ "${DECISION_CODE}" == "404" ]]; then
  echo "[smoke] POST /api/orders/review/decision returned 404"
  exit 1
fi

echo "[smoke] POST /api/orders/ingest-pos-text status=${INGEST_CODE}"
echo "[smoke] POST /api/orders/stores/:storeId/ingest-pos-text status=${STORE_INGEST_CODE}"
echo "[smoke] GET  /api/orders/review status=${REVIEW_CODE}"
echo "[smoke] POST /api/orders/review/decision status=${DECISION_CODE}"
echo "[smoke] pass"
