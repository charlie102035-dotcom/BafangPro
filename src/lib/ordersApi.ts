export type OrdersReviewListItem = {
  id: string;
  status: string;
  createdAt: number | null;
  updatedAt: number | null;
  serviceMode: string | null;
};

export type OrdersReviewSnapshot = {
  pendingReview: OrdersReviewListItem[];
  tracking: OrdersReviewListItem[];
};

export type ReviewOrderDetail = {
  orderId: string;
  status: string;
  createdAt: number | null;
  updatedAt: number | null;
  sourceText: string;
  overallNeedsReview: boolean;
  lowConfidenceLineIndices: number[];
  orderPayload: JsonRecord;
};

export type IngestEngineStatus = {
  storeId: string;
  pythonIngestEnabled: boolean;
  pythonBin: string;
  timeoutMs: number;
  scriptPath: string;
  llmEnabled: boolean;
  llmProvider: string;
  llmModel: string;
  llmTimeoutS: number;
  llmBaseUrl: string;
  llmReason: string;
  menuCatalogVersion: string;
  allowedModsVersion: string;
  llmConfigVersion?: string;
  menuItemCount: number;
  allowedModsCount: number;
  menuPreview: Array<{ itemId: string; canonicalName: string }>;
  pendingReviewCount: number;
  trackingCount: number;
  unresolvedTraceCount: number;
  latestUnresolvedOrderIds: string[];
  loadedAt: string | null;
  stores: string[];
};

export type IngestFixture = {
  fixtureId: string;
  scenario: string;
  sourceText: string;
  simulateTimeout: boolean;
  expectedHighlight: string | null;
  expectedGroupingHint: string | null;
  requiresManualReview: boolean;
};

export type IngestSingleRunResult = {
  accepted: boolean;
  status: string;
  orderId: string;
  traceId: string;
  overallNeedsReview: boolean;
  itemCount: number;
  groupCount: number;
  needsReviewItemCount: number;
  needsReviewGroupCount: number;
  ingestEngine: string;
  fallbackReason: string | null;
  raw: unknown;
};

export type IngestSuiteResultItem = {
  fixtureId: string;
  scenario: string;
  accepted: boolean;
  status: string;
  ingestOrderId: string;
  traceId: string;
  overallNeedsReview: boolean;
  itemCount: number;
  groupCount: number;
  needsReviewItemCount: number;
  needsReviewGroupCount: number;
  ingestEngine: string;
  fallbackReason: string | null;
};

export type IngestSuiteResult = {
  storeId: string;
  injectDirty: boolean;
  selectedScenario: string | null;
  totalCases: number;
  acceptedCases: number;
  needsReviewCases: number;
  results: IngestSuiteResultItem[];
  raw: unknown;
};

type JsonRecord = Record<string, unknown>;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  notFoundMessage?: string;
  fallbackErrorMessage?: string;
};

export class OrdersApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OrdersApiError';
    this.status = status;
    this.code = code;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asString = (value: unknown, fallback = ''): string => asTrimmedString(value) ?? fallback;

const asTimestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return Math.floor(asNumber);
    const asDate = Date.parse(trimmed);
    if (Number.isFinite(asDate)) return Math.floor(asDate);
  }
  return null;
};

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const asIntArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.max(0, Math.round(entry)));
};

const pickFirstArray = (record: JsonRecord, keys: string[]): unknown[] | null => {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
};

const normalizeBucket = (value: string): 'pendingReview' | 'tracking' => {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes('track') ||
    normalized.includes('follow') ||
    normalized.includes('process') ||
    normalized.includes('progress')
  ) {
    return 'tracking';
  }
  if (normalized.includes('ready') || normalized.includes('done') || normalized.includes('packed')) {
    return 'tracking';
  }
  return 'pendingReview';
};

const normalizeStatusText = (value: unknown, fallback: string): string => {
  const text = asTrimmedString(value);
  return text ?? fallback;
};

const normalizeListItem = (
  value: unknown,
  fallbackStatus: string,
): OrdersReviewListItem | null => {
  if (!isRecord(value)) return null;
  const id = asTrimmedString(value.orderId)
    ?? asTrimmedString(value.order_id)
    ?? asTrimmedString(value.id);
  if (!id) return null;
  return {
    id,
    status: normalizeStatusText(
      value.status
        ?? value.reviewStatus
        ?? value.review_status
        ?? value.state,
      fallbackStatus,
    ),
    createdAt: asTimestamp(value.createdAt ?? value.created_at ?? value.timestamp),
    updatedAt: asTimestamp(value.updatedAt ?? value.updated_at),
    serviceMode: asTrimmedString(value.serviceMode ?? value.service_mode),
  };
};

