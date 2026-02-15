export const CONTRACT_VERSION = '1.0.0';
export const API_CONTRACT_VERSION = '1.1.0';

export const GROUP_TYPES = Object.freeze(['pack_together', 'separate', 'other']);
export const REVIEW_QUEUE_STATUSES = Object.freeze([
  'pending_review',
  'in_review',
  'approved',
  'rejected',
  'dispatch_ready',
  'dispatched',
  'dispatch_failed',
]);
export const REVIEW_DECISIONS = Object.freeze(['approve', 'reject', 'request_changes']);
export const DISPATCH_STATUSES = Object.freeze(['queued', 'sent', 'failed', 'skipped']);

export const CONTRACT_DOC = Object.freeze({
  ingest: {
    request: ['source_text', 'api_version', 'order_id?', 'audit_trace_id?', 'metadata?', 'text?(backward-compatible)'],
    response: ['accepted', 'version', 'api_version', 'order_payload', 'status?(backward-compatible)', 'trace_id?(backward-compatible)'],
  },
  review: {
    list_response: ['api_version', 'version', 'items', 'total', 'page?', 'page_size?', 'next_cursor?'],
    decision_request: ['order_id', 'api_version', 'audit_trace_id', 'review_queue_status', 'decision', 'reviewer_id', 'note?', 'patched_order?', 'metadata?'],
    decision_response: ['order_payload', 'decision', 'review_queue_status', 'audit_trace_id', 'api_version', 'metadata', 'version', 'status?(backward-compatible)'],
  },
  dispatch: {
    request: ['order_payload', 'api_version', 'dispatch_target', 'dry_run?', 'metadata?'],
    response: ['order_id', 'audit_trace_id', 'api_version', 'dispatch_status', 'review_queue_status', 'metadata', 'version', 'status?(backward-compatible)'],
  },
  order_payload: [
    'order',
    'review_summary.overall_needs_review',
    'review_summary.needs_review_item_line_indices',
    'review_summary.needs_review_group_ids',
    'review_queue_status',
    'audit_trace_id',
    'metadata',
    'version',
  ],
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isInteger(value) {
  return Number.isInteger(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value) {
  return value === null || isString(value);
}

function isNullableNumber(value) {
  return value === null || isNumber(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isString);
}

function isIntegerArray(value) {
  return Array.isArray(value) && value.every(isInteger);
}

function validateApiVersion(value, path, errors) {
  if (!isString(value)) {
    pushError(errors, path, 'must be string');
    return;
  }
  if (value !== API_CONTRACT_VERSION) {
    pushError(errors, path, `must equal ${API_CONTRACT_VERSION}`);
  }
}

function validateVersion(value, path, errors) {
  if (!isString(value)) {
    pushError(errors, path, 'must be string');
    return;
  }
  if (value !== CONTRACT_VERSION) {
    pushError(errors, path, `must equal ${CONTRACT_VERSION}`);
  }
}

function pushError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateMetadata(value, path, errors) {
  if (!isObject(value)) {
    pushError(errors, path, 'must be an object');
  }
}

function validateMod(mod, path, errors) {
  if (!isObject(mod)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isString(mod.mod_raw)) pushError(errors, `${path}.mod_raw`, 'must be string');
  if (!(mod.mod_name === undefined || isNullableString(mod.mod_name))) pushError(errors, `${path}.mod_name`, 'must be string|null');
  if (!(mod.mod_value === undefined || isNullableString(mod.mod_value))) pushError(errors, `${path}.mod_value`, 'must be string|null');
  if (!(mod.confidence === undefined || isNullableNumber(mod.confidence))) pushError(errors, `${path}.confidence`, 'must be number|null');
  if (!isBoolean(mod.needs_review)) pushError(errors, `${path}.needs_review`, 'must be boolean');
  validateMetadata(mod.metadata, `${path}.metadata`, errors);
  if (!isString(mod.version)) pushError(errors, `${path}.version`, 'must be string');
}

function validateItemCore(item, path, errors) {
  if (!isObject(item)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isInteger(item.line_index)) pushError(errors, `${path}.line_index`, 'must be integer');
  if (!isString(item.raw_line)) pushError(errors, `${path}.raw_line`, 'must be string');
  if (!isString(item.name_raw)) pushError(errors, `${path}.name_raw`, 'must be string');
  if (!isInteger(item.qty)) pushError(errors, `${path}.qty`, 'must be integer');
  if (!(item.note_raw === undefined || isNullableString(item.note_raw))) pushError(errors, `${path}.note_raw`, 'must be string|null');
  if (!(item.group_id === undefined || isNullableString(item.group_id))) pushError(errors, `${path}.group_id`, 'must be string|null');
  if (!(item.confidence_item === undefined || isNullableNumber(item.confidence_item))) pushError(errors, `${path}.confidence_item`, 'must be number|null');
  if (!(item.confidence_mods === undefined || isNullableNumber(item.confidence_mods))) pushError(errors, `${path}.confidence_mods`, 'must be number|null');
  if (!isBoolean(item.needs_review)) pushError(errors, `${path}.needs_review`, 'must be boolean');
  if (!Array.isArray(item.mods)) {
    pushError(errors, `${path}.mods`, 'must be array');
  } else {
    item.mods.forEach((mod, index) => validateMod(mod, `${path}.mods[${index}]`, errors));
  }
  validateMetadata(item.metadata, `${path}.metadata`, errors);
  if (!isString(item.version)) pushError(errors, `${path}.version`, 'must be string');
}

function validateCandidateItem(item, path, errors) {
  validateItemCore(item, path, errors);
  if (!isObject(item)) return;
  if (!isString(item.candidate_name)) pushError(errors, `${path}.candidate_name`, 'must be string');
  if (!(item.candidate_code === undefined || isNullableString(item.candidate_code))) {
    pushError(errors, `${path}.candidate_code`, 'must be string|null');
  }
}

function validateNormalizedItem(item, path, errors) {
  validateItemCore(item, path, errors);
  if (!isObject(item)) return;
  if (!isString(item.name_normalized)) pushError(errors, `${path}.name_normalized`, 'must be string');
  if (!(item.item_code === undefined || isNullableString(item.item_code))) {
    pushError(errors, `${path}.item_code`, 'must be string|null');
  }
}

function validateGroup(group, path, errors) {
  if (!isObject(group)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isString(group.group_id)) pushError(errors, `${path}.group_id`, 'must be string');
  if (!GROUP_TYPES.includes(group.type)) pushError(errors, `${path}.type`, `must be one of ${GROUP_TYPES.join(', ')}`);
  if (!isString(group.label)) pushError(errors, `${path}.label`, 'must be string');
  if (!isIntegerArray(group.line_indices)) pushError(errors, `${path}.line_indices`, 'must be integer[]');
  if (!(group.confidence_group === undefined || isNullableNumber(group.confidence_group))) {
    pushError(errors, `${path}.confidence_group`, 'must be number|null');
  }
  if (!isBoolean(group.needs_review)) pushError(errors, `${path}.needs_review`, 'must be boolean');
  validateMetadata(group.metadata, `${path}.metadata`, errors);
  if (!isString(group.version)) pushError(errors, `${path}.version`, 'must be string');
}

function validateAuditEvent(event, path, errors) {
  if (!isObject(event)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isString(event.event_type)) pushError(errors, `${path}.event_type`, 'must be string');
  if (!isString(event.message)) pushError(errors, `${path}.message`, 'must be string');
  if (!(event.line_index === undefined || event.line_index === null || isInteger(event.line_index))) {
    pushError(errors, `${path}.line_index`, 'must be integer|null');
  }
  if (!(event.item_index === undefined || event.item_index === null || isInteger(event.item_index))) {
    pushError(errors, `${path}.item_index`, 'must be integer|null');
  }
  validateMetadata(event.metadata, `${path}.metadata`, errors);
  if (!isString(event.version)) pushError(errors, `${path}.version`, 'must be string');
}

export function buildReviewSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const groups = Array.isArray(order?.groups) ? order.groups : [];

  return {
    overall_needs_review: Boolean(order?.overall_needs_review),
    needs_review_item_line_indices: items
      .filter((item) => isObject(item) && item.needs_review === true && isInteger(item.line_index))
      .map((item) => item.line_index),
    needs_review_group_ids: groups
      .filter((group) => isObject(group) && group.needs_review === true && isString(group.group_id))
      .map((group) => group.group_id),
  };
}

export function validateOrderNormalized(order) {
  const errors = [];
  if (!isObject(order)) {
    return { ok: false, errors: ['order: must be an object'] };
  }

  if (!isString(order.source_text)) pushError(errors, 'order.source_text', 'must be string');
  if (!(order.order_id === undefined || isNullableString(order.order_id))) pushError(errors, 'order.order_id', 'must be string|null');
  if (!Array.isArray(order.items)) {
    pushError(errors, 'order.items', 'must be array');
  } else {
    order.items.forEach((item, index) => validateNormalizedItem(item, `order.items[${index}]`, errors));
  }
  if (!Array.isArray(order.groups)) {
    pushError(errors, 'order.groups', 'must be array');
  } else {
    order.groups.forEach((group, index) => validateGroup(group, `order.groups[${index}]`, errors));
  }
  if (!Array.isArray(order.lines)) {
    pushError(errors, 'order.lines', 'must be array');
  }
  if (!Array.isArray(order.audit_events)) {
    pushError(errors, 'order.audit_events', 'must be array');
  } else {
    order.audit_events.forEach((event, index) => validateAuditEvent(event, `order.audit_events[${index}]`, errors));
  }
  if (!isBoolean(order.overall_needs_review)) pushError(errors, 'order.overall_needs_review', 'must be boolean');
  validateMetadata(order.metadata, 'order.metadata', errors);
  if (!isString(order.version)) pushError(errors, 'order.version', 'must be string');

  return { ok: errors.length === 0, errors };
}

function validateReviewSummary(summary, order, errors, path) {
  if (!isObject(summary)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isBoolean(summary.overall_needs_review)) {
    pushError(errors, `${path}.overall_needs_review`, 'must be boolean');
  }
  if (!isIntegerArray(summary.needs_review_item_line_indices)) {
    pushError(errors, `${path}.needs_review_item_line_indices`, 'must be integer[]');
  }
  if (!isStringArray(summary.needs_review_group_ids)) {
    pushError(errors, `${path}.needs_review_group_ids`, 'must be string[]');
  }

  if (isObject(order) && isBoolean(order.overall_needs_review) && summary.overall_needs_review !== order.overall_needs_review) {
    pushError(errors, `${path}.overall_needs_review`, 'must match order.overall_needs_review');
  }
}

export function validateOrderNormalizedPayload(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['order_payload: must be an object'] };
  }

  const orderResult = validateOrderNormalized(payload.order);
  errors.push(...orderResult.errors);

  validateReviewSummary(payload.review_summary, payload.order, errors, 'order_payload.review_summary');

  if (!REVIEW_QUEUE_STATUSES.includes(payload.review_queue_status)) {
    pushError(errors, 'order_payload.review_queue_status', `must be one of ${REVIEW_QUEUE_STATUSES.join(', ')}`);
  }
  if (!isString(payload.audit_trace_id) || payload.audit_trace_id.trim() === '') {
    pushError(errors, 'order_payload.audit_trace_id', 'must be non-empty string');
  }
  validateMetadata(payload.metadata, 'order_payload.metadata', errors);
  validateVersion(payload.version, 'order_payload.version', errors);

  return { ok: errors.length === 0, errors };
}

