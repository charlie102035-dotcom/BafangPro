import { createHash } from 'node:crypto';

import { API_CONTRACT_VERSION } from '../pos_pipeline/schema.mjs';
import { parseLegacyDelimitedPayload } from './legacy_payload_parser.mjs';

const DEFAULT_CONFIG = {
  enabled: false,
  endpoint: '',
  store_id: 'default',
  poll_interval_ms: 8000,
  request_timeout_ms: 6000,
  max_orders_per_pull: 20,
  dedupe_window_ms: 1000 * 60 * 120,
};

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const clampInt = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const nowMs = () => Date.now();

const buildOrderFingerprint = (order) => {
  const key = JSON.stringify({
    order_no: order?.legacy_order_no ?? null,
    serial_nos: Array.isArray(order?.serial_nos) ? order.serial_nos : [],
    source_text: order?.source_text ?? '',
    line_count: order?.line_count ?? 0,
  });
  return createHash('sha1').update(key).digest('hex');
};

const normalizeConfig = (current, patch = {}) => {
  const next = {
    ...current,
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
    next.enabled = toBool(patch.enabled, current.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'endpoint')) {
    next.endpoint = normalizeText(patch.endpoint);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'store_id')) {
    next.store_id = normalizeText(patch.store_id, current.store_id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'storeId')) {
    next.store_id = normalizeText(patch.storeId, next.store_id);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'poll_interval_ms')) {
    next.poll_interval_ms = clampInt(patch.poll_interval_ms, current.poll_interval_ms, 2000, 120000);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'request_timeout_ms')) {
    next.request_timeout_ms = clampInt(patch.request_timeout_ms, current.request_timeout_ms, 1000, 60000);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'max_orders_per_pull')) {
    next.max_orders_per_pull = clampInt(patch.max_orders_per_pull, current.max_orders_per_pull, 1, 200);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'dedupe_window_ms')) {
    next.dedupe_window_ms = clampInt(patch.dedupe_window_ms, current.dedupe_window_ms, 60000, 1000 * 60 * 60 * 24);
  }

  return next;
};