const normalizeList = (
  value: unknown,
  fallbackStatus: string,
): OrdersReviewListItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeListItem(entry, fallbackStatus))
    .filter((entry): entry is OrdersReviewListItem => Boolean(entry));
};

const splitMixedList = (items: OrdersReviewListItem[]): OrdersReviewSnapshot => {
  const pendingReview: OrdersReviewListItem[] = [];
  const tracking: OrdersReviewListItem[] = [];
  items.forEach((item) => {
    if (normalizeBucket(item.status) === 'tracking') {
      tracking.push(item);
      return;
    }
    pendingReview.push(item);
  });
  return {
    pendingReview,
    tracking,
  };
};

const normalizeReviewPayload = (payload: unknown): OrdersReviewSnapshot | null => {
  if (Array.isArray(payload)) {
    return splitMixedList(normalizeList(payload, 'pending_review'));
  }
  if (!isRecord(payload)) return null;

  const pendingRaw = pickFirstArray(payload, [
    'pendingReview',
    'pending_review',
    'pending',
    'awaitingReview',
    'awaiting_review',
    'reviewQueue',
  ]);
  const trackingRaw = pickFirstArray(payload, [
    'tracking',
    'trackingOrders',
    'tracking_orders',
    'inTracking',
    'followUp',
    'follow_up',
  ]);

  if (pendingRaw || trackingRaw) {
    return {
      pendingReview: normalizeList(pendingRaw, 'pending_review'),
      tracking: normalizeList(trackingRaw, 'tracking'),
    };
  }

  if (isRecord(payload.data)) {
    return normalizeReviewPayload(payload.data);
  }

  const mixedRaw = pickFirstArray(payload, ['items', 'orders', 'list', 'data']);
  if (mixedRaw) {
    return splitMixedList(normalizeList(mixedRaw, 'pending_review'));
  }

  return null;
};

const readJsonPayload = async (response: Response): Promise<unknown> =>
  response.json().catch(() => ({}));

const request = async (path: string, options: RequestOptions = {}): Promise<unknown> => {
  const method = options.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new OrdersApiError('無法連線訂單服務，請稍後再試', 0, 'NETWORK_ERROR');
  }

  const payload = await readJsonPayload(response);
  if (response.ok) return payload;

  const message = isRecord(payload) && typeof payload.error === 'string'
    ? payload.error
    : response.status === 404
      ? (options.notFoundMessage ?? '找不到訂單審核 API')
      : (options.fallbackErrorMessage ?? '讀取訂單清單失敗');
  const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined;
  throw new OrdersApiError(message, response.status, code);
};

const normalizeIngestSingleRun = (payload: unknown): IngestSingleRunResult => {
  const record = isRecord(payload) ? payload : {};
  const orderPayload = isRecord(record.order_payload) ? record.order_payload : {};
  const order = isRecord(orderPayload.order) ? orderPayload.order : {};
  const items = Array.isArray(order.items) ? order.items : [];
  const groups = Array.isArray(order.groups) ? order.groups : [];
  const needsReviewItemCount = items.filter((entry) => isRecord(entry) && entry.needs_review === true).length;
  const needsReviewGroupCount = groups.filter((entry) => isRecord(entry) && entry.needs_review === true).length;
  const metadata = isRecord(order.metadata) ? order.metadata : {};
  const pythonError = isRecord(metadata.python_error) ? metadata.python_error : {};
  const fallbackReason = asTrimmedString(metadata.fallback_reason) ?? asTrimmedString(pythonError.code);

  return {
    accepted: record.accepted === true,
    status: asString(record.status, 'unknown'),
    orderId: asString(order.order_id, ''),
    traceId: asString(record.trace_id ?? orderPayload.audit_trace_id, ''),
    overallNeedsReview: order.overall_needs_review === true,
    itemCount: items.length,
    groupCount: groups.length,
    needsReviewItemCount,
    needsReviewGroupCount,
    ingestEngine: asString(metadata.ingest_engine, 'unknown'),
    fallbackReason,
    raw: payload,
  };
};