export function validateIngestRequest(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['ingest.request: must be an object'] };
  }

  const sourceText = payload.source_text ?? payload.text;
  if (!isString(sourceText)) pushError(errors, 'ingest.request.source_text', 'must be string (or use backward-compatible text)');
  validateApiVersion(payload.api_version, 'ingest.request.api_version', errors);
  if (!(payload.order_id === undefined || isNullableString(payload.order_id))) pushError(errors, 'ingest.request.order_id', 'must be string|null');
  if (!(payload.audit_trace_id === undefined || (isString(payload.audit_trace_id) && payload.audit_trace_id.trim() !== ''))) {
    pushError(errors, 'ingest.request.audit_trace_id', 'must be non-empty string when provided');
  }
  if (!(payload.metadata === undefined || isObject(payload.metadata))) pushError(errors, 'ingest.request.metadata', 'must be object when provided');

  return { ok: errors.length === 0, errors };
}

export function validateIngestResponse(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['ingest.response: must be an object'] };
  }

  if (!isBoolean(payload.accepted)) pushError(errors, 'ingest.response.accepted', 'must be boolean');
  validateVersion(payload.version, 'ingest.response.version', errors);
  validateApiVersion(payload.api_version, 'ingest.response.api_version', errors);
  const orderPayloadResult = validateOrderNormalizedPayload(payload.order_payload);
  errors.push(...orderPayloadResult.errors);
  if (!(payload.status === undefined || isString(payload.status))) {
    pushError(errors, 'ingest.response.status', 'must be string when provided');
  }
  if (!(payload.trace_id === undefined || isString(payload.trace_id))) {
    pushError(errors, 'ingest.response.trace_id', 'must be string when provided');
  }

  return { ok: errors.length === 0, errors };
}

