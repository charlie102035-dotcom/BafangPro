import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAuditStore } from '../services/pos_pipeline/audit_store.mjs';
import { createIngestService } from '../services/pos_pipeline/ingest_service.mjs';
import {
  PYTHON_INGEST_DEFAULTS,
  getPythonLlmRuntime,
  isPythonIngestEnabled,
} from '../services/pos_pipeline/python_ingest_runner.mjs';
import { createReviewService } from '../services/pos_pipeline/review_service.mjs';
import { createStoreConfigService } from '../services/pos_pipeline/store_config_service.mjs';
import {
  API_CONTRACT_VERSION,
  validateIngestRequest,
  validateReviewRequest,
} from '../services/pos_pipeline/schema.mjs';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};
const toPositiveInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
};
const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
};

const hasTestKeyword = (value) =>
  typeof value === 'string' && /(test|smoke|fixture|demo)/i.test(value);

const isReviewRecordTestData = (record) => {
  if (!isObject(record)) return false;
  const orderPayload = isObject(record.order_payload) ? record.order_payload : {};
  const order = isObject(orderPayload.order) ? orderPayload.order : {};
  const orderMetadata = isObject(order.metadata) ? order.metadata : {};
  const payloadMetadata = isObject(orderPayload.metadata) ? orderPayload.metadata : {};
  const ingestMetadata = isObject(orderMetadata.ingest_metadata) ? orderMetadata.ingest_metadata : {};

  if (hasTestKeyword(payloadMetadata.source)) return true;
  if (hasTestKeyword(orderMetadata.source)) return true;
  if (hasTestKeyword(ingestMetadata.source)) return true;
  if (ingestMetadata.selected_fixture_id !== undefined) return true;
  if (ingestMetadata.inject_dirty !== undefined) return true;
  if (toBool(orderMetadata.simulate_llm_timeout, false)) return true;
  if (toBool(payloadMetadata.smoke, false)) return true;
  if (toBool(orderMetadata.smoke, false)) return true;
  return false;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPTS_FIXTURES_PATH = path.join(PROJECT_ROOT, 'python_pos_module', 'fixtures', 'receipts.json');

const readJsonFile = (filePath, fallbackValue) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallbackValue;
  }
};

const getMenuCatalogCount = (menuCatalog) => {
  if (Array.isArray(menuCatalog)) return menuCatalog.length;
  if (isObject(menuCatalog)) return Object.keys(menuCatalog).length;
  return 0;
};

const getMenuCatalogPreview = (menuCatalog, limit = 8) => {
  const output = [];
  if (Array.isArray(menuCatalog)) {
    for (const entry of menuCatalog) {
      if (!isObject(entry)) continue;
      const itemId = normalizeText(entry.item_id || entry.id);
      const canonicalName = normalizeText(entry.canonical_name || entry.name);
      if (!itemId && !canonicalName) continue;
      output.push({
        item_id: itemId || canonicalName,
        canonical_name: canonicalName || itemId,
      });
      if (output.length >= limit) break;
    }
    return output;
  }
  if (isObject(menuCatalog)) {
    for (const [itemId, payload] of Object.entries(menuCatalog)) {
      let canonicalName = itemId;
      if (typeof payload === 'string') {
        canonicalName = normalizeText(payload, itemId);
      } else if (Array.isArray(payload)) {
        canonicalName = normalizeText(payload[0], itemId);
      } else if (isObject(payload)) {
        canonicalName = normalizeText(payload.canonical_name || payload.name, itemId);
      }
      output.push({
        item_id: itemId,
        canonical_name: canonicalName,
      });
      if (output.length >= limit) break;
    }
    return output;
  }
  return output;
};

