import { useEffect, useMemo, useState } from 'react';

import {
  OrdersApiError,
  ordersApi,
  type IngestEngineStatus,
  type ReviewOrderDetail,
} from '../lib/ordersApi';

type IngestItemResolution = {
  mappedName?: string | null;
  menuItemId?: string | null;
  soldOut?: boolean;
  soldOutReason?: string | null;
};

type IngestEnginePanelProps = {
  storeId: string;
  onDispatchReviewOrder?: (
    orderPayload: unknown,
    context: { reviewOrderId: string },
  ) => Promise<{ ok: boolean; message: string; systemOrderId?: string }> | { ok: boolean; message: string; systemOrderId?: string };
  onEditReviewOrder?: (
    orderPayload: unknown,
    context: { reviewOrderId: string },
  ) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onResolveIngestItem?: (itemPayload: Record<string, unknown>) => IngestItemResolution;
  externalNotifications?: Array<{
    id: string;
    sourceOrderId: string;
    systemOrderId: string;
    createdAt: number;
  }>;
};

type PendingReason = 'low_confidence' | 'sold_out';

type PendingLine = {
  lineIndex: number;
  rawLine: string;
  normalized: string;
  qty: number;
  confidenceItem: number | null;
  lowConfidence: boolean;
  soldOut: boolean;
  soldOutReason: string | null;
};

type PendingOrderView = {
  orderId: string;
  sourceText: string;
  reasons: PendingReason[];
  lines: PendingLine[];
  detail: ReviewOrderDetail;
  llmUsed: boolean;
  orderConfidence: number | null;
};

type ActionKind = 'editing' | 'accepting' | 'rejecting';

type NotificationItem = {
  id: string;
  sourceOrderId: string;
  systemOrderId: string;
  createdAt: number;
  source: 'local' | 'server' | 'app';
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asText = (value: unknown, fallback = ''): string => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const asNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const toMessage = (error: unknown, fallback: string) =>
  error instanceof OrdersApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : fallback;

const pretty = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
};

const formatClock = (value: number | null) =>
  value
    ? new Date(value).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

const TRACKING_STATUSES = new Set([
  'approved',
  'rejected',
  'dispatch_ready',
  'dispatched',
  'dispatch_failed',
  'tracking',
]);

const panelCardClass =
  'bafang-surface-card bafang-enter rounded-3xl border p-4 shadow-md shadow-slate-900/5 sm:p-5';
const actionButtonBase =
  'bafang-action inline-flex min-h-9 items-center justify-center rounded-xl px-3 text-xs font-semibold transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:cursor-not-allowed disabled:opacity-50';
const inputBaseClass =
  'mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-amber-400 focus:outline-none';

