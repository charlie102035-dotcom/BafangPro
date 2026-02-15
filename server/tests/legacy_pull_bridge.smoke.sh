#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
STORE_ID="${STORE_ID:-store-songren}"
TMP_DIR="${TMP_DIR:-/tmp/bafang-legacy-smoke}"

mkdir -p "${TMP_DIR}"

PAYLOAD_FILE="${TMP_DIR}/legacy_payload.txt"
PREVIEW_OUT="${TMP_DIR}/legacy_preview.json"
DRYRUN_OUT="${TMP_DIR}/legacy_dryrun.json"
INGEST_OUT="${TMP_DIR}/legacy_ingest.json"

cat >"${PAYLOAD_FILE}" <<'EOF'
ok#3#0^招牌鍋貼^2026-02-15 10:00:00^5^0^012^ORD-A^SER-1^^1^^#0^韭菜鍋貼^2026-02-15 10:00:01^10^0^012^ORD-A^SER-2^^2^同一袋^#0^酸辣湯^2026-02-15 10:00:02^1^-3^013^ORD-B^SER-3^^1^^#tail
EOF

echo "[smoke] configuring legacy pull bridge..."
curl -sS -X PUT "${BASE_URL}/api/orders/legacy-pull/config" \
  -H 'Content-Type: application/json' \
  -d "{
    \"enabled\": false,
    \"store_id\": \"${STORE_ID}\",
    \"poll_interval_ms\": 8000,
    \"request_timeout_ms\": 6000
  }" >/dev/null

echo "[smoke] preview parse..."
curl -sS -X POST "${BASE_URL}/api/orders/legacy-pull/preview-parse" \
  -H 'Content-Type: application/json' \
  --data-binary @- >"${PREVIEW_OUT}" <<EOF
{"raw_payload":$(jq -Rs . <"${PAYLOAD_FILE}")}
EOF

echo "[smoke] dry-run pull..."
curl -sS -X POST "${BASE_URL}/api/orders/legacy-pull/pull-now" \
  -H 'Content-Type: application/json' \
  --data-binary @- >"${DRYRUN_OUT}" <<EOF
{"dry_run":true,"raw_payload":$(jq -Rs . <"${PAYLOAD_FILE}")}
EOF

echo "[smoke] real ingest pull..."
curl -sS -X POST "${BASE_URL}/api/orders/legacy-pull/pull-now" \
  -H 'Content-Type: application/json' \
  --data-binary @- >"${INGEST_OUT}" <<EOF
{"reason":"smoke_ingest","raw_payload":$(jq -Rs . <"${PAYLOAD_FILE}")}
EOF

echo "[smoke] validating outputs..."
jq -e '.ok == true and .result.parsed_order_count >= 1' "${PREVIEW_OUT}" >/dev/null
jq -e '.ok == true and .dry_run == true and .result.preview_count >= 1' "${DRYRUN_OUT}" >/dev/null
jq -e '.ok == true and .dry_run == false and .result.accepted_count >= 1' "${INGEST_OUT}" >/dev/null

echo "[smoke] preview -> ${PREVIEW_OUT}"
echo "[smoke] dryrun  -> ${DRYRUN_OUT}"
echo "[smoke] ingest  -> ${INGEST_OUT}"
echo "[smoke] legacy pull bridge PASS"
