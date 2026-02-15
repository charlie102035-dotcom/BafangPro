#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/charlie/bafang-box-order"
API_PORT="${API_PORT:-8796}"
BASE_URL="http://127.0.0.1:${API_PORT}"
SERVER_LOG="${ROOT_DIR}/server/tests/.store_config_smoke_server.log"
STORE_ID="store-smoke"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[smoke] starting api server on ${BASE_URL}"
API_PORT="${API_PORT}" npm run dev:api >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 80); do
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

CONFIG_BEFORE="${ROOT_DIR}/server/tests/.store_config_before.json"
CONFIG_AFTER_PUT="${ROOT_DIR}/server/tests/.store_config_after_put.json"
CONFIG_AFTER_FILE_EDIT="${ROOT_DIR}/server/tests/.store_config_after_file_edit.json"

curl -sS "${BASE_URL}/api/orders/pipeline-config?store_id=${STORE_ID}" >"${CONFIG_BEFORE}"

node --input-type=module - <<'JS' "${CONFIG_BEFORE}" "${ROOT_DIR}" "${STORE_ID}" "${BASE_URL}" "${CONFIG_AFTER_PUT}" "${CONFIG_AFTER_FILE_EDIT}"
import fs from 'node:fs';

const [beforePath, rootDir, storeId, baseUrl, afterPutPath, afterFilePath] = process.argv.slice(2);

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
if (!Array.isArray(before.allowed_mods)) {
  throw new Error('allowed_mods missing in initial config');
}
const beforeVersion = String(before.allowed_mods_version || '');
const stamp = Date.now().toString(36);
const marker1 = `SMOKE_MARKER_A_${stamp}`;
const marker2 = `SMOKE_MARKER_B_${stamp}`;

const nextMods = [...before.allowed_mods.filter((item) => typeof item === 'string' && item.trim())];
if (!nextMods.includes(marker1)) nextMods.push(marker1);

const putResponse = await fetch(`${baseUrl}/api/orders/pipeline-config`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ store_id: storeId, allowed_mods: nextMods }),
});
if (!putResponse.ok) {
  const text = await putResponse.text();
  throw new Error(`PUT pipeline-config failed: ${putResponse.status} ${text}`);
}
const afterPut = await putResponse.json();
fs.writeFileSync(afterPutPath, JSON.stringify(afterPut, null, 2));
if (!Array.isArray(afterPut.allowed_mods) || !afterPut.allowed_mods.includes(marker1)) {
  throw new Error('marker1 not applied by PUT');
}
if (String(afterPut.allowed_mods_version || '') === beforeVersion) {
  throw new Error('allowed_mods_version did not change after PUT');
}

const allowedModsFile = String(afterPut.file_paths?.allowed_mods || '');
if (!allowedModsFile) throw new Error('allowed_mods file path missing');
const fromDisk = JSON.parse(fs.readFileSync(allowedModsFile, 'utf8'));
if (!Array.isArray(fromDisk)) throw new Error('allowed_mods file invalid');
if (!fromDisk.includes(marker2)) fromDisk.push(marker2);
fs.writeFileSync(allowedModsFile, `${JSON.stringify(fromDisk, null, 2)}\n`, 'utf8');

const getAfterFile = await fetch(`${baseUrl}/api/orders/pipeline-config?store_id=${storeId}`);
if (!getAfterFile.ok) {
  const text = await getAfterFile.text();
  throw new Error(`GET after file edit failed: ${getAfterFile.status} ${text}`);
}
const afterFile = await getAfterFile.json();
fs.writeFileSync(afterFilePath, JSON.stringify(afterFile, null, 2));
if (!Array.isArray(afterFile.allowed_mods) || !afterFile.allowed_mods.includes(marker2)) {
  throw new Error('marker2 not visible after direct file edit (hot reload failed)');
}

console.log(`[smoke] before_version=${beforeVersion}`);
console.log(`[smoke] after_put_version=${afterPut.allowed_mods_version}`);
console.log(`[smoke] after_file_edit_version=${afterFile.allowed_mods_version}`);
console.log('[smoke] store config hot reload PASS');
JS

echo "[smoke] pass"
