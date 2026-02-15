#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/charlie/bafang-box-order"

node --input-type=module <<'JS'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  FileCacheStore,
  ITEM_MAPPING_CACHE,
  NOTE_MODS_CACHE,
  GROUP_PATTERN_CACHE,
} from '/Users/charlie/bafang-box-order/server/services/pos_pipeline/cache_store.mjs';
import { FileAuditStore } from '/Users/charlie/bafang-box-order/server/services/pos_pipeline/audit_store.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-audit-smoke-'));
const cachePath = path.join(tmpDir, 'cache_store.json');
const auditPath = path.join(tmpDir, 'audit.log.jsonl');

let clock = 1_000_000;
const nowMs = () => clock;

const cache = new FileCacheStore({
  filePath: cachePath,
  namespaceTtls: {
    [ITEM_MAPPING_CACHE]: 1,
    [NOTE_MODS_CACHE]: 60,
    [GROUP_PATTERN_CACHE]: 60,
  },
  nowMs,
});
const audit = new FileAuditStore({ filePath: auditPath });

const orderId = 'INGEST-R3-001';

const itemKey = { name_raw: '咖哩雞肉鍋貼', menu_catalog_version: 'menu-v3' };
const noteKey = { note_raw: '加辣去醬', allowed_mods_version: 'mods-v3' };
const groupKey = { group_pattern: '上面兩項同袋', menu_catalog_version: 'menu-v3', allowed_mods_version: 'mods-v3' };

// miss tracking before warming cache
if (cache.getWithTrace(ITEM_MAPPING_CACHE, itemKey, { orderId, auditStore: audit, stage: 'ingest' }) !== null) throw new Error('expected item miss');
if (cache.getWithTrace(NOTE_MODS_CACHE, noteKey, { orderId, auditStore: audit, stage: 'ingest' }) !== null) throw new Error('expected note miss');
if (cache.getWithTrace(GROUP_PATTERN_CACHE, groupKey, { orderId, auditStore: audit, stage: 'ingest' }) !== null) throw new Error('expected group miss');

// cache writes + hit tracking
cache.setWithTrace(ITEM_MAPPING_CACHE, itemKey, { item_id: 'I003' }, 0.95, { source: 'candidate_top1' }, { orderId, auditStore: audit, stage: 'ingest' });
cache.setWithTrace(NOTE_MODS_CACHE, noteKey, ['加辣', '去醬'], 0.9, { source: 'rule' }, { orderId, auditStore: audit, stage: 'ingest' });
cache.setWithTrace(GROUP_PATTERN_CACHE, groupKey, { grouping: 'pack_together', line_indices: [0, 1] }, 0.87, { source: 'reference' }, { orderId, auditStore: audit, stage: 'ingest' });

if (!cache.getWithTrace(ITEM_MAPPING_CACHE, itemKey, { orderId, auditStore: audit, stage: 'ingest' })) throw new Error('expected item hit');
if (!cache.getWithTrace(NOTE_MODS_CACHE, noteKey, { orderId, auditStore: audit, stage: 'ingest' })) throw new Error('expected note hit');
if (!cache.getWithTrace(GROUP_PATTERN_CACHE, groupKey, { orderId, auditStore: audit, stage: 'ingest' })) throw new Error('expected group hit');

// ttl expiry for item mapping
clock += 1001;
if (cache.getWithTrace(ITEM_MAPPING_CACHE, itemKey, { orderId, auditStore: audit, stage: 'review' }) !== null) {
  throw new Error('expected item ttl miss in review stage');
}

// version change should miss
if (cache.getWithTrace(ITEM_MAPPING_CACHE, { ...itemKey, menu_catalog_version: 'menu-v4' }, { orderId, auditStore: audit, stage: 'review' }) !== null) {
  throw new Error('expected version miss');
}

// end-to-end audit chain
audit.appendPipelineTrace({
  orderId,
  rawText: '咖哩雞肉鍋貼 x2 備註:加辣去醬',
  parseResult: { lines: [{ line_index: 0, name_raw: '咖哩雞肉鍋貼', qty: 2, note_raw: '加辣去醬' }] },
  candidates: { 0: [{ item_id: 'I003', score: 0.95 }] },
  llmRequest: { prompt: 'normalize order' },
  llmResponse: { items: [{ line_index: 0, item_id: 'I003' }] },
  mergeResult: { overall_needs_review: true },
  finalOutput: { route: 'review-queue', overall_needs_review: true },
  fallbackReason: 'llm_timeout',
  needsReview: true,
});
audit.appendDispatchDecision({ orderId, route: 'review-queue', reason: 'overall_needs_review', needsReview: true });
audit.appendReviewDecision({ orderId, decision: 'need_manual_fix', reviewer: 'qa_1', reason: 'ambiguous note', needsReview: true });

let unresolved = audit.listReviewQueue({ unresolvedOnly: true });
if (!unresolved.some((row) => row.order_id === orderId)) {
  throw new Error('order should be unresolved before manual correction');
}

audit.appendManualCorrection({
  orderId,
  before: { item_id: null, mods: [] },
  after: { item_id: 'I003', mods: ['加辣', '去醬'] },
  operator: 'qa_1',
  timestamp: '2026-02-15T04:40:00+08:00',
});

unresolved = audit.listReviewQueue({ unresolvedOnly: true });
if (unresolved.some((row) => row.order_id === orderId)) {
  throw new Error('order should be resolved after manual correction');
}

const allRows = audit.listReviewQueue({ unresolvedOnly: false });
const row = allRows.find((entry) => entry.order_id === orderId);
if (!row) throw new Error('order should exist in all review rows');
if (row.has_manual_correction !== true) throw new Error('manual correction flag missing');
if (!row.latest_manual_correction || row.latest_manual_correction.operator !== 'qa_1') {
  throw new Error('latest manual correction mismatch');
}

const trace = audit.getOrderTrace(orderId);
if (!trace.raw_text || !trace.parse_result || !trace.candidates || !trace.llm_request || !trace.llm_response || !trace.merge_result || !trace.final_output) {
  throw new Error('trace missing required stages');
}
if (!Array.isArray(trace.manual_corrections) || trace.manual_corrections.length !== 1) {
  throw new Error('manual correction trace count mismatch');
}

const cacheHits = audit.listByType('cache_hit').filter((event) => event.order_id === orderId);
const cacheMisses = audit.listByType('cache_miss').filter((event) => event.order_id === orderId);
const cacheWrites = audit.listByType('cache_write').filter((event) => event.order_id === orderId);
if (cacheHits.length < 3) throw new Error('expected cache_hit events for three namespaces');
if (cacheMisses.length < 5) throw new Error('expected cache_miss events (initial misses + ttl/version misses)');
if (cacheWrites.length !== 3) throw new Error('expected cache_write events for three namespaces');

console.log('cache_audit smoke: PASS');
JS