export function validateReviewRequest(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['review.request: must be an object'] };
  }

  if (!isString(payload.order_id) || payload.order_id.trim() === '') pushError(errors, 'review.request.order_id', 'must be non-empty string');
  validateApiVersion(payload.api_version, 'review.request.api_version', errors);
  if (!isString(payload.audit_trace_id) || payload.audit_trace_id.trim() === '') {
    pushError(errors, 'review.request.audit_trace_id', 'must be non-empty string');
  }
  if (!REVIEW_QUEUE_STATUSES.includes(payload.review_queue_status)) {
    pushError(errors, 'review.request.review_queue_status', `must be one of ${REVIEW_QUEUE_STATUSES.join(', ')}`);
  }
  if (!REVIEW_DECISIONS.includes(payload.decision)) {
    pushError(errors, 'review.request.decision', `must be one of ${REVIEW_DECISIONS.join(', ')}`);
  }
  if (!isString(payload.reviewer_id) || payload.reviewer_id.trim() === '') {
    pushError(errors, 'review.request.reviewer_id', 'must be non-empty string');
  }
  if (!(payload.note === undefined || isNullableString(payload.note))) pushError(errors, 'review.request.note', 'must be string|null');
  if (!(payload.metadata === undefined || isObject(payload.metadata))) pushError(errors, 'review.request.metadata', 'must be object when provided');

  if (payload.patched_order !== undefined) {
    const patchedResult = validateOrderNormalized(payload.patched_order);
    errors.push(...patchedResult.errors.map((msg) => msg.replace(/^order\./, 'review.request.patched_order.')));
  }

  return { ok: errors.length === 0, errors };
}

