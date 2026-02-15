import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  API_CONTRACT_VERSION,
  CONTRACT_VERSION,
  REVIEW_QUEUE_STATUSES,
  buildReviewSummary,
  validateOrderNormalizedPayload,
  validateReviewListResponse,
  validateReviewResponse,
} from './schema.mjs';
import { classifyOrderDispatch } from '../order_dispatch/dispatcher.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REVIEW_STORE_PATH = path.join(__dirname, '..', '..', 'data', 'pos_pipeline', 'review_store.json');

const TRACKING_STATUSES = new Set(['approved', 'rejected', 'dispatch_ready', 'dispatched', 'dispatch_failed']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nowIso = () => new Date().toISOString();
const nowMs = () => Date.now();

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const countNeedsReviewItems = (order) =>
  (Array.isArray(order?.items) ? order.items : []).filter((item) => item?.needs_review === true).length;

const countNeedsReviewGroups = (order) =>
  (Array.isArray(order?.groups) ? order.groups : []).filter((group) => group?.needs_review === true).length;

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const collectLowConfidenceLineIndices = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const lineIndexSet = new Set();
  items.forEach((item) => {
    if (!isObject(item)) return;
    const lineIndex = toNumberOrNull(item.line_index);
    if (lineIndex === null) return;
    const confidenceItem = toNumberOrNull(item.confidence_item);
    const hasMissingItemCode = normalizeText(item.item_code).length === 0;
    const isLowConfidence = item.needs_review === true
      || hasMissingItemCode
      || (confidenceItem !== null && confidenceItem < 0.85);
    if (!isLowConfidence) return;
    lineIndexSet.add(Math.max(0, Math.round(lineIndex)));
  });
  return [...lineIndexSet.values()].sort((a, b) => a - b);
};

const toReviewListItem = (record) => {
  const orderPayload = record.order_payload;
  const order = orderPayload.order;
  return {
    order_id: normalizeText(order?.order_id, record.order_id),
    audit_trace_id: orderPayload.audit_trace_id,
    review_queue_status: orderPayload.review_queue_status,
    overall_needs_review: Boolean(orderPayload.review_summary?.overall_needs_review),
    needs_review_item_count: countNeedsReviewItems(order),
    needs_review_group_count: countNeedsReviewGroups(order),
    created_at: record.created_at,
    updated_at: record.updated_at,
    metadata: isObject(orderPayload.metadata) ? orderPayload.metadata : {},
    version: CONTRACT_VERSION,
  };
};

const toFrontReviewItem = (record) => ({
  id: record.order_id,
  orderId: record.order_id,
  order_id: record.order_id,
  status: record.order_payload.review_queue_status,
  createdAt: record.created_at_ms,
  updatedAt: record.updated_at_ms,
  serviceMode: record.order_payload.metadata?.service_mode ?? null,
});

const toReviewDetailItem = (record) => {
  const orderPayload = clone(record.order_payload);
  const order = isObject(orderPayload.order) ? orderPayload.order : {};
  const sourceText = normalizeText(order.source_text);
  const lineCount = Array.isArray(order.lines) ? order.lines.length : 0;
  const itemCount = Array.isArray(order.items) ? order.items.length : 0;
  const groupCount = Array.isArray(order.groups) ? order.groups.length : 0;
  return {
    order_id: record.order_id,
    audit_trace_id: normalizeText(orderPayload.audit_trace_id, record.audit_trace_id),
    review_queue_status: normalizeText(orderPayload.review_queue_status),
    overall_needs_review: Boolean(order.overall_needs_review),
    source_text: sourceText,
    line_count: lineCount,
    item_count: itemCount,
    group_count: groupCount,
    low_confidence_line_indices: collectLowConfidenceLineIndices(order),
    created_at: record.created_at,
    created_at_ms: record.created_at_ms,
    updated_at: record.updated_at,
    updated_at_ms: record.updated_at_ms,
    order_payload: orderPayload,
    metadata: isObject(orderPayload.metadata) ? orderPayload.metadata : {},
    version: CONTRACT_VERSION,
  };
};

const loadPersistedStore = (filePath) => {
  if (!fs.existsSync(filePath)) return new Map();

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return new Map();
    const payload = JSON.parse(raw);
    if (!isObject(payload) || !Array.isArray(payload.records)) return new Map();

    const output = new Map();
    for (const record of payload.records) {
      if (!isObject(record)) continue;
      const orderId = normalizeText(record.order_id);
      if (!orderId) continue;
      if (!isObject(record.order_payload)) continue;
      const validation = validateOrderNormalizedPayload(record.order_payload);
      if (!validation.ok) continue;

      output.set(orderId, {
        order_id: orderId,
        audit_trace_id: normalizeText(record.audit_trace_id, normalizeText(record.order_payload.audit_trace_id)),
        order_payload: clone(record.order_payload),
        created_at: normalizeText(record.created_at, nowIso()),
        created_at_ms: Number(record.created_at_ms) || nowMs(),
        updated_at: normalizeText(record.updated_at, nowIso()),
        updated_at_ms: Number(record.updated_at_ms) || nowMs(),
      });
    }

    return output;
  } catch {
    return new Map();
  }
};