const normalizeFixtures = (payload: unknown): IngestFixture[] => {
  if (!isRecord(payload) || !Array.isArray(payload.fixtures)) return [];
  return payload.fixtures
    .filter((entry) => isRecord(entry))
    .map((entry, index) => ({
      fixtureId: asString(entry.fixture_id, `fixture-${index + 1}`),
      scenario: asString(entry.scenario, `scenario-${index + 1}`),
      sourceText: asString(entry.source_text, ''),
      simulateTimeout: isRecord(entry.simulate) && entry.simulate.llm_timeout === true,
      expectedHighlight: asTrimmedString(entry.expected_highlight),
      expectedGroupingHint: asTrimmedString(entry.expected_grouping_hint),
      requiresManualReview: entry.requires_manual_review === true,
    }))
    .filter((entry) => entry.sourceText.length > 0);
};

const normalizeIngestEngineStatus = (payload: unknown): IngestEngineStatus => {
  const record = isRecord(payload) ? payload : {};
  const defaults = isRecord(record.python_defaults) ? record.python_defaults : {};
  const llmRuntime = isRecord(record.llm_runtime) ? record.llm_runtime : {};
  const reviewSummary = isRecord(record.review_queue_summary) ? record.review_queue_summary : {};
  const menuPreviewRaw = Array.isArray(record.menu_preview) ? record.menu_preview : [];
  const menuPreview = menuPreviewRaw
    .filter((entry) => isRecord(entry))
    .map((entry) => ({
      itemId: asString(entry.item_id, ''),
      canonicalName: asString(entry.canonical_name, ''),
    }))
    .filter((entry) => entry.itemId || entry.canonicalName);
  const stores = Array.isArray(record.stores)
    ? record.stores.map((entry) => asString(entry)).filter((entry) => entry.length > 0)
    : [];

  return {
    storeId: asString(record.store_id, 'default'),
    pythonIngestEnabled: record.python_ingest_enabled === true,
    pythonBin: asString(defaults.python_bin, ''),
    timeoutMs: Math.max(0, Math.round(asNumber(defaults.timeout_ms, 0))),
    scriptPath: asString(defaults.script_path, ''),
    llmEnabled: llmRuntime.enabled === true,
    llmProvider: asString(llmRuntime.provider, ''),
    llmModel: asString(llmRuntime.model, ''),
    llmTimeoutS: Math.max(0, asNumber(llmRuntime.timeout_s, 0)),
    llmBaseUrl: asString(llmRuntime.base_url, ''),
    llmReason: asString(llmRuntime.reason, ''),
    menuCatalogVersion: asString(record.menu_catalog_version, ''),
    allowedModsVersion: asString(record.allowed_mods_version, ''),
    llmConfigVersion: asTrimmedString(record.llm_config_version) ?? undefined,
    menuItemCount: Math.max(0, Math.round(asNumber(record.menu_item_count, 0))),
    allowedModsCount: Math.max(0, Math.round(asNumber(record.allowed_mods_count, 0))),
    menuPreview,
    pendingReviewCount: Math.max(0, Math.round(asNumber(reviewSummary.pending_review_count, 0))),
    trackingCount: Math.max(0, Math.round(asNumber(reviewSummary.tracking_count, 0))),
    unresolvedTraceCount: Math.max(0, Math.round(asNumber(reviewSummary.unresolved_trace_count, 0))),
    latestUnresolvedOrderIds: Array.isArray(reviewSummary.latest_unresolved_order_ids)
      ? reviewSummary.latest_unresolved_order_ids
        .map((entry) => asString(entry))
        .filter((entry) => entry.length > 0)
      : [],
    loadedAt: asTrimmedString(record.loaded_at),
    stores,
  };
};

const normalizeIngestSuiteResult = (payload: unknown): IngestSuiteResult => {
  const record = isRecord(payload) ? payload : {};
  const resultsRaw = Array.isArray(record.results) ? record.results : [];
  const results = resultsRaw
    .filter((entry) => isRecord(entry))
    .map((entry, index) => ({
      fixtureId: asString(entry.fixture_id, `fixture-${index + 1}`),
      scenario: asString(entry.scenario, `scenario-${index + 1}`),
      accepted: entry.accepted === true,
      status: asString(entry.status, 'unknown'),
      ingestOrderId: asString(entry.ingest_order_id, ''),
      traceId: asString(entry.trace_id, ''),
      overallNeedsReview: entry.overall_needs_review === true,
      itemCount: Math.max(0, Math.round(asNumber(entry.item_count, 0))),
      groupCount: Math.max(0, Math.round(asNumber(entry.group_count, 0))),
      needsReviewItemCount: Math.max(0, Math.round(asNumber(entry.needs_review_item_count, 0))),
      needsReviewGroupCount: Math.max(0, Math.round(asNumber(entry.needs_review_group_count, 0))),
      ingestEngine: asString(entry.ingest_engine, 'unknown'),
      fallbackReason: asTrimmedString(entry.fallback_reason),
    }));

  return {
    storeId: asString(record.store_id, 'default'),
    injectDirty: record.inject_dirty !== false,
    selectedScenario: asTrimmedString(record.selected_scenario),
    totalCases: Math.max(0, Math.round(asNumber(record.total_cases, results.length))),
    acceptedCases: Math.max(0, Math.round(asNumber(record.accepted_cases, results.filter((entry) => entry.accepted).length))),
    needsReviewCases: Math.max(
      0,
      Math.round(asNumber(record.needs_review_cases, results.filter((entry) => entry.overallNeedsReview).length)),
    ),
    results,
    raw: payload,
  };
};

