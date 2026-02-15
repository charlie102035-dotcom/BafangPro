import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AUDIT_PATH = path.join(__dirname, '..', '..', 'data', 'pos_pipeline', 'audit.log.jsonl');

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'api_key',
  'authorization',
  'cookie',
  'phone',
  'mobile',
  'email',
]);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nowIso = () => new Date().toISOString();

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const clone = (value) => JSON.parse(JSON.stringify(value));

const maskSensitiveValue = (value, maskText = '***') => {
  if (Array.isArray(value)) return value.map((item) => maskSensitiveValue(item, maskText));

  if (isPlainObject(value)) {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      const keyLower = String(key).toLowerCase();
      if (SENSITIVE_KEYS.has(keyLower) || keyLower.includes('token') || keyLower.includes('secret')) {
        output[key] = maskText;
      } else {
        output[key] = maskSensitiveValue(inner, maskText);
      }
    }
    return output;
  }

  if (typeof value === 'string') {
    if (value.includes('@') && value.includes('.')) return maskText;
    const mixedLongToken = value.length >= 16 && /[0-9]/.test(value) && /[A-Za-z]/.test(value);
    if (mixedLongToken) return maskText;
    return value;
  }

  return value;
};

const normalizeHumanCorrection = (payload) => {
  const correction = payload.human_correction;
  const legacyBefore = payload.before;
  const legacyAfter = payload.after;
  const legacyOperator = payload.operator;
  const legacyTimestamp = payload.correction_timestamp;

  let normalized = correction;
  if (!normalized && [legacyBefore, legacyAfter, legacyOperator, legacyTimestamp].some((v) => v !== undefined && v !== null)) {
    normalized = {
      before: legacyBefore,
      after: legacyAfter,
      operator: legacyOperator,
      timestamp: legacyTimestamp,
    };
  }

  if (normalized === undefined || normalized === null) return null;
  if (!isPlainObject(normalized)) {
    throw new Error('human_correction must be an object');
  }

  const output = { ...normalized };
  if (output.before === undefined) output.before = legacyBefore ?? null;
  if (output.after === undefined) output.after = legacyAfter ?? null;

  const operator = normalizeText(output.operator);
  output.operator = operator || 'unknown';

  const timestamp = normalizeText(output.timestamp);
  output.timestamp = timestamp || nowIso();

  return output;
};

const eventNeedsReview = (event) => {
  if (!isPlainObject(event)) return false;
  if (event.needs_review === true) return true;

  if (isPlainObject(event.metadata) && event.metadata.needs_review === true) return true;

  if (typeof event.fallback_reason === 'string' && event.fallback_reason.trim()) return true;

  if (isPlainObject(event.final_output)) {
    if (event.final_output.overall_needs_review === true || event.final_output.needs_review === true) return true;
  }

  if (isPlainObject(event.merge_result)) {
    if (event.merge_result.overall_needs_review === true || event.merge_result.needs_review === true) return true;
  }

  return false;
};

const makeAuditEvent = (event) => {
  if (!isPlainObject(event)) {
    throw new Error('audit event must be an object');
  }

  const payload = { ...event };

  const orderId = normalizeText(payload.order_id);
  const eventType = normalizeText(payload.event_type);
  if (!orderId) throw new Error('audit event missing required field: order_id');
  if (!eventType) throw new Error('audit event missing required field: event_type');

  payload.order_id = orderId;
  payload.event_type = eventType;
  payload.timestamp = normalizeText(payload.timestamp) || nowIso();
  payload.raw_text = payload.raw_text ?? null;
  payload.parse_result = payload.parse_result ?? null;
  payload.candidates = payload.candidates ?? null;
  payload.llm_request = payload.llm_request ?? null;
  payload.llm_response = payload.llm_response ?? null;
  payload.fallback_reason = payload.fallback_reason ?? null;
  payload.merge_result = payload.merge_result ?? null;
  payload.final_output = payload.final_output ?? null;
  payload.metadata = isPlainObject(payload.metadata) ? payload.metadata : {};
  payload.needs_review = payload.needs_review === true;
  payload.human_correction = normalizeHumanCorrection(payload);

  return payload;
};

export class FileAuditStore {
  constructor({ filePath = DEFAULT_AUDIT_PATH } = {}) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  writeEvent(event, { maskSensitive = true } = {}) {
    const payload = makeAuditEvent(event);
    if (maskSensitive) {
      payload.llm_request = maskSensitiveValue(payload.llm_request);
      payload.llm_response = maskSensitiveValue(payload.llm_response);
    }

    fs.appendFileSync(this.filePath, `${JSON.stringify(payload)}\n`, 'utf-8');
    return clone(payload);
  }

  appendPipelineTrace({
    orderId,
    rawText = null,
    parseResult = null,
    candidates = null,
    llmRequest = null,
    llmResponse = null,
    fallbackReason = null,
    mergeResult = null,
    finalOutput = null,
    metadata = {},
    needsReview = false,
  }) {
    return this.writeEvent({
      order_id: orderId,
      event_type: 'ingest_pipeline',
      raw_text: rawText,
      parse_result: parseResult,
      candidates,
      llm_request: llmRequest,
      llm_response: llmResponse,
      fallback_reason: fallbackReason,
      merge_result: mergeResult,
      final_output: finalOutput,
      metadata,
      needs_review: needsReview,
    });
  }

  appendDispatchDecision({
    orderId,
    route = null,
    reason = null,
    metadata = {},
    needsReview = false,
  }) {
    return this.writeEvent({
      order_id: orderId,
      event_type: 'dispatch_decision',
      final_output: {
        route,
        reason,
      },
      metadata,
      needs_review: needsReview,
    });
  }