const buildPendingOrderView = (
  detail: ReviewOrderDetail,
  resolver?: (itemPayload: Record<string, unknown>) => IngestItemResolution,
): PendingOrderView | null => {
  const orderPayload = isRecord(detail.orderPayload) ? detail.orderPayload : {};
  const order = isRecord(orderPayload.order) ? orderPayload.order : {};
  const orderMetadata = isRecord(order.metadata) ? order.metadata : {};
  const structuredMeta = isRecord(orderMetadata.structured_result_metadata)
    ? orderMetadata.structured_result_metadata
    : {};
  const llmUsedByFlag = orderMetadata.llm_used === true;
  const llmAttemptsRaw = asNumber(structuredMeta.llm_attempts);
  const llmFallbackReason = asText(structuredMeta.fallback_reason);
  const llmUsed = llmUsedByFlag || (llmAttemptsRaw !== null && llmAttemptsRaw > 0 && !llmFallbackReason);
  const items = Array.isArray(order.items) ? order.items : [];
  const linesRaw = Array.isArray(order.lines) ? order.lines : [];

  const rawLineByIndex = new Map<number, string>();
  linesRaw.forEach((line) => {
    if (!isRecord(line)) return;
    const lineIndex = asNumber(line.line_index);
    if (lineIndex === null) return;
    const rounded = Math.max(0, Math.round(lineIndex));
    const rawLine = asText(line.raw_line);
    if (!rawLine) return;
    rawLineByIndex.set(rounded, rawLine);
  });

  const lineViews: PendingLine[] = items
    .map((entry, fallbackIndex) => {
      if (!isRecord(entry)) return null;
      const lineIndexRaw = asNumber(entry.line_index);
      const lineIndex = lineIndexRaw === null ? fallbackIndex : Math.max(0, Math.round(lineIndexRaw));
      const rawLine = asText(entry.raw_line, asText(entry.name_raw, rawLineByIndex.get(lineIndex) ?? `line #${lineIndex}`));
      const confidenceItem = asNumber(entry.confidence_item);
      const qtyRaw = asNumber(entry.qty);
      const qty = qtyRaw === null ? 1 : Math.max(1, Math.round(qtyRaw));
      const itemCode = asText(entry.item_code);
      const resolved = resolver ? resolver(entry) : {};
      const normalized = asText(
        resolved.mappedName,
        asText(entry.name_normalized, asText(entry.name_raw, itemCode || rawLine)),
      );
      const lowConfidence = entry.needs_review === true
        || itemCode.length === 0
        || (confidenceItem !== null && confidenceItem < 0.85);
      const soldOut = resolved.soldOut === true;
      const soldOutReason = soldOut ? asText(resolved.soldOutReason, '已售完') : null;
      return {
        lineIndex,
        rawLine,
        normalized,
        qty,
        confidenceItem,
        lowConfidence,
        soldOut,
        soldOutReason,
      } satisfies PendingLine;
    })
    .filter((entry): entry is PendingLine => Boolean(entry));

  const lowConfidenceBySummary = detail.lowConfidenceLineIndices.length > 0 || detail.overallNeedsReview;
  const lowConfidenceByItems = lineViews.some((line) => line.lowConfidence);
  const soldOutByItems = lineViews.some((line) => line.soldOut);

  const reasons: PendingReason[] = [];
  if (lowConfidenceBySummary || lowConfidenceByItems) reasons.push('low_confidence');
  if (soldOutByItems) reasons.push('sold_out');
  if (reasons.length === 0) return null;

  const sourceText = asText(order.source_text, detail.sourceText);
  const fallbackSourceText = sourceText || lineViews.map((line) => line.rawLine).join('\n');

  const orderConfidenceRaw = asNumber(order.order_confidence);
  const orderConfidence = orderConfidenceRaw !== null && orderConfidenceRaw >= 0 && orderConfidenceRaw <= 1
    ? orderConfidenceRaw
    : null;

  return {
    orderId: detail.orderId,
    sourceText: fallbackSourceText,
    reasons,
    lines: lineViews,
    detail,
    llmUsed,
    orderConfidence,
  };
};

