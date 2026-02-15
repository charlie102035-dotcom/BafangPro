import { randomUUID } from 'node:crypto';

import {
  API_CONTRACT_VERSION,
  CONTRACT_VERSION,
  buildReviewSummary,
  validateIngestResponse,
  validateOrderNormalizedPayload,
} from './schema.mjs';
import { classifyOrderDispatch } from '../order_dispatch/dispatcher.mjs';
import { isPythonIngestEnabled, runPythonIngest } from './python_ingest_runner.mjs';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nowMs = () => Date.now();

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const buildOrderId = () => `ORD-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const buildTraceId = () => `trace-${randomUUID()}`;

const parseLineQty = (lineText) => {
  const xMatch = lineText.match(/^(.*?)(?:\s*[xX*]\s*(\d+))\s*$/);
  if (xMatch) {
    return {
      name: normalizeText(xMatch[1], lineText),
      qty: Number(xMatch[2]),
      parsed: true,
    };
  }
  const fenMatch = lineText.match(/^(.*?)(?:\s+(\d+)\s*份)\s*$/);
  if (fenMatch) {
    return {
      name: normalizeText(fenMatch[1], lineText),
      qty: Number(fenMatch[2]),
      parsed: true,
    };
  }
  return {
    name: normalizeText(lineText, lineText),
    qty: 1,
    parsed: false,
  };
};

const buildFallbackOrderFromText = ({ sourceText, orderId, fallbackReason }) => {
  const rawLines = String(sourceText)
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = rawLines.map((line, index) => {
    const parsed = parseLineQty(line);
    const uncertain = !parsed.parsed;
    return {
      line_index: index,
      raw_line: line,
      name_raw: parsed.name,
      qty: parsed.qty,
      name_normalized: parsed.name,
      item_code: uncertain ? null : `RAW-${index + 1}`,
      note_raw: null,
      mods: [],
      group_id: null,
      confidence_item: uncertain ? 0.4 : 0.99,
      confidence_mods: 0.99,
      needs_review: uncertain,
      metadata: {
        source: 'ingest_fallback',
        parsed_qty: parsed.parsed,
        fallback_reason: fallbackReason,
      },
      version: CONTRACT_VERSION,
    };
  });

  const lines = rawLines.map((line, index) => {
    const parsed = parseLineQty(line);
    return {
      line_index: index,
      raw_line: line,
      name_raw: parsed.name,
      qty: parsed.qty,
      note_raw: null,
      needs_review: !parsed.parsed,
      metadata: {},
      version: CONTRACT_VERSION,
    };
  });

  const hasUncertain = items.some((item) => item.needs_review || !item.item_code);
  const noItems = items.length === 0;
  return {
    source_text: String(sourceText),
    items,
    groups: [],
    order_id: orderId,
    lines,
    audit_events: noItems
      ? [
          {
            event_type: 'no_items_detected',
            message: 'No valid order lines found from source text',
            line_index: null,
            item_index: null,
            metadata: {
              fallback_reason: fallbackReason,
            },
            version: CONTRACT_VERSION,
          },
        ]
      : [],
    overall_needs_review: hasUncertain || noItems,
    metadata: {
      source: 'ingest_fallback',
      fallback_reason: fallbackReason,
    },
    version: CONTRACT_VERSION,
  };
};

const resolveStoreId = (requestPayload) => {
  const fromBody = normalizeText(requestPayload?.store_id || requestPayload?.storeId);
  if (fromBody) return fromBody;
  if (isObject(requestPayload?.metadata)) {
    const fromMetadata = normalizeText(requestPayload.metadata.store_id || requestPayload.metadata.storeId);
    if (fromMetadata) return fromMetadata;
  }
  return 'default';
};

const normalizeAllowedMods = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const token = entry.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
  }
  return output;
};

const normalizePipelineOrder = ({ pipelineResult, sourceText, orderId }) => {
  if (!isObject(pipelineResult) || !isObject(pipelineResult.merged)) {
    throw new Error('python pipeline result missing merged payload');
  }

  const order = clone(pipelineResult.merged);
  order.order_id = normalizeText(order.order_id, orderId);
  order.source_text = normalizeText(order.source_text, sourceText);

  if (!Array.isArray(order.items)) order.items = [];
  if (!Array.isArray(order.groups)) order.groups = [];
  if (!Array.isArray(order.lines)) order.lines = [];
  if (!Array.isArray(order.audit_events)) order.audit_events = [];
  if (!isObject(order.metadata)) order.metadata = {};
  if (typeof order.version !== 'string' || !order.version.trim()) {
    order.version = CONTRACT_VERSION;
  }

  return {
    order,
    pipelineAccepted: pipelineResult.accepted === true,
    pipelineNeedsReview: pipelineResult.needs_review === true,
    pipelineErrors: Array.isArray(pipelineResult.errors)
      ? pipelineResult.errors.filter((entry) => typeof entry === 'string' && entry.trim())
      : [],
    orderRaw: pipelineResult.order_raw ?? null,
    candidates: pipelineResult.candidates ?? null,
    structured: pipelineResult.structured ?? null,
  };
};

const buildPythonErrorMetadata = (error) => {
  const payload = {
    code: normalizeText(error?.code) || 'PYTHON_INGEST_FAILED',
    message: normalizeText(error?.message) || 'python ingest failed',
  };
  if (typeof error?.stderr === 'string' && error.stderr.trim()) {
    payload.stderr = error.stderr.slice(0, 1200);
  }
  return payload;
};

const shouldSimulateTimeout = (requestPayload, ingestMetadata) => {
  if (isObject(requestPayload?.simulate) && requestPayload.simulate.llm_timeout === true) {
    return true;
  }
  if (isObject(ingestMetadata) && ingestMetadata.simulate_llm_timeout === true) {
    return true;
  }
  return false;
};

const buildSimulatedTimeoutError = () => {
  const error = new Error('simulated llm timeout for ingest test');
  error.code = 'PYTHON_INGEST_TIMEOUT';
  return error;
};

const deriveLlmUsage = ({ order, llmConfig }) => {
  const structuredMeta = isObject(order?.metadata?.structured_result_metadata)
    ? order.metadata.structured_result_metadata
    : {};
  const llmAttemptsRaw = structuredMeta.llm_attempts;
  const llmAttempts = Number.isFinite(Number(llmAttemptsRaw)) ? Math.max(0, Math.round(Number(llmAttemptsRaw))) : 0;
  const llmFallbackReason = normalizeText(structuredMeta.fallback_reason, '');
  const llmAttempted = llmAttempts > 0;
  const llmUsed = llmAttempted && !llmFallbackReason;

  return {
    llm_used: llmUsed,
    llm_attempted: llmAttempted,
    llm_attempts: llmAttempts,
    llm_fallback_reason: llmFallbackReason || null,
    llm_runtime: isObject(llmConfig) ? llmConfig : null,
  };
};

export function createIngestService({ reviewService, auditStore, storeConfigService }) {
  const ingestPosText = async (requestPayload) => {
    const sourceText = normalizeText(requestPayload?.source_text ?? requestPayload?.text);
    const orderId = normalizeText(requestPayload?.order_id, buildOrderId());
    const auditTraceId = normalizeText(requestPayload?.audit_trace_id, buildTraceId());
    const ingestMetadata = isObject(requestPayload?.metadata) ? requestPayload.metadata : {};
    const storeId = resolveStoreId(requestPayload);

    const requestMenuCatalog = requestPayload?.menu_catalog;
    const requestAllowedMods = requestPayload?.allowed_mods;
    const hasInlineMenuCatalog = Array.isArray(requestMenuCatalog) || isObject(requestMenuCatalog);
    const hasInlineAllowedMods = Array.isArray(requestAllowedMods);
    const hasInlineConfig = hasInlineMenuCatalog || hasInlineAllowedMods;

    let resolvedConfig = null;
    let configError = null;
    if (storeConfigService && !hasInlineConfig) {
      try {
        resolvedConfig = storeConfigService.getConfig(storeId);
      } catch (error) {
        configError = error;
      }
    }

    const menuCatalog = hasInlineMenuCatalog
      ? requestMenuCatalog
      : (resolvedConfig?.menu_catalog ?? []);
    const allowedMods = hasInlineAllowedMods
      ? normalizeAllowedMods(requestAllowedMods)
      : normalizeAllowedMods(resolvedConfig?.allowed_mods ?? []);
    const llmConfig = isObject(requestPayload?.llm_config)
      ? requestPayload.llm_config
      : (
        storeConfigService && typeof storeConfigService.getLlmRuntimeConfig === 'function'
          ? storeConfigService.getLlmRuntimeConfig(storeId)
          : null
      );

    const menuCatalogVersion = hasInlineMenuCatalog
      ? `inline_${orderId}`
      : normalizeText(resolvedConfig?.menu_catalog_version, 'menu_unknown');
    const allowedModsVersion = hasInlineAllowedMods
      ? `inline_${orderId}`
      : normalizeText(resolvedConfig?.allowed_mods_version, 'mods_unknown');

    let order = null;
    let engine = 'rule_fallback';
    let fallbackReason = null;
    let pythonError = null;
    let pipelineSnapshot = null;
    const simulateTimeout = shouldSimulateTimeout(requestPayload, ingestMetadata);

    if (simulateTimeout) {
      pythonError = buildSimulatedTimeoutError();
      fallbackReason = 'llm_timeout_simulated';
    } else if (isPythonIngestEnabled()) {
      try {
        const pythonResponse = await runPythonIngest({
          receiptText: sourceText,
          orderId,
          menuCatalog,
          allowedMods,
          llmConfig,
        });
        pipelineSnapshot = normalizePipelineOrder({
          pipelineResult: pythonResponse.result,
          sourceText,
          orderId,
        });
        order = pipelineSnapshot.order;
        engine = 'python_pipeline';
      } catch (error) {
        pythonError = error;
        fallbackReason = normalizeText(error?.code, 'python_pipeline_error');
      }
    } else {
      fallbackReason = 'python_pipeline_disabled';
    }

    if (!order) {
      order = buildFallbackOrderFromText({
        sourceText,
        orderId,
        fallbackReason: fallbackReason || 'python_pipeline_unavailable',
      });
      if (pythonError) {
        order.metadata = {
          ...(isObject(order.metadata) ? order.metadata : {}),
          python_error: buildPythonErrorMetadata(pythonError),
        };
      }
    }

    const dispatchDecision = classifyOrderDispatch(order);
    const reviewQueueStatus = dispatchDecision.route === 'review-queue' ? 'pending_review' : 'dispatch_ready';

    const llmUsage = deriveLlmUsage({ order, llmConfig });

    order.metadata = {
      ...(isObject(order.metadata) ? order.metadata : {}),
      dispatch_decision: dispatchDecision,
      ingest_metadata: ingestMetadata,
      ingest_engine: engine,
      llm_used: llmUsage.llm_used,
      llm_attempted: llmUsage.llm_attempted,
      llm_attempts: llmUsage.llm_attempts,
      llm_fallback_reason: llmUsage.llm_fallback_reason,
      llm_runtime: llmUsage.llm_runtime,
      store_id: storeId,
      menu_catalog_version: menuCatalogVersion,
      allowed_mods_version: allowedModsVersion,
      ...(simulateTimeout ? { simulate_llm_timeout: true } : {}),
      ...(pipelineSnapshot && pipelineSnapshot.pipelineErrors.length > 0
        ? { pipeline_errors: pipelineSnapshot.pipelineErrors }
        : {}),
      ...(pipelineSnapshot && pipelineSnapshot.pipelineNeedsReview ? { pipeline_needs_review: true } : {}),
      ...(configError ? { config_error: buildPythonErrorMetadata(configError) } : {}),
    };

    const orderPayload = {
      order,
      review_summary: buildReviewSummary(order),
      review_queue_status: reviewQueueStatus,
      audit_trace_id: auditTraceId,
      metadata: {
        source: 'orders_ingest_api',
        dispatch_decision: dispatchDecision,
        ingest_engine: engine,
        llm_used: llmUsage.llm_used,
        llm_attempted: llmUsage.llm_attempted,
        llm_attempts: llmUsage.llm_attempts,
        llm_fallback_reason: llmUsage.llm_fallback_reason,
        llm_runtime: llmUsage.llm_runtime,
        store_id: storeId,
        menu_catalog_version: menuCatalogVersion,
        allowed_mods_version: allowedModsVersion,
        ...(simulateTimeout ? { simulate_llm_timeout: true } : {}),
        ...(configError ? { config_error: buildPythonErrorMetadata(configError) } : {}),
        ...(pythonError ? { python_error: buildPythonErrorMetadata(pythonError) } : {}),
      },
      version: CONTRACT_VERSION,
    };

    const payloadValidation = validateOrderNormalizedPayload(orderPayload);
    if (!payloadValidation.ok) {
      throw new Error(`invalid ingest payload: ${payloadValidation.errors.join('; ')}`);
    }

    if (reviewService && typeof reviewService.upsertOrderPayload === 'function') {
      reviewService.upsertOrderPayload(orderPayload);
    }

    if (auditStore && typeof auditStore.appendPipelineTrace === 'function') {
      auditStore.appendPipelineTrace({
        orderId,
        rawText: sourceText,
        parseResult: pipelineSnapshot?.orderRaw,
        candidates: pipelineSnapshot?.candidates,
        llmResponse: pipelineSnapshot?.structured,
        fallbackReason,
        mergeResult: pipelineSnapshot?.order ?? order,
        finalOutput: orderPayload,
        metadata: {
          audit_trace_id: auditTraceId,
          dispatch_route: dispatchDecision.route,
          ingest_engine: engine,
          ...(pythonError ? { python_error: buildPythonErrorMetadata(pythonError) } : {}),
        },
        needsReview: order.overall_needs_review,
      });
    }

    if (auditStore && typeof auditStore.appendDispatchDecision === 'function') {
      auditStore.appendDispatchDecision({
        orderId,
        route: dispatchDecision.route,
        reason: dispatchDecision.reasons.join(','),
        metadata: {
          reasons: dispatchDecision.reasons,
          source: dispatchDecision.source,
          audit_trace_id: auditTraceId,
        },
        needsReview: order.overall_needs_review,
      });
    }

    const response = {
      accepted: true,
      version: CONTRACT_VERSION,
      api_version: API_CONTRACT_VERSION,
      order_payload: orderPayload,
      status: reviewQueueStatus,
      trace_id: auditTraceId,
    };
    const responseValidation = validateIngestResponse(response);
    if (!responseValidation.ok) {
      throw new Error(`invalid ingest response: ${responseValidation.errors.join('; ')}`);
    }

    return response;
  };

  return {
    ingestPosText,
  };
}