  appendReviewDecision({
    orderId,
    decision = null,
    reviewer = null,
    reason = null,
    metadata = {},
    needsReview = false,
  }) {
    return this.writeEvent({
      order_id: orderId,
      event_type: 'review_decision',
      metadata: {
        ...metadata,
        decision,
        reviewer,
        reason,
      },
      needs_review: needsReview,
    });
  }

  appendCacheLookup({
    orderId,
    namespace,
    keyPayload = null,
    hit = false,
    stage = 'ingest',
    metadata = {},
  }) {
    return this.writeEvent({
      order_id: orderId,
      event_type: hit ? 'cache_hit' : 'cache_miss',
      metadata: {
        ...metadata,
        namespace,
        stage,
        key_payload: keyPayload,
        hit,
      },
      needs_review: false,
    });
  }

  appendCacheWrite({
    orderId,
    namespace,
    keyPayload = null,
    stage = 'ingest',
    confidence = null,
    metadata = {},
  }) {
    return this.writeEvent({
      order_id: orderId,
      event_type: 'cache_write',
      metadata: {
        ...metadata,
        namespace,
        stage,
        key_payload: keyPayload,
        confidence,
      },
      needs_review: false,
    });
  }

  appendManualCorrection({ orderId, before = null, after = null, operator = 'unknown', timestamp = null, metadata = {} }) {
    return this.writeEvent({
      order_id: orderId,
      event_type: 'manual_correction',
      human_correction: {
        before,
        after,
        operator,
        timestamp,
      },
      metadata,
      needs_review: false,
    });
  }

  listEvents(orderId) {
    const normalizedOrderId = normalizeText(orderId);
    if (!normalizedOrderId) return [];
    return this.#readAll().filter((event) => event.order_id === normalizedOrderId);
  }

  listByType(eventType) {
    const normalizedType = normalizeText(eventType);
    if (!normalizedType) return [];
    return this.#readAll().filter((event) => event.event_type === normalizedType);
  }

  getOrderTrace(orderId) {
    const events = this.listEvents(orderId);
    const trace = {
      order_id: normalizeText(orderId),
      raw_text: null,
      parse_result: null,
      candidates: null,
      llm_request: null,
      llm_response: null,
      fallback_reason: null,
      merge_result: null,
      final_output: null,
      manual_corrections: [],
      events,
    };

    for (const event of events) {
      if (typeof event.raw_text === 'string' && event.raw_text.trim()) trace.raw_text = event.raw_text;
      if (event.parse_result !== null && event.parse_result !== undefined) trace.parse_result = event.parse_result;
      if (event.candidates !== null && event.candidates !== undefined) trace.candidates = event.candidates;
      if (event.llm_request !== null && event.llm_request !== undefined) trace.llm_request = event.llm_request;
      if (event.llm_response !== null && event.llm_response !== undefined) trace.llm_response = event.llm_response;
      if (typeof event.fallback_reason === 'string' && event.fallback_reason.trim()) trace.fallback_reason = event.fallback_reason;
      if (event.merge_result !== null && event.merge_result !== undefined) trace.merge_result = event.merge_result;
      if (event.final_output !== null && event.final_output !== undefined) trace.final_output = event.final_output;
      if (event.human_correction) trace.manual_corrections.push(event.human_correction);
    }

    return trace;
  }

  listReviewQueue({ limit = 100, unresolvedOnly = true } = {}) {
    const events = this.#readAll();
    const byOrder = new Map();

    for (const event of events) {
      if (!event.order_id) continue;
      const list = byOrder.get(event.order_id) ?? [];
      list.push(event);
      byOrder.set(event.order_id, list);
    }

    const queue = [];
    for (const [orderId, orderEvents] of byOrder.entries()) {
      let latestManualFixIndex = -1;
      for (let index = 0; index < orderEvents.length; index += 1) {
        const event = orderEvents[index];
        if (event.event_type === 'manual_correction' && event.human_correction && event.human_correction.after !== null) {
          latestManualFixIndex = index;
        }
      }

      const pendingEvents = orderEvents.filter((event, index) => {
        if (!eventNeedsReview(event)) return false;
        if (!unresolvedOnly) return true;
        return index > latestManualFixIndex;
      });

      if (pendingEvents.length === 0) continue;

      const latest = orderEvents[orderEvents.length - 1];
      const latestManualFix = latestManualFixIndex >= 0 ? orderEvents[latestManualFixIndex] : null;
      const latestRawText = [...orderEvents].reverse().find((event) => typeof event.raw_text === 'string' && event.raw_text.trim());

      queue.push({
        order_id: orderId,
        latest_event_type: latest.event_type,
        latest_timestamp: latest.timestamp,
        pending_event_types: Array.from(new Set(pendingEvents.map((event) => event.event_type))),
        pending_count: pendingEvents.length,
        has_manual_correction: latestManualFixIndex >= 0,
        latest_manual_correction: latestManualFix ? latestManualFix.human_correction : null,
        raw_preview: latestRawText ? latestRawText.raw_text : null,
      });
    }

    queue.sort((a, b) => String(b.latest_timestamp).localeCompare(String(a.latest_timestamp)));
    return queue.slice(0, Math.max(0, Number(limit) || 0));
  }

  #readAll() {
    if (!fs.existsSync(this.filePath)) return [];

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    if (!raw.trim()) return [];

    const output = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isPlainObject(parsed)) output.push(parsed);
      } catch {
        continue;
      }
    }

    return output;
  }
}

export const createAuditStore = (options = {}) => new FileAuditStore(options);
