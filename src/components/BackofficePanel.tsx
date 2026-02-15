import { useEffect, useMemo, useState } from 'react';
import { backofficeApi, BackofficeApiError, type BackofficeStoreAnalytics } from '../lib/backofficeApi';

type BackofficePanelProps = {
  onLogout: () => Promise<void> | void;
};

const currency = (value: number) => `NT$${value.toLocaleString('zh-TW')}`;

const toMessage = (error: unknown, fallback: string) =>
  error instanceof BackofficeApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : fallback;

const currentMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const linePath = (values: number[], width = 320, height = 90) => {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((value, index) => {
      const x = Math.round(index * stepX * 100) / 100;
      const y = Math.round((height - (value / max) * height) * 100) / 100;
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
};

function BackofficePanel({ onLogout }: BackofficePanelProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stores, setStores] = useState<BackofficeStoreAnalytics[]>([]);
  const [month, setMonth] = useState(currentMonthKey);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (monthKey = month) => {
    setLoading(true);
    setError(null);
    try {
      const result = await backofficeApi.getAnalytics(monthKey);
      setStores(result.stores);
      if (result.month) setMonth(result.month);
    } catch (loadError) {
      setError(toMessage(loadError, '後台資料讀取失敗'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(month);
  }, []);

  const totals = useMemo(
    () =>
      stores.reduce(
        (acc, store) => ({
          revenue: acc.revenue + store.revenue,
          orders: acc.orders + store.orderCount,
        }),
        { revenue: 0, orders: 0 },
      ),
    [stores],
  );

  const handleResetStore = async (storeId: string) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await backofficeApi.resetStoreWorkflow(storeId);
      setNotice(`已重置 ${storeId} 工作流`);
      await load(month);
    } catch (resetError) {
      setError(toMessage(resetError, '重置失敗'));
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateMonth = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await backofficeApi.generateRandomMonthOrders({
        month,
        avgPerDay: 10,
      });
      const createdCount = Number((result as { createdCount?: unknown }).createdCount ?? 0);
      setNotice(`已生成 ${createdCount} 筆隨機訂單`);
      await load(month);
    } catch (generateError) {
      setError(toMessage(generateError, '生成失敗'));
    } finally {
      setBusy(false);
    }
  };

  const handleClearAllRecords = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await backofficeApi.clearOrderRecords();
      const deletedCount = Number((result as { deletedCount?: unknown }).deletedCount ?? 0);
      setNotice(`已清空後台資料 ${deletedCount} 筆`);
      await load(month);
    } catch (clearError) {
      setError(toMessage(clearError, '清空失敗'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bafang-page-bg min-h-screen px-3 py-4 sm:px-5 sm:py-6 md:px-7 lg:px-10">
      <header className="mx-auto mb-5 max-w-[1480px] md:mb-7">
        <p className="pl-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-700 sm:text-xs md:text-sm">
          BAFANG PRO OPERATIONS
        </p>
        <h1 className="mt-2 text-[clamp(2rem,5.8vw,4rem)] font-black leading-tight tracking-[0.12em] text-[#20365a]">
          八方PRO
        </h1>
      </header>

      <section className="mx-auto max-w-[1480px] space-y-4">
        <div className="bafang-glass rounded-3xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-4">
              <p className="text-lg font-semibold text-slate-900">後台</p>
              <p className="text-sm font-semibold text-slate-700">{currency(totals.revenue)}</p>
              <p className="text-sm font-semibold text-slate-700">{totals.orders}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-800"
              />
              <button
                type="button"
                onClick={() => {
                  void load(month);
                }}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                重新整理
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleGenerateMonth();
                }}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 hover:border-emerald-400 disabled:opacity-50"
              >
                生成月訂單
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleClearAllRecords();
                }}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:border-rose-400 disabled:opacity-50"
              >
                清空後台資料
              </button>
              <button
                type="button"
                onClick={() => {
                  void onLogout();
                }}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-slate-400"
              >
                登出
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm font-semibold text-rose-700">{error}</p>}
          {notice && <p className="mt-2 text-sm font-semibold text-emerald-700">{notice}</p>}
        </div>

        {loading && (
          <div className="bafang-glass rounded-2xl border p-4 text-sm font-semibold text-slate-700">
            載入中...
          </div>
        )}

        {!loading && (
          <div className="grid gap-3 lg:grid-cols-3">
            {stores.map((store) => {
              const dailyRevenueValues = store.dailyRevenue.map((entry) => entry.revenue);
              const monthlyLine = linePath(dailyRevenueValues, 320, 88);
              return (
                <article key={store.storeId} className="bafang-glass rounded-3xl border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-bold text-[#20365a]">{store.storeName}</h2>
                    <button
                      type="button"
                      onClick={() => {
                        void handleResetStore(store.storeId);
                      }}
                      disabled={busy}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-2.5 text-xs font-semibold text-rose-700 hover:border-rose-400 disabled:opacity-55"
                    >
                      重置
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-white/80 p-2">
                      <p className="text-[11px] font-semibold text-slate-500">營收</p>
                      <p className="text-lg font-semibold text-slate-900">{currency(store.revenue)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white/80 p-2">
                      <p className="text-[11px] font-semibold text-slate-500">訂單</p>
                      <p className="text-lg font-semibold text-slate-900">{store.orderCount}</p>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-slate-200 bg-white/80 p-2">
                      <p className="text-[11px] font-semibold text-slate-500">客單</p>
                      <p className="text-sm font-semibold text-slate-900">{currency(store.kpis.avgOrderValue)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white/80 p-2">
                      <p className="text-[11px] font-semibold text-slate-500">完單率</p>
                      <p className="text-sm font-semibold text-slate-900">{store.kpis.completionRate}%</p>
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl border border-slate-200 bg-white/80 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">當月營收</p>
                    <svg viewBox="0 0 320 90" className="mt-1 h-20 w-full">
                      <path d={monthlyLine} fill="none" stroke="#20365a" strokeWidth="2.5" />
                    </svg>
                  </div>

                  <div className="mt-2 space-y-1.5 rounded-xl border border-slate-200 bg-white/80 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">品項銷售曲線</p>
                    {store.itemCurves.slice(0, 3).map((curve) => (
                      <div key={`${store.storeId}-${curve.name}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                        <p className="text-xs font-semibold text-slate-700">{curve.name}</p>
                        <svg viewBox="0 0 280 54" className="mt-1 h-12 w-full">
                          <path
                            d={linePath(curve.points.map((point) => point.qty), 280, 54)}
                            fill="none"
                            stroke="#0ea5e9"
                            strokeWidth="2"
                          />
                        </svg>
                      </div>
                    ))}
                    {store.itemCurves.length === 0 && <p className="text-xs font-semibold text-slate-500">無資料</p>}
                  </div>

                  <div className="mt-2 space-y-1.5 rounded-xl border border-slate-200 bg-white/80 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">熱銷品項</p>
                    {store.topItems.slice(0, 6).map((item) => (
                      <div key={`${store.storeId}-${item.name}`} className="flex items-center justify-between text-xs font-semibold text-slate-700">
                        <span className="truncate pr-2">{item.name}</span>
                        <span>{item.qty}</span>
                      </div>
                    ))}
                    {store.topItems.length === 0 && (
                      <p className="text-xs font-semibold text-slate-500">無資料</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default BackofficePanel;