const normalizeReviewDetailsPayload = (payload: unknown): ReviewOrderDetail[] => {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  return payload.items
    .filter((entry) => isRecord(entry))
    .map((entry) => {
      const orderPayload = isRecord(entry.order_payload) ? entry.order_payload : {};
      const order = isRecord(orderPayload.order) ? orderPayload.order : {};
      return {
        orderId: asString(entry.order_id, ''),
        status: asString(entry.review_queue_status, 'pending_review'),
        createdAt: asTimestamp(entry.created_at_ms ?? entry.created_at),
        updatedAt: asTimestamp(entry.updated_at_ms ?? entry.updated_at),
        sourceText: asString(entry.source_text ?? order.source_text, ''),
        overallNeedsReview: entry.overall_needs_review === true,
        lowConfidenceLineIndices: asIntArray(entry.low_confidence_line_indices),
        orderPayload,
      };
    })
    .filter((entry) => entry.orderId.length > 0);
};

export const ordersApi = {
  async getReviewSnapshot(): Promise<OrdersReviewSnapshot> {
    const handleFallback = async (): Promise<OrdersReviewSnapshot> => {
      const fallbackPayload = await request('/api/orders');
      const fallbackNormalized = normalizeReviewPayload(fallbackPayload);
      if (fallbackNormalized) return fallbackNormalized;
      return {
        pendingReview: [],
        tracking: [],
      };
    };

    let reviewPayload: unknown | null = null;
    try {
      reviewPayload = await request('/api/orders/review');
    } catch (error) {
      if (error instanceof OrdersApiError && error.status === 404) {
        return handleFallback();
      }
      throw error;
    }

    const normalized = normalizeReviewPayload(reviewPayload);
    if (normalized) return normalized;
    return handleFallback();
  },

  async getReviewDetails(input?: {
    page?: number;
    pageSize?: number;
  }): Promise<ReviewOrderDetail[]> {
    const page = Math.max(1, Math.round(input?.page ?? 1));
    const pageSize = Math.max(1, Math.min(500, Math.round(input?.pageSize ?? 200)));
    const payload = await request(`/api/orders/review/details?page=${page}&page_size=${pageSize}`, {
      fallbackErrorMessage: '讀取待確認訂單失敗',
      notFoundMessage: '找不到待確認訂單 API',
    });
    return normalizeReviewDetailsPayload(payload);
  },

  async deleteReviewOrder(orderId: string): Promise<{ ok: boolean }> {
    const normalized = orderId.trim();
    if (!normalized) throw new OrdersApiError('缺少訂單編號', 400, 'INVALID_ORDER_ID');
    await request(`/api/orders/review/${encodeURIComponent(normalized)}`, {
      method: 'DELETE',
      fallbackErrorMessage: '刪除待確認訂單失敗',
      notFoundMessage: '找不到待確認訂單 API',
    });
    return { ok: true };
  },

  async clearReviewTestData(scope: 'test_only' | 'all' = 'test_only'): Promise<{
    ok: boolean;
    deletedCount: number;
    remainingCount: number;
    scope: 'test_only' | 'all';
  }> {
    const payload = await request('/api/orders/review/clear-test-data', {
      method: 'POST',
      body: {
        scope,
      },
      fallbackErrorMessage: '清空測試資料失敗',
      notFoundMessage: '找不到清空測試資料 API',
    });
    const record = isRecord(payload) ? payload : {};
    const resolvedScope = asString(record.scope, scope) === 'all' ? 'all' : 'test_only';
    return {
      ok: record.ok === true,
      deletedCount: Math.max(0, Math.round(asNumber(record.deleted_count, 0))),
      remainingCount: Math.max(0, Math.round(asNumber(record.remaining_count, 0))),
      scope: resolvedScope,
    };
  },

  async getIngestEngineStatus(storeId: string): Promise<IngestEngineStatus> {
    const path = `/api/orders/ingest-engine/status?store_id=${encodeURIComponent(storeId || 'default')}`;
    const payload = await request(path, {
      fallbackErrorMessage: '讀取進單引擎狀態失敗',
      notFoundMessage: '找不到進單引擎狀態 API',
    });
    return normalizeIngestEngineStatus(payload);
  },

  async getIngestFixtures(): Promise<IngestFixture[]> {
    const payload = await request('/api/orders/ingest-fixtures', {
      fallbackErrorMessage: '讀取進單測試樣本失敗',
      notFoundMessage: '找不到進單測試樣本 API',
    });
    return normalizeFixtures(payload);
  },

  async ingestPosText(input: {
    sourceText: string;
    storeId: string;
    simulateTimeout?: boolean;
    metadata?: JsonRecord;
  }): Promise<IngestSingleRunResult> {
    const payload = await request('/api/orders/ingest-pos-text', {
      method: 'POST',
      body: {
        api_version: '1.1.0',
        source_text: input.sourceText,
        store_id: input.storeId,
        metadata: isRecord(input.metadata) ? input.metadata : {},
        ...(input.simulateTimeout ? { simulate: { llm_timeout: true } } : {}),
      },
      fallbackErrorMessage: '送單到進單引擎失敗',
      notFoundMessage: '找不到進單 API',
    });
    return normalizeIngestSingleRun(payload);
  },

  async runIngestTestSuite(input: {
    storeId: string;
    injectDirty: boolean;
    maxCases: number;
    scenario?: string;
  }): Promise<IngestSuiteResult> {
    const payload = await request('/api/orders/ingest-test-suite', {
      method: 'POST',
      body: {
        store_id: input.storeId,
        inject_dirty: input.injectDirty,
        max_cases: input.maxCases,
        ...(input.scenario ? { scenario: input.scenario } : {}),
      },
      fallbackErrorMessage: '執行髒資料測試失敗',
      notFoundMessage: '找不到髒資料測試 API',
    });
    return normalizeIngestSuiteResult(payload);
  },

  async getLlmConfig(storeId: string): Promise<{
    storeId: string;
    llmConfig: {
      provider: string;
      model: string;
      timeoutS: number;
      enabled: boolean | null;
      hasApiKey: boolean;
      apiKeyRedacted: string | null;
    };
    llmConfigVersion: string;
  }> {
    const path = `/api/orders/llm-config?store_id=${encodeURIComponent(storeId || 'default')}`;
    const payload = await request(path, {
      fallbackErrorMessage: '讀取 LLM 設定失敗',
      notFoundMessage: '找不到 LLM 設定 API',
    });
    const record = isRecord(payload) ? payload : {};
    const llmConfig = isRecord(record.llm_config) ? record.llm_config : {};
    return {
      storeId: asString(record.store_id, 'default'),
      llmConfig: {
        provider: asString(llmConfig.provider, 'openai'),
        model: asString(llmConfig.model, 'gpt-4o-mini'),
        timeoutS: Math.max(0, asNumber(llmConfig.timeout_s, 15)),
        enabled: typeof llmConfig.enabled === 'boolean' ? llmConfig.enabled : null,
        hasApiKey: llmConfig.has_api_key === true,
        apiKeyRedacted: asTrimmedString(llmConfig.api_key_redacted),
      },
      llmConfigVersion: asString(record.llm_config_version, ''),
    };
  },

  async updateLlmConfig(input: {
    storeId: string;
    llmConfig: {
      provider?: string;
      model?: string;
      timeoutS?: number;
      enabled?: boolean;
      apiKey?: string;
    };
  }): Promise<{ ok: boolean }> {
    await request('/api/orders/llm-config', {
      method: 'PUT',
      body: {
        store_id: input.storeId,
        llm_config: {
          ...(typeof input.llmConfig.provider === 'string' ? { provider: input.llmConfig.provider } : {}),
          ...(typeof input.llmConfig.model === 'string' ? { model: input.llmConfig.model } : {}),
          ...(typeof input.llmConfig.timeoutS === 'number' ? { timeout_s: input.llmConfig.timeoutS } : {}),
          ...(typeof input.llmConfig.enabled === 'boolean' ? { enabled: input.llmConfig.enabled } : {}),
          ...(typeof input.llmConfig.apiKey === 'string' ? { api_key: input.llmConfig.apiKey } : {}),
        },
      },
      fallbackErrorMessage: '更新 LLM 設定失敗',
      notFoundMessage: '找不到 LLM 設定 API',
    });
    return { ok: true };
  },
};
