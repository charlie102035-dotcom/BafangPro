type JsonRecord = Record<string, unknown>;

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

export class BackofficeApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackofficeApiError';
    this.status = status;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const request = async (path: string, options: RequestOptions = {}): Promise<unknown> => {
  const method = options.method ?? 'GET';
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  if (response.status === 204) return {};
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : '請求失敗';
    throw new BackofficeApiError(message, response.status);
  }
  return payload;
};

const asString = (value: unknown, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

export type BackofficeStoreAnalytics = {
  storeId: string;
  storeName: string;
  revenue: number;
  orderCount: number;
  topItems: Array<{ name: string; qty: number }>;
  hourlySales: Array<{ hour: number; revenue: number; orders: number }>;
  dailyRevenue: Array<{ day: string; revenue: number; orders: number }>;
  itemCurves: Array<{ name: string; points: Array<{ day: string; qty: number }> }>;
  kpis: {
    avgOrderValue: number;
    completionRate: number;
    peakHour: string;
    peakDay: string | null;
  };
  resetState: {
    version: number;
    updatedAt: number | null;
    updatedBy: string | null;
  };
};

export const backofficeApi = {
  adminLogin: async (password: string) =>
    request('/api/admin/login', {
      method: 'POST',
      body: { password },
    }),

  adminLogout: async () =>
    request('/api/admin/logout', {
      method: 'POST',
    }),

  adminMe: async (): Promise<{ ok: boolean; role: string }> => {
    const payload = await request('/api/admin/me');
    const record = isRecord(payload) ? payload : {};
    return {
      ok: record.ok === true,
      role: asString(record.role),
    };
  },

  getAnalytics: async (month?: string): Promise<{ month: string; stores: BackofficeStoreAnalytics[] }> => {
    const query = month && /^\d{4}-\d{2}$/.test(month)
      ? `?month=${encodeURIComponent(month)}`
      : '';
    const payload = await request(`/api/admin/analytics${query}`);
    const record = isRecord(payload) ? payload : {};
    const storesRaw = Array.isArray(record.stores) ? record.stores : [];
    const stores = storesRaw
      .filter((entry) => isRecord(entry))
      .map((entry) => ({
        storeId: asString(entry.storeId),
        storeName: asString(entry.storeName),
        revenue: Math.max(0, Math.round(asNumber(entry.revenue))),
        orderCount: Math.max(0, Math.round(asNumber(entry.orderCount))),
        topItems: Array.isArray(entry.topItems)
          ? entry.topItems
            .filter((item) => isRecord(item))
            .map((item) => ({
              name: asString(item.name, '未命名'),
              qty: Math.max(0, Math.round(asNumber(item.qty))),
            }))
          : [],
        hourlySales: Array.isArray(entry.hourlySales)
          ? entry.hourlySales
            .filter((item) => isRecord(item))
            .map((item) => ({
              hour: Math.max(0, Math.min(23, Math.round(asNumber(item.hour)))),
              revenue: Math.max(0, Math.round(asNumber(item.revenue))),
              orders: Math.max(0, Math.round(asNumber(item.orders))),
            }))
          : [],
        dailyRevenue: Array.isArray(entry.dailyRevenue)
          ? entry.dailyRevenue
            .filter((item) => isRecord(item))
            .map((item) => ({
              day: asString(item.day),
              revenue: Math.max(0, Math.round(asNumber(item.revenue))),
              orders: Math.max(0, Math.round(asNumber(item.orders))),
            }))
          : [],
        itemCurves: Array.isArray(entry.itemCurves)
          ? entry.itemCurves
            .filter((item) => isRecord(item))
            .map((curve) => ({
              name: asString(curve.name, '未命名'),
              points: Array.isArray(curve.points)
                ? curve.points
                  .filter((point) => isRecord(point))
                  .map((point) => ({
                    day: asString(point.day),
                    qty: Math.max(0, Math.round(asNumber(point.qty))),
                  }))
                : [],
            }))
          : [],
        kpis: isRecord(entry.kpis)
          ? {
            avgOrderValue: Math.max(0, Math.round(asNumber(entry.kpis.avgOrderValue))),
            completionRate: Math.max(0, Math.round(asNumber(entry.kpis.completionRate) * 10) / 10),
            peakHour: asString(entry.kpis.peakHour, '00:00'),
            peakDay: asString(entry.kpis.peakDay) || null,
          }
          : {
            avgOrderValue: 0,
            completionRate: 0,
            peakHour: '00:00',
            peakDay: null,
          },
        resetState: isRecord(entry.resetState)
          ? {
            version: Math.max(0, Math.round(asNumber(entry.resetState.version))),
            updatedAt: Number.isFinite(asNumber(entry.resetState.updatedAt, Number.NaN))
              ? Math.round(asNumber(entry.resetState.updatedAt))
              : null,
            updatedBy: asString(entry.resetState.updatedBy) || null,
          }
          : { version: 0, updatedAt: null, updatedBy: null },
      }));
    return { month: asString(record.month), stores };
  },

  resetStoreWorkflow: async (storeId: string) =>
    request('/api/admin/reset-store', {
      method: 'POST',
      body: { store_id: storeId },
    }),

  generateRandomMonthOrders: async (input?: {
    month?: string;
    avgPerDay?: number;
    storeId?: string;
  }) =>
    request('/api/admin/generate-random-month', {
      method: 'POST',
      body: {
        ...(input?.month ? { month: input.month } : {}),
        ...(Number.isFinite(Number(input?.avgPerDay)) ? { avg_per_day: Math.round(Number(input?.avgPerDay)) } : {}),
        ...(input?.storeId ? { store_id: input.storeId } : {}),
      },
    }),

  clearOrderRecords: async (storeId?: string) =>
    request('/api/admin/clear-order-records', {
      method: 'POST',
      body: storeId ? { store_id: storeId } : {},
    }),

  upsertOrderRecord: async (payload: {
    storeId: string;
    orderId: string;
    source: string;
    status: string;
    serviceMode?: string;
    totalAmount: number;
    totalCount: number;
    createdAt: number;
    orderPayload: unknown;
  }) =>
    request('/api/admin/order-upsert', {
      method: 'POST',
      body: {
        store_id: payload.storeId,
        order_id: payload.orderId,
        source: payload.source,
        status: payload.status,
        service_mode: payload.serviceMode ?? null,
        total_amount: payload.totalAmount,
        total_count: payload.totalCount,
        created_at: payload.createdAt,
        payload: payload.orderPayload,
      },
    }),

  getWorkflowResetState: async (): Promise<{ version: number }> => {
    const payload = await request('/api/admin/workflow-reset-state');
    const record = isRecord(payload) ? payload : {};
    return {
      version: Math.max(0, Math.round(asNumber(record.version))),
    };
  },
};