const fetchTextWithTimeout = async ({ url, timeoutMs }) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, text/html, */*',
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      status_text: response.statusText,
      text,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

export class LegacyPosPullService {
  constructor({
    ingestService,
    config = {},
  } = {}) {
    if (!ingestService || typeof ingestService.ingestPosText !== 'function') {
      throw new TypeError('LegacyPosPullService requires ingestService.ingestPosText()');
    }

    this.ingestService = ingestService;
    this.config = normalizeConfig(DEFAULT_CONFIG, config);
    this.pollTimer = null;
    this.seenFingerprints = new Map();

    this.last_pull_at = null;
    this.last_success_at = null;
    this.last_error = null;
    this.last_summary = null;
  }

  getConfig() {
    return {
      ...this.config,
    };
  }

  updateConfig(patch = {}) {
    this.config = normalizeConfig(this.config, patch);
    if (this.config.enabled) {
      this.start();
    } else {
      this.stop();
    }
    return this.getConfig();
  }

  getStatus() {
    return {
      running: Boolean(this.pollTimer),
      config: this.getConfig(),
      dedupe_cache_size: this.seenFingerprints.size,
      last_pull_at: this.last_pull_at,
      last_success_at: this.last_success_at,
      last_error: this.last_error,
      last_summary: this.last_summary,
    };
  }

  start() {
    if (this.pollTimer) return;
    if (!this.config.enabled) return;
    this.pollTimer = setInterval(() => {
      this.pullNow({ reason: 'poll' }).catch((error) => {
        this.last_error = {
          message: error instanceof Error ? error.message : String(error),
          at: nowMs(),
        };
      });
    }, this.config.poll_interval_ms);
    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  stop() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  #cleanupDedupeCache() {
    const threshold = nowMs() - this.config.dedupe_window_ms;
    for (const [key, seenAt] of this.seenFingerprints.entries()) {
      if (seenAt < threshold) {
        this.seenFingerprints.delete(key);
      }
    }
  }

  async pullNow({ reason = 'manual', raw_payload = null } = {}) {
    this.last_pull_at = nowMs();
    this.last_error = null;
    this.#cleanupDedupeCache();

    let rawText = '';
    let fetchMeta = null;
    if (typeof raw_payload === 'string') {
      rawText = raw_payload;
      fetchMeta = { source: 'inline_payload', status: 200 };
    } else {
      if (!this.config.endpoint) {
        throw new Error('legacy pull endpoint is empty');
      }
      fetchMeta = await fetchTextWithTimeout({
        url: this.config.endpoint,
        timeoutMs: this.config.request_timeout_ms,
      });
      rawText = fetchMeta.text;
      if (!fetchMeta.ok) {
        throw new Error(`legacy endpoint http ${fetchMeta.status}`);
      }
    }

    const parsed = parseLegacyDelimitedPayload(rawText);
    const dryRun = reason === 'dry_run' || reason === 'preview';
    const acceptedOrders = [];
    const skippedOrders = [];
    const failedOrders = [];
    const previewOrders = [];

    const orders = parsed.orders.slice(0, this.config.max_orders_per_pull);
    for (const order of orders) {
      const fingerprint = buildOrderFingerprint(order);
      if (this.seenFingerprints.has(fingerprint)) {
        skippedOrders.push({
          legacy_order_no: order.legacy_order_no,
          reason: 'dedupe',
        });
        continue;
      }

      if (dryRun) {
        previewOrders.push({
          legacy_order_no: order.legacy_order_no,
          table_label: order.table_label,
          line_count: order.line_count,
          source_text: order.source_text,
        });
        continue;
      }

      try {
        const response = await this.ingestService.ingestPosText({
          api_version: API_CONTRACT_VERSION,
          source_text: order.source_text,
          store_id: this.config.store_id,
          metadata: {
            source: 'legacy_pos_pull',
            legacy_reason: reason,
            legacy_order_no: order.legacy_order_no,
            legacy_table_code: order.table_code,
            legacy_table_label: order.table_label,
            legacy_serial_nos: order.serial_nos,
            legacy_line_count: order.line_count,
          },
        });
        this.seenFingerprints.set(fingerprint, nowMs());
        acceptedOrders.push({
          legacy_order_no: order.legacy_order_no,
          ingest_order_id: response?.order_payload?.order?.order_id ?? null,
          overall_needs_review: response?.order_payload?.order?.overall_needs_review === true,
          line_count: order.line_count,
        });
      } catch (error) {
        failedOrders.push({
          legacy_order_no: order.legacy_order_no,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const summary = {
      reason,
      store_id: this.config.store_id,
      endpoint: this.config.endpoint || null,
      fetch_meta: fetchMeta,
      parsed_record_count: parsed.parsed_record_count,
      parsed_order_count: parsed.parsed_order_count,
      accepted_count: acceptedOrders.length,
      skipped_count: skippedOrders.length,
      failed_count: failedOrders.length,
      preview_count: previewOrders.length,
      accepted_orders: acceptedOrders,
      skipped_orders: skippedOrders,
      failed_orders: failedOrders,
      preview_orders: previewOrders,
      pulled_at: nowMs(),
      raw_sample: rawText.slice(0, 300),
    };

    if (!dryRun) {
      this.last_success_at = nowMs();
      this.last_summary = summary;
    }
    return summary;
  }

  previewParse({ raw_payload = '', reason = 'preview' } = {}) {
    const rawText = String(raw_payload ?? '');
    const parsed = parseLegacyDelimitedPayload(rawText);
    const orders = parsed.orders.slice(0, this.config.max_orders_per_pull).map((order) => ({
      legacy_order_no: order.legacy_order_no,
      table_label: order.table_label,
      table_code: order.table_code,
      serial_nos: order.serial_nos,
      line_count: order.line_count,
      source_text: order.source_text,
    }));
    return {
      reason,
      parsed_record_count: parsed.parsed_record_count,
      parsed_order_count: parsed.parsed_order_count,
      orders,
      raw_sample: rawText.slice(0, 300),
    };
  }
}

export const createLegacyPosPullService = (options = {}) => new LegacyPosPullService(options);