const persistStore = (filePath, orderStore) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const records = [...orderStore.values()].map((record) => clone(record));
  const payload = {
    version: 1,
    updated_at: nowIso(),
    records,
  };
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
};

const buildOrderNotFoundError = () => {
  const error = new Error('order not found');
  error.code = 'ORDER_NOT_FOUND';
  return error;
};

const buildPatchedOrderIdError = () => {
  const error = new Error('patched_order.order_id must match request order_id');
  error.code = 'INVALID_PATCHED_ORDER_ID';
  return error;
};

export function createReviewService({ auditStore, filePath = DEFAULT_REVIEW_STORE_PATH } = {}) {
  const orderStore = loadPersistedStore(filePath);

  const upsertOrderPayload = (orderPayload) => {
    const orderId = normalizeText(orderPayload?.order?.order_id);
    if (!orderId) {
      throw new Error('order_payload.order.order_id is required');
    }

    const validation = validateOrderNormalizedPayload(orderPayload);
    if (!validation.ok) {
      throw new Error(`invalid order payload: ${validation.errors.join('; ')}`);
    }

    const current = orderStore.get(orderId);
    const timestampIso = nowIso();
    const timestampMs = nowMs();
    const nextRecord = {
      order_id: orderId,
      audit_trace_id: normalizeText(orderPayload.audit_trace_id),
      order_payload: clone(orderPayload),
      created_at: current?.created_at ?? timestampIso,
      created_at_ms: current?.created_at_ms ?? timestampMs,
      updated_at: timestampIso,
      updated_at_ms: timestampMs,
    };
    orderStore.set(orderId, nextRecord);
    persistStore(filePath, orderStore);
    return clone(nextRecord);
  };

  const listReview = ({ page = 1, pageSize = 50 } = {}) => {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedPageSize = Math.max(1, Number(pageSize) || 50);
    const start = (normalizedPage - 1) * normalizedPageSize;

    const ordered = [...orderStore.values()].sort((a, b) => b.updated_at_ms - a.updated_at_ms);
    const paged = ordered.slice(start, start + normalizedPageSize);
    const items = paged.map(toReviewListItem);

    const response = {
      api_version: API_CONTRACT_VERSION,
      version: CONTRACT_VERSION,
      items,
      total: ordered.length,
      page: normalizedPage,
      page_size: normalizedPageSize,
      next_cursor: start + normalizedPageSize < ordered.length ? String(normalizedPage + 1) : null,
    };
    const validation = validateReviewListResponse(response);
    if (!validation.ok) {
      throw new Error(`invalid review list response: ${validation.errors.join('; ')}`);
    }

    const frontList = paged.map(toFrontReviewItem);
    const pendingReview = frontList.filter((item) => !TRACKING_STATUSES.has(item.status));
    const tracking = frontList.filter((item) => TRACKING_STATUSES.has(item.status));

    return {
      ...response,
      pendingReview,
      tracking,
    };
  };

  const applyDecision = (requestPayload) => {
    const orderId = normalizeText(requestPayload?.order_id);
    const record = orderStore.get(orderId);
    if (!record) {
      throw buildOrderNotFoundError();
    }

    const currentPayload = clone(record.order_payload);
    const patchedOrder = requestPayload?.patched_order;
    if (patchedOrder !== undefined) {
      if (!isObject(patchedOrder)) {
        throw new Error('patched_order must be an object when provided');
      }
      const patchedOrderClone = clone(patchedOrder);
      const patchedOrderId = normalizeText(patchedOrderClone.order_id);
      if (patchedOrderId && patchedOrderId !== orderId) {
        throw buildPatchedOrderIdError();
      }
      if (!patchedOrderId) {
        patchedOrderClone.order_id = orderId;
      }
      currentPayload.order = patchedOrderClone;
    }

    if (!isObject(currentPayload.order)) {
      throw new Error('order payload missing order object');
    }

    const dispatchDecision = classifyOrderDispatch(currentPayload.order);
    const nextSummary = buildReviewSummary(currentPayload.order);
    const decision = normalizeText(requestPayload?.decision);

    let nextQueueStatus = currentPayload.review_queue_status;
    if (decision === 'reject') {
      nextQueueStatus = 'rejected';
    } else if (decision === 'request_changes') {
      nextQueueStatus = 'in_review';
    } else if (decision === 'approve') {
      nextQueueStatus = dispatchDecision.route === 'auto-dispatch' ? 'dispatch_ready' : 'in_review';
    }
    if (!REVIEW_QUEUE_STATUSES.includes(nextQueueStatus)) {
      nextQueueStatus = 'in_review';
    }

    const auditTraceId = normalizeText(requestPayload?.audit_trace_id, currentPayload.audit_trace_id);
    const reviewerId = normalizeText(requestPayload?.reviewer_id, 'unknown-reviewer');
    const note = normalizeText(requestPayload?.note, '');

    currentPayload.review_summary = nextSummary;
    currentPayload.review_queue_status = nextQueueStatus;
    currentPayload.audit_trace_id = auditTraceId;
    currentPayload.metadata = {
      ...(isObject(currentPayload.metadata) ? currentPayload.metadata : {}),
      last_review_decision: decision,
      last_reviewer_id: reviewerId,
      last_review_note: note || null,
      dispatch_decision: dispatchDecision,
      reviewed_at: nowIso(),
    };

    const payloadValidation = validateOrderNormalizedPayload(currentPayload);
    if (!payloadValidation.ok) {
      throw new Error(`invalid updated payload: ${payloadValidation.errors.join('; ')}`);
    }

    upsertOrderPayload(currentPayload);

    if (patchedOrder !== undefined && auditStore && typeof auditStore.appendManualCorrection === 'function') {
      auditStore.appendManualCorrection({
        orderId,
        before: record.order_payload.order,
        after: currentPayload.order,
        operator: reviewerId,
        timestamp: nowIso(),
        metadata: {
          decision,
          note,
        },
      });
    }

    if (auditStore && typeof auditStore.appendReviewDecision === 'function') {
      auditStore.appendReviewDecision({
        orderId,
        decision,
        reviewer: reviewerId,
        reason: note || null,
        metadata: {
          review_queue_status: nextQueueStatus,
          dispatch_route: dispatchDecision.route,
        },
        needsReview: nextQueueStatus === 'in_review',
      });
    } else if (auditStore && typeof auditStore.writeEvent === 'function') {
      auditStore.writeEvent({
        order_id: orderId,
        event_type: 'review_decision',
        metadata: {
          decision,
          reviewer_id: reviewerId,
          review_queue_status: nextQueueStatus,
          dispatch_route: dispatchDecision.route,
          note: note || null,
        },
      });
    }

    const response = {
      order_payload: currentPayload,
      decision,
      review_queue_status: nextQueueStatus,
      audit_trace_id: auditTraceId,
      api_version: API_CONTRACT_VERSION,
      metadata: {
        reviewer_id: reviewerId,
      },
      version: CONTRACT_VERSION,
      status: nextQueueStatus,
    };
    const responseValidation = validateReviewResponse(response);
    if (!responseValidation.ok) {
      throw new Error(`invalid review response: ${responseValidation.errors.join('; ')}`);
    }
    return response;
  };

  const listReviewDetails = ({ page = 1, pageSize = 100 } = {}) => {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedPageSize = Math.max(1, Number(pageSize) || 100);
    const start = (normalizedPage - 1) * normalizedPageSize;

    const ordered = [...orderStore.values()].sort((a, b) => b.updated_at_ms - a.updated_at_ms);
    const paged = ordered.slice(start, start + normalizedPageSize);
    const items = paged.map(toReviewDetailItem);

    return {
      api_version: API_CONTRACT_VERSION,
      version: CONTRACT_VERSION,
      items,
      total: ordered.length,
      page: normalizedPage,
      page_size: normalizedPageSize,
      next_cursor: start + normalizedPageSize < ordered.length ? String(normalizedPage + 1) : null,
    };
  };

  const getReviewDetail = (rawOrderId) => {
    const orderId = normalizeText(rawOrderId);
    if (!orderId) return null;
    const record = orderStore.get(orderId);
    if (!record) return null;
    return toReviewDetailItem(record);
  };

  const deleteOrder = (rawOrderId) => {
    const orderId = normalizeText(rawOrderId);
    if (!orderId) return false;
    if (!orderStore.has(orderId)) return false;
    orderStore.delete(orderId);
    persistStore(filePath, orderStore);
    return true;
  };

  const clearOrders = ({ predicate } = {}) => {
    const shouldDelete = typeof predicate === 'function'
      ? predicate
      : () => true;
    let deleted = 0;
    for (const [orderId, record] of orderStore.entries()) {
      if (!shouldDelete(record)) continue;
      orderStore.delete(orderId);
      deleted += 1;
    }
    if (deleted > 0) {
      persistStore(filePath, orderStore);
    }
    return {
      deleted,
      remaining: orderStore.size,
    };
  };

  return {
    upsertOrderPayload,
    listReview,
    applyDecision,
    listReviewDetails,
    getReviewDetail,
    deleteOrder,
    clearOrders,
  };
}