export function validateReviewResponse(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['review.response: must be an object'] };
  }

  const orderPayloadResult = validateOrderNormalizedPayload(payload.order_payload);
  errors.push(...orderPayloadResult.errors);
  if (!REVIEW_DECISIONS.includes(payload.decision)) {
    pushError(errors, 'review.response.decision', `must be one of ${REVIEW_DECISIONS.join(', ')}`);
  }
  if (!REVIEW_QUEUE_STATUSES.includes(payload.review_queue_status)) {
    pushError(errors, 'review.response.review_queue_status', `must be one of ${REVIEW_QUEUE_STATUSES.join(', ')}`);
  }
  if (!isString(payload.audit_trace_id) || payload.audit_trace_id.trim() === '') {
    pushError(errors, 'review.response.audit_trace_id', 'must be non-empty string');
  }
  validateApiVersion(payload.api_version, 'review.response.api_version', errors);
  validateMetadata(payload.metadata, 'review.response.metadata', errors);
  validateVersion(payload.version, 'review.response.version', errors);
  if (!(payload.status === undefined || isString(payload.status))) {
    pushError(errors, 'review.response.status', 'must be string when provided');
  }

  return { ok: errors.length === 0, errors };
}

function validateReviewListItem(item, path, errors) {
  if (!isObject(item)) {
    pushError(errors, path, 'must be an object');
    return;
  }
  if (!isString(item.order_id) || item.order_id.trim() === '') pushError(errors, `${path}.order_id`, 'must be non-empty string');
  if (!isString(item.audit_trace_id) || item.audit_trace_id.trim() === '') pushError(errors, `${path}.audit_trace_id`, 'must be non-empty string');
  if (!REVIEW_QUEUE_STATUSES.includes(item.review_queue_status)) {
    pushError(errors, `${path}.review_queue_status`, `must be one of ${REVIEW_QUEUE_STATUSES.join(', ')}`);
  }
  if (!isBoolean(item.overall_needs_review)) pushError(errors, `${path}.overall_needs_review`, 'must be boolean');
  if (!isInteger(item.needs_review_item_count) || item.needs_review_item_count < 0) {
    pushError(errors, `${path}.needs_review_item_count`, 'must be non-negative integer');
  }
  if (!isInteger(item.needs_review_group_count) || item.needs_review_group_count < 0) {
    pushError(errors, `${path}.needs_review_group_count`, 'must be non-negative integer');
  }
  if (!isString(item.created_at)) pushError(errors, `${path}.created_at`, 'must be string');
  if (!isString(item.updated_at)) pushError(errors, `${path}.updated_at`, 'must be string');
  validateMetadata(item.metadata, `${path}.metadata`, errors);
  validateVersion(item.version, `${path}.version`, errors);
}