function IngestEnginePanel({
  storeId,
  onDispatchReviewOrder,
  onEditReviewOrder,
  onResolveIngestItem,
  externalNotifications,
}: IngestEnginePanelProps) {
  const [status, setStatus] = useState<IngestEngineStatus | null>(null);
  const [reviewOrders, setReviewOrders] = useState<ReviewOrderDetail[]>([]);

  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [llmConfig, setLlmConfig] = useState<{
    loaded: boolean;
    provider: string;
    model: string;
    timeoutS: string;
    enabled: boolean;
    apiKey: string;
    apiKeyRedacted: string | null;
    saving: boolean;
    error: string | null;
    okMessage: string | null;
  }>({
    loaded: false,
    provider: 'openai',
    model: 'gpt-4o-mini',
    timeoutS: '15',
    enabled: true,
    apiKey: '',
    apiKeyRedacted: null,
    saving: false,
    error: null,
    okMessage: null,
  });

  const [apiHelperMessage, setApiHelperMessage] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [actionByOrderId, setActionByOrderId] = useState<Record<string, ActionKind | null>>({});
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [clearingTestData, setClearingTestData] = useState(false);

  const setOrderAction = (orderId: string, action: ActionKind | null) => {
    setActionByOrderId((prev) => ({
      ...prev,
      [orderId]: action,
    }));
  };

  const pushNotification = (sourceOrderId: string, systemOrderId: string) => {
    const safeSourceOrderId = sourceOrderId.trim() || 'unknown-source';
    const safeSystemOrderId = systemOrderId.trim() || safeSourceOrderId;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextItem: NotificationItem = {
      id: token,
      sourceOrderId: safeSourceOrderId,
      systemOrderId: safeSystemOrderId,
      createdAt: Date.now(),
      source: 'local',
    };
    setNotifications((prev) => [
      nextItem,
      ...prev,
    ].slice(0, 30));
  };

  const loadStatus = async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const next = await ordersApi.getIngestEngineStatus(storeId);
      setStatus(next);
    } catch (error) {
      setStatusError(toMessage(error, '讀取引擎狀態失敗'));
    } finally {
      setLoadingStatus(false);
    }
  };

  const loadReviewOrders = async () => {
    setLoadingReview(true);
    setReviewError(null);
    try {
      const next = await ordersApi.getReviewDetails({ pageSize: 300 });
      setReviewOrders(next);
    } catch (error) {
      setReviewError(toMessage(error, '讀取待確認訂單失敗'));
    } finally {
      setLoadingReview(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadingStatus(true);
      setStatusError(null);
      try {
        const next = await ordersApi.getIngestEngineStatus(storeId);
        if (cancelled) return;
        setStatus(next);
      } catch (error) {
        if (!cancelled) {
          setStatusError(toMessage(error, '讀取引擎狀態失敗'));
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await ordersApi.getLlmConfig(storeId);
        if (cancelled) return;
        setLlmConfig((prev) => ({
          ...prev,
          loaded: true,
          provider: result.llmConfig.provider || 'openai',
          model: result.llmConfig.model || 'gpt-4o-mini',
          timeoutS: String(result.llmConfig.timeoutS || 15),
          enabled: result.llmConfig.enabled ?? true,
          apiKey: '',
          apiKeyRedacted: result.llmConfig.apiKeyRedacted,
          error: null,
        }));
      } catch (error) {
        if (!cancelled) {
          setLlmConfig((prev) => ({
            ...prev,
            loaded: true,
            error: toMessage(error, '讀取 AI 設定失敗'),
          }));
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadingReview(true);
      setReviewError(null);
      try {
        const next = await ordersApi.getReviewDetails({ pageSize: 300 });
        if (cancelled) return;
        setReviewOrders(next);
      } catch (error) {
        if (!cancelled) {
          setReviewError(toMessage(error, '讀取待確認訂單失敗'));
        }
      } finally {
        if (!cancelled) {
          setLoadingReview(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  const saveLlmConfig = async () => {
    setLlmConfig((prev) => ({
      ...prev,
      saving: true,
      error: null,
      okMessage: null,
    }));

    try {
      const timeoutParsed = Number(llmConfig.timeoutS);
      const timeoutS = Number.isFinite(timeoutParsed) ? Math.max(2, Math.min(60, Math.round(timeoutParsed))) : 15;
      await ordersApi.updateLlmConfig({
        storeId,
        llmConfig: {
          provider: llmConfig.provider,
          model: llmConfig.model,
          timeoutS,
          enabled: llmConfig.enabled,
          ...(llmConfig.apiKey.trim() ? { apiKey: llmConfig.apiKey.trim() } : {}),
        },
      });

      const result = await ordersApi.getLlmConfig(storeId);
      setLlmConfig((prev) => ({
        ...prev,
        saving: false,
        apiKey: '',
        apiKeyRedacted: result.llmConfig.apiKeyRedacted,
        okMessage: '已儲存 AI 設定。',
      }));
      await loadStatus();
    } catch (error) {
      setLlmConfig((prev) => ({
        ...prev,
        saving: false,
        error: toMessage(error, '儲存 AI 設定失敗'),
      }));
    }
  };

  const clearLlmApiKey = async () => {
    setLlmConfig((prev) => ({
      ...prev,
      saving: true,
      error: null,
      okMessage: null,
    }));

    try {
      await ordersApi.updateLlmConfig({
        storeId,
        llmConfig: {
          apiKey: '',
        },
      });
      setLlmConfig((prev) => ({
        ...prev,
        saving: false,
        apiKey: '',
        apiKeyRedacted: null,
        okMessage: '已清除儲存的 API key。',
      }));
      await loadStatus();
    } catch (error) {
      setLlmConfig((prev) => ({
        ...prev,
        saving: false,
        error: toMessage(error, '清除 API key 失敗'),
      }));
    }
  };

  const clearTestData = async () => {
    setClearingTestData(true);
    setOperationMessage(null);
    try {
      const result = await ordersApi.clearReviewTestData('all');
      setOperationMessage({
        ok: true,
        text: `已清空測試資料，刪除 ${result.deletedCount} 筆。`,
      });
      await Promise.all([loadReviewOrders(), loadStatus()]);
    } catch (error) {
      setOperationMessage({
        ok: false,
        text: toMessage(error, '清空測試資料失敗'),
      });
    } finally {
      setClearingTestData(false);
    }
  };

  const handleEditOrder = async (order: PendingOrderView) => {
    if (!onEditReviewOrder) {
      setOperationMessage({ ok: false, text: '尚未設定修單導向 callback。' });
      return;
    }
    setOrderAction(order.orderId, 'editing');
    setOperationMessage(null);
    try {
      const result = await onEditReviewOrder(order.detail.orderPayload, {
        reviewOrderId: order.orderId,
      });
      setOperationMessage({
        ok: result.ok,
        text: result.message,
      });
    } catch (error) {
      setOperationMessage({
        ok: false,
        text: toMessage(error, '載入修單畫面失敗'),
      });
    } finally {
      setOrderAction(order.orderId, null);
    }
  };

  const handleAcceptOrder = async (order: PendingOrderView) => {
    if (!onDispatchReviewOrder) {
      setOperationMessage({ ok: false, text: '尚未設定進單 callback。' });
      return;
    }
    setOrderAction(order.orderId, 'accepting');
    setOperationMessage(null);
    try {
      const dispatchResult = await onDispatchReviewOrder(order.detail.orderPayload, {
        reviewOrderId: order.orderId,
      });
      if (!dispatchResult.ok) {
        setOperationMessage({
          ok: false,
          text: dispatchResult.message,
        });
        return;
      }

      await ordersApi.deleteReviewOrder(order.orderId);
      const systemOrderId = dispatchResult.systemOrderId?.trim() || order.orderId;
      pushNotification(order.orderId, systemOrderId);
      setOperationMessage({
        ok: true,
        text: `已進單：${systemOrderId}`,
      });
      await Promise.all([loadReviewOrders(), loadStatus()]);
    } catch (error) {
      setOperationMessage({
        ok: false,
        text: toMessage(error, '進單失敗'),
      });
    } finally {
      setOrderAction(order.orderId, null);
    }
  };

  const handleRejectOrder = async (order: PendingOrderView) => {
    setOrderAction(order.orderId, 'rejecting');
    setOperationMessage(null);
    try {
      await ordersApi.deleteReviewOrder(order.orderId);
      setOperationMessage({
        ok: true,
        text: `已拒單並刪除：${order.orderId}`,
      });
      await Promise.all([loadReviewOrders(), loadStatus()]);
    } catch (error) {
      setOperationMessage({
        ok: false,
        text: toMessage(error, '拒單失敗'),
      });
    } finally {
      setOrderAction(order.orderId, null);
    }
  };

  const copyText = async (label: string, text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setApiHelperMessage(`${label} 已複製`);
        return;
      }
      throw new Error('clipboard api unavailable');
    } catch {
      setApiHelperMessage(`${label} 複製失敗`);
    }
  };

  const apiBase = useMemo(() => {
    const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  }, []);

  const storeScopedIngestPath = `/api/orders/stores/${encodeURIComponent(storeId || 'default')}/ingest-pos-text`;
  const storeScopedIngestUrl = `${apiBase}${storeScopedIngestPath}`;

  const dirtyPayloadTemplate = useMemo(
    () =>
      pretty({
        api_version: '1.1.0',
        source_text: '電話: 02-0000-0000\\n時間: 2026-02-14 12:35\\n咖哩鍋貼 xO\\n招牌鍋貼 x5 備註:同一袋',
        metadata: {
          source: 'external_dirty_feed',
          sender: 'store-bridge',
          batch_id: 'dirty-20260214-001',
        },
      }),
    [],
  );

  const dirtyCurlTemplate = useMemo(
    () => [
      `curl -X POST "${storeScopedIngestUrl}" \\\\`,
      '  -H "Content-Type: application/json" \\\\',
      `  -d '${dirtyPayloadTemplate.replace(/'/g, "\\\\'")}'`,
    ].join('\n'),
    [dirtyPayloadTemplate, storeScopedIngestUrl],
  );

  const pendingOrders = useMemo(
    () => reviewOrders
      .map((detail) => buildPendingOrderView(detail, onResolveIngestItem))
      .filter((entry): entry is PendingOrderView => Boolean(entry)),
    [onResolveIngestItem, reviewOrders],
  );

  const serverNotifications = useMemo<NotificationItem[]>(
    () => reviewOrders
      .filter((entry) => TRACKING_STATUSES.has(entry.status))
      .map((entry) => ({
        id: `server-${entry.orderId}`,
        sourceOrderId: entry.orderId,
        systemOrderId: entry.orderId,
        createdAt: entry.updatedAt ?? entry.createdAt ?? Date.now(),
        source: 'server',
      })),
    [reviewOrders],
  );

  const displayNotifications = useMemo<NotificationItem[]>(
    () => {
      const dedup = new Map<string, NotificationItem>();
      const appNotifications = Array.isArray(externalNotifications)
        ? externalNotifications.map((entry) => ({
          id: `app-${entry.id}`,
          sourceOrderId: asText(entry.sourceOrderId, 'unknown-source'),
          systemOrderId: asText(entry.systemOrderId, asText(entry.sourceOrderId, 'unknown-order')),
          createdAt: asNumber(entry.createdAt) ?? Date.now(),
          source: 'app' as const,
        }))
        : [];
      [...notifications, ...appNotifications, ...serverNotifications]
        .sort((a, b) => b.createdAt - a.createdAt)
        .forEach((item) => {
          const dedupKey = item.systemOrderId.trim() || item.sourceOrderId.trim() || item.id;
          if (dedup.has(dedupKey)) return;
          dedup.set(dedupKey, item);
        });
      return [...dedup.values()].slice(0, 30);
    },
    [externalNotifications, notifications, serverNotifications],
  );

  return (
    <section className="mx-auto max-w-[1120px] space-y-4 pt-2 sm:space-y-5 sm:pt-4">
      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section
          className={`${panelCardClass} bafang-glass h-[620px] border-sky-200/70 bg-[linear-gradient(180deg,rgba(240,249,255,0.78),rgba(255,255,255,0.94))]`}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">通知</h3>
            <span className="inline-flex h-7 items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-700">
              {displayNotifications.length}
            </span>
          </div>
          <div className="bafang-soft-scroll mt-2 h-[calc(620px-4.5rem)] overflow-auto rounded-xl border border-sky-200/80 bg-white/92 p-2.5">
            {displayNotifications.length === 0 ? (
              <p className="text-xs font-medium text-slate-500">無通知</p>
            ) : (
              <ul className="space-y-2">
                {displayNotifications.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <span className="text-xs font-semibold text-slate-800">
                      訂單 {entry.systemOrderId}
                      {entry.source === 'server' ? '（外部）' : ''}
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">{formatClock(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section
          className={`${panelCardClass} bafang-glass h-[620px] border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,251,235,0.86),rgba(255,255,255,0.96))]`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">待確認訂單</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700">
                待確認 {pendingOrders.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  void Promise.all([loadReviewOrders(), loadStatus()]);
                }}
                disabled={loadingReview || loadingStatus}
                className={`${actionButtonBase} border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
              >
                {loadingReview || loadingStatus ? '同步中...' : '重新整理'}
              </button>
            </div>
          </div>

          {reviewError && (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {reviewError}
            </p>
          )}

          {operationMessage && (
            <p
              className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
                operationMessage.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              {operationMessage.text}
            </p>
          )}

          <div className="bafang-soft-scroll mt-3 h-[calc(620px-9.5rem)] space-y-3 overflow-auto pr-1">
            {loadingReview && pendingOrders.length === 0 && (
              <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
                讀取中...
              </p>
            )}

            {!loadingReview && pendingOrders.length === 0 && (
              <p className="rounded-xl border border-dashed border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">
                無待確認
              </p>
            )}

            {pendingOrders.map((order) => {
              const action = actionByOrderId[order.orderId];
              const hasLowConfidence = order.reasons.includes('low_confidence');
              const hasSoldOut = order.reasons.includes('sold_out');
              const showSoldOutView = hasSoldOut;
              const aiLabel = order.llmUsed ? 'AI' : null;
              const aiTitle = order.llmUsed ? '已使用 AI 辨識' : null;
              const resultLabel = order.llmUsed ? 'AI辨識' : '規則推斷';
              return (
                <article
                  key={order.orderId}
                  className="bafang-enter rounded-2xl border border-amber-200/80 bg-white/95 p-3 shadow-sm shadow-amber-100/60 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{order.orderId}</p>
                      <p className="text-[11px] font-medium text-slate-500">
                        更新 {formatClock(order.detail.updatedAt ?? order.detail.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {aiLabel && (
                        <span
                          title={aiTitle ?? undefined}
                          className="inline-flex h-6 items-center rounded-full border border-emerald-300 bg-emerald-100 px-2 text-[11px] font-semibold text-emerald-800"
                        >
                          {aiLabel}
                        </span>
                      )}
                      {hasLowConfidence && (
                        <span className="inline-flex h-6 items-center rounded-full border border-amber-300 bg-amber-100 px-2 text-[11px] font-semibold text-amber-800">
                          信心不足
                        </span>
                      )}
                      {hasSoldOut && (
                        <span className="inline-flex h-6 items-center rounded-full border border-rose-300 bg-rose-100 px-2 text-[11px] font-semibold text-rose-800">
                          含售完品項
                        </span>
                      )}
                      {order.orderConfidence !== null && (
                        <span className="inline-flex h-6 items-center rounded-full border border-slate-300 bg-slate-100 px-2 text-[11px] font-semibold text-slate-700">
                          訂單信心 {order.orderConfidence.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {!showSoldOutView && (
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">原始訊息</p>
                        <pre className="bafang-soft-scroll mt-1 max-h-[170px] overflow-auto whitespace-pre-wrap text-[11px] font-medium text-slate-700">
                          {order.sourceText || '（無）'}
                        </pre>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{resultLabel}</p>
                        <div className="bafang-soft-scroll mt-1 max-h-[170px] space-y-1.5 overflow-auto">
                          {order.lines.map((line) => (
                            <div
                              key={`${order.orderId}-ai-${line.lineIndex}-${line.normalized}`}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900">{line.normalized}</p>
                                <span className="text-xs font-semibold text-slate-600">x{line.qty}</span>
                              </div>
                              <p className="mt-1 text-[11px] font-medium text-slate-500">
                                信心 {line.confidenceItem === null ? '-' : line.confidenceItem.toFixed(2)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {showSoldOutView && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{resultLabel}</p>
                      <div className="bafang-soft-scroll mt-1 max-h-[180px] space-y-1.5 overflow-auto">
                        {order.lines.map((line) => (
                          <div
                            key={`${order.orderId}-soldout-${line.lineIndex}-${line.normalized}`}
                            className={`rounded-lg border px-2.5 py-2 ${
                              line.soldOut
                                ? 'border-rose-300 bg-rose-100'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className={`text-sm font-semibold ${line.soldOut ? 'text-rose-800' : 'text-slate-900'}`}>
                                {line.normalized}
                              </p>
                              <span className={`text-xs font-semibold ${line.soldOut ? 'text-rose-700' : 'text-slate-600'}`}>
                                x{line.qty}
                              </span>
                            </div>
                            {line.soldOut && (
                              <p className="mt-1 text-[11px] font-semibold text-rose-700">
                                {line.soldOutReason ?? '已售完'}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleEditOrder(order);
                      }}
                      disabled={Boolean(action)}
                      className={`${actionButtonBase} border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                    >
                      {action === 'editing' ? '載入中...' : '編輯'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleAcceptOrder(order);
                      }}
                      disabled={Boolean(action)}
                      className={`${actionButtonBase} bg-emerald-600 text-white hover:bg-emerald-700`}
                    >
                      {action === 'accepting' ? '進單中...' : '進單'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleRejectOrder(order);
                      }}
                      disabled={Boolean(action)}
                      className={`${actionButtonBase} border border-rose-300 bg-white text-rose-700 hover:border-rose-400 hover:bg-rose-50`}
                    >
                      {action === 'rejecting' ? '刪除中...' : '拒單'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <details className={`${panelCardClass} bafang-glass border-slate-200 bg-white/95`}>
        <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">引擎調整</summary>

        <div className="mt-4 space-y-3">
          <article
            className={`rounded-xl border p-3 ${
              status?.llmEnabled
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-rose-200 bg-rose-50'
            }`}
          >
            <p className="text-base font-semibold text-slate-900">
              AI辨識功能：{status?.llmEnabled ? '已啟用' : '未啟用'}
            </p>
          </article>

          {statusError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {statusError}
            </p>
          )}

          <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">AI 設定</h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  void saveLlmConfig();
                }}
                disabled={llmConfig.saving || !llmConfig.loaded}
                className={`${actionButtonBase} bg-[#1f3356] text-white hover:bg-[#2d4770]`}
              >
                {llmConfig.saving ? '儲存中...' : '儲存'}
              </button>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="rounded-xl border border-slate-200 bg-white p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">OpenAI API Key</p>
                <input
                  type="password"
                  value={llmConfig.apiKey}
                  onChange={(event) => setLlmConfig((prev) => ({ ...prev, apiKey: event.target.value }))}
                  placeholder="sk-..."
                  className={inputBaseClass}
                />
                <p className="mt-1 text-[11px] font-medium text-slate-500">{llmConfig.apiKeyRedacted ?? '未設定'}</p>
              </label>

              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={llmConfig.enabled}
                    onChange={(event) => setLlmConfig((prev) => ({ ...prev, enabled: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  啟用 LLM
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void clearLlmApiKey();
                  }}
                  disabled={llmConfig.saving || !llmConfig.apiKeyRedacted}
                  className={`${actionButtonBase} border border-rose-300 bg-white text-rose-700 hover:border-rose-400 hover:bg-rose-50`}
                >
                  清除已存KEY
                </button>
              </div>
            </div>

            {llmConfig.error && (
              <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {llmConfig.error}
              </p>
            )}
            {llmConfig.okMessage && (
              <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                {llmConfig.okMessage}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">外部送單 API（店家專屬）</h4>
              <button
                type="button"
                onClick={() => {
                  void copyText('API URL', storeScopedIngestUrl);
                }}
                className={`${actionButtonBase} border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
              >
                複製 URL
              </button>
            </div>

            <pre className="bafang-soft-scroll mt-2 overflow-auto rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] font-semibold text-slate-800">
              {storeScopedIngestUrl}
            </pre>

            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <article className="rounded-xl border border-slate-200 bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payload</p>
                  <button
                    type="button"
                    onClick={() => {
                      void copyText('Payload', dirtyPayloadTemplate);
                    }}
                    className={`${actionButtonBase} min-h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                  >
                    複製
                  </button>
                </div>
                <pre className="bafang-soft-scroll mt-1 max-h-[180px] overflow-auto text-[11px] font-medium text-slate-700">
                  {dirtyPayloadTemplate}
                </pre>
              </article>

              <article className="rounded-xl border border-slate-200 bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">curl</p>
                  <button
                    type="button"
                    onClick={() => {
                      void copyText('curl', dirtyCurlTemplate);
                    }}
                    className={`${actionButtonBase} min-h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-[11px] text-slate-700 hover:border-slate-400 hover:bg-slate-50`}
                  >
                    複製
                  </button>
                </div>
                <pre className="bafang-soft-scroll mt-1 max-h-[180px] overflow-auto text-[11px] font-medium text-slate-700">
                  {dirtyCurlTemplate}
                </pre>
              </article>
            </div>

            {apiHelperMessage && (
              <p className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">
                {apiHelperMessage}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">測試模式</h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  void clearTestData();
                }}
                disabled={clearingTestData}
                className={`${actionButtonBase} border border-rose-300 bg-white text-rose-700 hover:border-rose-400 hover:bg-rose-50`}
              >
                {clearingTestData ? '清理中...' : '清空測試集'}
              </button>
            </div>
          </section>
        </div>
      </details>
    </section>
  );
}

export default IngestEnginePanel;