const readReceiptFixtures = () => {
  const payload = readJsonFile(RECEIPTS_FIXTURES_PATH, []);
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((entry) => isObject(entry) && typeof entry.source_text === 'string')
    .map((entry, index) => ({
      fixture_id: normalizeText(entry.order_id, `fixture-${index + 1}`),
      scenario: normalizeText(entry.scenario, `scenario-${index + 1}`),
      source_text: entry.source_text,
      simulate: isObject(entry.simulate) ? entry.simulate : {},
      expected_highlight: normalizeText(entry.expected_highlight),
      expected_grouping_hint: normalizeText(entry.expected_grouping_hint),
      requires_manual_review: entry.requires_manual_review === true,
    }));
};

const applyDirtyMutations = (sourceText, index) => {
  const lines = String(sourceText || '')
    .split(/\r?\n/g)
    .filter((line) => line.trim().length > 0);
  const mutated = [...lines];

  if (index % 2 === 0) {
    mutated.unshift(`電話: 02-0000-00${(index % 10).toString().padStart(2, '0')}`);
  }
  if (index % 3 === 0) {
    mutated.unshift(`時間: 2026-02-14 1${index % 10}:35`);
  }
  if (mutated.length > 0 && index % 4 === 0) {
    mutated[0] = mutated[0].replace(/\s*x\s*(\d+)/i, ' xO');
  }
  if (mutated.length > 1 && index % 5 === 0) {
    mutated[1] = `${mutated[1]}　備註：同一袋`;
  }
  if (mutated.length > 0 && index % 6 === 0) {
    mutated.push('*** 雜訊行 ***');
  }

  return mutated.join('\n');
};

const createServices = () => {
  const auditStore = createAuditStore();
  const storeConfigService = createStoreConfigService();
  const reviewService = createReviewService({ auditStore });
  const ingestService = createIngestService({ reviewService, auditStore, storeConfigService });
  return {
    auditStore,
    storeConfigService,
    reviewService,
    ingestService,
  };
};