export function validateReviewListResponse(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['review.list.response: must be an object'] };
  }

  validateApiVersion(payload.api_version, 'review.list.response.api_version', errors);
  validateVersion(payload.version, 'review.list.response.version', errors);
  if (!Array.isArray(payload.items)) {
    pushError(errors, 'review.list.response.items', 'must be array');
  } else {
    payload.items.forEach((item, index) => validateReviewListItem(item, `review.list.response.items[${index}]`, errors));
  }
  if (!isInteger(payload.total) || payload.total < 0) pushError(errors, 'review.list.response.total', 'must be non-negative integer');
  if (!(payload.page === undefined || (isInteger(payload.page) && payload.page >= 1))) {
    pushError(errors, 'review.list.response.page', 'must be integer >= 1 when provided');
  }
  if (!(payload.page_size === undefined || (isInteger(payload.page_size) && payload.page_size >= 1))) {
    pushError(errors, 'review.list.response.page_size', 'must be integer >= 1 when provided');
  }
  if (!(payload.next_cursor === undefined || payload.next_cursor === null || isString(payload.next_cursor))) {
    pushError(errors, 'review.list.response.next_cursor', 'must be string|null when provided');
  }

  return { ok: errors.length === 0, errors };
}

export function validateDispatchRequest(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['dispatch.request: must be an object'] };
  }

  const orderPayloadResult = validateOrderNormalizedPayload(payload.order_payload);
  errors.push(...orderPayloadResult.errors);
  validateApiVersion(payload.api_version, 'dispatch.request.api_version', errors);
  if (!isString(payload.dispatch_target) || payload.dispatch_target.trim() === '') {
    pushError(errors, 'dispatch.request.dispatch_target', 'must be non-empty string');
  }
  if (!(payload.dry_run === undefined || isBoolean(payload.dry_run))) {
    pushError(errors, 'dispatch.request.dry_run', 'must be boolean when provided');
  }
  if (!(payload.metadata === undefined || isObject(payload.metadata))) {
    pushError(errors, 'dispatch.request.metadata', 'must be object when provided');
  }

  return { ok: errors.length === 0, errors };
}

export function validateDispatchResponse(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['dispatch.response: must be an object'] };
  }

  if (!(payload.order_id === null || isString(payload.order_id))) {
    pushError(errors, 'dispatch.response.order_id', 'must be string|null');
  }
  if (!isString(payload.audit_trace_id) || payload.audit_trace_id.trim() === '') {
    pushError(errors, 'dispatch.response.audit_trace_id', 'must be non-empty string');
  }
  validateApiVersion(payload.api_version, 'dispatch.response.api_version', errors);
  if (!DISPATCH_STATUSES.includes(payload.dispatch_status)) {
    pushError(errors, 'dispatch.response.dispatch_status', `must be one of ${DISPATCH_STATUSES.join(', ')}`);
  }
  if (!REVIEW_QUEUE_STATUSES.includes(payload.review_queue_status)) {
    pushError(errors, 'dispatch.response.review_queue_status', `must be one of ${REVIEW_QUEUE_STATUSES.join(', ')}`);
  }
  validateMetadata(payload.metadata, 'dispatch.response.metadata', errors);
  validateVersion(payload.version, 'dispatch.response.version', errors);
  if (!(payload.status === undefined || isString(payload.status))) {
    pushError(errors, 'dispatch.response.status', 'must be string when provided');
  }

  return { ok: errors.length === 0, errors };
}