export function createOrdersRouter() {
  const router = express.Router();
  const services = createServices();

  const handleIngestPosText = async (req, res, forcedStoreId = null) => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const requestStoreId = normalizeText(forcedStoreId || body.store_id || body.storeId, 'default');
      const ingestRequest = {
        ...body,
        source_text: body.source_text ?? body.text ?? '',
        api_version: body.api_version ?? API_CONTRACT_VERSION,
        store_id: requestStoreId,
      };

      const validation = validateIngestRequest(ingestRequest);
      if (!validation.ok) {
        res.status(400).json({
          error: 'ingest request validation failed',
          details: validation.errors,
        });
        return;
      }

      const runtimeLlmConfig = services.storeConfigService.getLlmRuntimeConfig(requestStoreId);
      const response = await services.ingestService.ingestPosText({
        ...ingestRequest,
        llm_config: runtimeLlmConfig,
      });
      res.status(200).json(response);
    } catch (error) {
      console.error('[orders.ingest-pos-text] error', error);
      res.status(500).json({ error: 'failed to ingest order text' });
    }
  };

  router.post('/ingest-pos-text', async (req, res) => {
    await handleIngestPosText(req, res, null);
  });

  router.post('/stores/:storeId/ingest-pos-text', async (req, res) => {
    const storeId = normalizeText(req.params?.storeId, 'default');
    await handleIngestPosText(req, res, storeId);
  });

  router.get('/review', (req, res) => {
    try {
      const page = Number(req.query?.page ?? 1);
      const pageSize = Number(req.query?.page_size ?? req.query?.pageSize ?? 50);
      const snapshot = services.reviewService.listReview({ page, pageSize });
      res.status(200).json(snapshot);
    } catch (error) {
      console.error('[orders.review] error', error);
      res.status(500).json({ error: 'failed to fetch review queue' });
    }
  });

  router.get('/review/details', (req, res) => {
    try {
      const page = Number(req.query?.page ?? 1);
      const pageSize = Number(req.query?.page_size ?? req.query?.pageSize ?? 100);
      const snapshot = services.reviewService.listReviewDetails({ page, pageSize });
      res.status(200).json(snapshot);
    } catch (error) {
      console.error('[orders.review.details] error', error);
      res.status(500).json({ error: 'failed to fetch review details' });
    }
  });

  router.get('/pipeline-config', (req, res) => {
    try {
      const storeId = req.query?.store_id ?? req.query?.storeId ?? 'default';
      const config = services.storeConfigService.getConfig(storeId);
      const stores = services.storeConfigService.listStores();
      res.status(200).json({
        ...config,
        stores,
      });
    } catch (error) {
      console.error('[orders.pipeline-config.get] error', error);
      res.status(500).json({ error: 'failed to load pipeline config' });
    }
  });

  router.put('/pipeline-config', (req, res) => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const storeId = body.store_id ?? body.storeId ?? 'default';
      const hasMenuCatalog = Object.prototype.hasOwnProperty.call(body, 'menu_catalog');
      const hasAllowedMods = Object.prototype.hasOwnProperty.call(body, 'allowed_mods');
      if (!hasMenuCatalog && !hasAllowedMods) {
        res.status(400).json({ error: 'menu_catalog or allowed_mods is required' });
        return;
      }
      const config = services.storeConfigService.updateConfig(storeId, {
        menu_catalog: hasMenuCatalog ? body.menu_catalog : undefined,
        allowed_mods: hasAllowedMods ? body.allowed_mods : undefined,
      });
      res.status(200).json(config);
    } catch (error) {
      const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : 'failed to update pipeline config';
      res.status(400).json({ error: message });
    }
  });

  router.get('/llm-config', (req, res) => {
    try {
      const storeId = req.query?.store_id ?? req.query?.storeId ?? 'default';
      const config = services.storeConfigService.getLlmConfig(storeId);
      res.status(200).json(config);
    } catch (error) {
      console.error('[orders.llm-config.get] error', error);
      res.status(500).json({ error: 'failed to load llm config' });
    }
  });

  router.put('/llm-config', (req, res) => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const storeId = body.store_id ?? body.storeId ?? 'default';
      const hasLlmConfig = Object.prototype.hasOwnProperty.call(body, 'llm_config');
      if (!hasLlmConfig) {
        res.status(400).json({ error: 'llm_config is required' });
        return;
      }
      const config = services.storeConfigService.updateLlmConfig(storeId, {
        llm_config: body.llm_config,
      });
      res.status(200).json(config);
    } catch (error) {
      const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : 'failed to update llm config';
      res.status(400).json({ error: message });
    }
  });

  router.get('/ingest-engine/status', (req, res) => {
    try {
      const storeId = req.query?.store_id ?? req.query?.storeId ?? 'default';
      const config = services.storeConfigService.getConfig(storeId);
      const review = services.reviewService.listReview({ page: 1, pageSize: 200 });
      const reviewQueue = services.auditStore.listReviewQueue({ limit: 10, unresolvedOnly: true });
      const preview = getMenuCatalogPreview(config.menu_catalog, 10);
      const llmRuntime = getPythonLlmRuntime(services.storeConfigService.getLlmRuntimeConfig(storeId));
      res.status(200).json({
        api_version: API_CONTRACT_VERSION,
        store_id: config.store_id,
        python_ingest_enabled: isPythonIngestEnabled(),
        python_defaults: {
          python_bin: PYTHON_INGEST_DEFAULTS.pythonBin,
          timeout_ms: PYTHON_INGEST_DEFAULTS.timeoutMs,
          script_path: PYTHON_INGEST_DEFAULTS.scriptPath,
        },
        llm_runtime: llmRuntime,
        menu_catalog_version: config.menu_catalog_version,
        allowed_mods_version: config.allowed_mods_version,
        llm_config_version: config.llm_config_version,
        menu_item_count: getMenuCatalogCount(config.menu_catalog),
        allowed_mods_count: Array.isArray(config.allowed_mods) ? config.allowed_mods.length : 0,
        menu_preview: preview,
        review_queue_summary: {
          pending_review_count: Array.isArray(review.pendingReview) ? review.pendingReview.length : 0,
          tracking_count: Array.isArray(review.tracking) ? review.tracking.length : 0,
          unresolved_trace_count: Array.isArray(reviewQueue) ? reviewQueue.length : 0,
          latest_unresolved_order_ids: Array.isArray(reviewQueue)
            ? reviewQueue.map((entry) => normalizeText(entry.order_id)).filter(Boolean).slice(0, 8)
            : [],
        },
        stores: services.storeConfigService.listStores(),
        loaded_at: config.loaded_at,
      });
    } catch (error) {
      console.error('[orders.ingest-engine.status] error', error);
      res.status(500).json({ error: 'failed to load ingest engine status' });
    }
  });

  router.get('/ingest-fixtures', (req, res) => {
    try {
      const fixtures = readReceiptFixtures();
      res.status(200).json({
        api_version: API_CONTRACT_VERSION,
        total: fixtures.length,
        fixtures,
      });
    } catch (error) {
      console.error('[orders.ingest-fixtures] error', error);
      res.status(500).json({ error: 'failed to load ingest fixtures' });
    }
  });

  router.post('/ingest-test-suite', async (req, res) => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const storeId = normalizeText(body.store_id ?? body.storeId, 'default');
      const selectedScenario = normalizeText(body.scenario);
      const maxCases = Math.min(50, Math.max(1, toPositiveInt(body.max_cases ?? body.maxCases, 6)));
      const injectDirty = toBool(body.inject_dirty ?? body.injectDirty, true);

      const fixtures = readReceiptFixtures()
        .filter((entry) => !selectedScenario || entry.scenario === selectedScenario)
        .slice(0, maxCases);

      const results = [];
      for (let index = 0; index < fixtures.length; index += 1) {
        const fixture = fixtures[index];
        const sourceText = injectDirty ? applyDirtyMutations(fixture.source_text, index) : fixture.source_text;
        const simulateTimeout = fixture.simulate?.llm_timeout === true;

        try {
          const ingestResponse = await services.ingestService.ingestPosText({
            api_version: API_CONTRACT_VERSION,
            source_text: sourceText,
            store_id: storeId,
            metadata: {
              source: 'ingest_test_suite',
              scenario: fixture.scenario,
              fixture_id: fixture.fixture_id,
              inject_dirty: injectDirty,
            },
            ...(simulateTimeout ? { simulate: { llm_timeout: true } } : {}),
          });

          const orderPayload = isObject(ingestResponse.order_payload) ? ingestResponse.order_payload : {};
          const order = isObject(orderPayload.order) ? orderPayload.order : {};
          const items = Array.isArray(order.items) ? order.items : [];
          const groups = Array.isArray(order.groups) ? order.groups : [];
          const needsReviewItems = items.filter((entry) => isObject(entry) && entry.needs_review === true).length;
          const needsReviewGroups = groups.filter((entry) => isObject(entry) && entry.needs_review === true).length;
          const pythonErrorCode = isObject(order.metadata) && isObject(order.metadata.python_error)
            ? normalizeText(order.metadata.python_error.code)
            : '';

          results.push({
            fixture_id: fixture.fixture_id,
            scenario: fixture.scenario,
            ingest_order_id: normalizeText(order.order_id),
            accepted: ingestResponse.accepted === true,
            status: normalizeText(ingestResponse.status),
            overall_needs_review: order.overall_needs_review === true,
            item_count: items.length,
            group_count: groups.length,
            needs_review_item_count: needsReviewItems,
            needs_review_group_count: needsReviewGroups,
            ingest_engine: isObject(order.metadata) ? normalizeText(order.metadata.ingest_engine, 'unknown') : 'unknown',
            fallback_reason: isObject(order.metadata)
              ? normalizeText(order.metadata.fallback_reason || pythonErrorCode, '')
              : pythonErrorCode,
            trace_id: normalizeText(ingestResponse.trace_id, normalizeText(orderPayload.audit_trace_id)),
          });
        } catch (error) {
          results.push({
            fixture_id: fixture.fixture_id,
            scenario: fixture.scenario,
            accepted: false,
            status: 'failed',
            overall_needs_review: true,
            item_count: 0,
            group_count: 0,
            needs_review_item_count: 0,
            needs_review_group_count: 0,
            ingest_engine: 'failed',
            fallback_reason: normalizeText(error?.code || error?.message, 'ingest_failed'),
            trace_id: '',
          });
        }
      }

      const okCount = results.filter((entry) => entry.accepted === true).length;
      const reviewCount = results.filter((entry) => entry.overall_needs_review === true).length;
      res.status(200).json({
        api_version: API_CONTRACT_VERSION,
        store_id: storeId,
        inject_dirty: injectDirty,
        selected_scenario: selectedScenario || null,
        total_cases: fixtures.length,
        accepted_cases: okCount,
        needs_review_cases: reviewCount,
        results,
      });
    } catch (error) {
      console.error('[orders.ingest-test-suite] error', error);
      res.status(500).json({ error: 'failed to run ingest test suite' });
    }
  });

  router.post('/review/decision', (req, res) => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const decisionRequest = {
        ...body,
        api_version: body.api_version ?? API_CONTRACT_VERSION,
        review_queue_status: body.review_queue_status ?? 'pending_review',
      };
      const validation = validateReviewRequest(decisionRequest);
      if (!validation.ok) {
        res.status(400).json({
          error: 'review decision validation failed',
          details: validation.errors,
        });
        return;
      }

      const response = services.reviewService.applyDecision(decisionRequest);
      res.status(200).json(response);
    } catch (error) {
      if (error?.code === 'ORDER_NOT_FOUND') {
        res.status(404).json({ error: 'order not found' });
        return;
      }
      if (error?.code === 'INVALID_PATCHED_ORDER_ID') {
        res.status(400).json({ error: 'patched_order.order_id must match request order_id' });
        return;
      }
      console.error('[orders.review.decision] error', error);
      res.status(500).json({ error: 'failed to apply review decision' });
    }
  });

  router.post('/review/clear-test-data', (req, res) => {
    try {
      const body = isObject(req.body) ? req.body : {};
      const scope = normalizeText(body.scope, 'test_only');
      const clearAll = scope === 'all';
      const result = services.reviewService.clearOrders({
        predicate: clearAll ? undefined : (record) => isReviewRecordTestData(record),
      });
      res.status(200).json({
        ok: true,
        scope: clearAll ? 'all' : 'test_only',
        deleted_count: result.deleted,
        remaining_count: result.remaining,
      });
    } catch (error) {
      console.error('[orders.review.clear-test-data] error', error);
      res.status(500).json({ error: 'failed to clear review test data' });
    }
  });

  router.get('/review/:orderId', (req, res) => {
    try {
      const orderId = normalizeText(req.params?.orderId);
      const detail = services.reviewService.getReviewDetail(orderId);
      if (!detail) {
        res.status(404).json({ error: 'order not found' });
        return;
      }
      res.status(200).json(detail);
    } catch (error) {
      console.error('[orders.review.detail] error', error);
      res.status(500).json({ error: 'failed to fetch review detail' });
    }
  });

  router.delete('/review/:orderId', (req, res) => {
    try {
      const orderId = normalizeText(req.params?.orderId);
      if (!orderId) {
        res.status(400).json({ error: 'order_id is required' });
        return;
      }
      const deleted = services.reviewService.deleteOrder(orderId);
      if (!deleted) {
        res.status(404).json({ error: 'order not found' });
        return;
      }
      res.status(200).json({ ok: true, order_id: orderId });
    } catch (error) {
      console.error('[orders.review.delete] error', error);
      res.status(500).json({ error: 'failed to delete review order' });
    }
  });

  return router;
}
