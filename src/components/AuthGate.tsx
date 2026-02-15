import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  authApi,
  type AuthStore,
  type AuthUser,
} from '../lib/authApi';
import { backofficeApi } from '../lib/backofficeApi';
import BackofficePanel from './BackofficePanel';

type AuthGateProps = {
  children: ReactNode | ((user: AuthUser) => ReactNode);
};

const LAST_STORE_STORAGE_KEY = 'bafang.auth.lastStoreId';

const readLocal = (key: string) => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(key) ?? '';
};

const writeLocal = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
};

function AuthGate({ children }: AuthGateProps) {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stores, setStores] = useState<AuthStore[]>([]);
  const [storesLoadError, setStoresLoadError] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [adminMode, setAdminMode] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);

  const selectedStore = useMemo(
    () => stores.find((entry) => entry.id === selectedStoreId) ?? null,
    [stores, selectedStoreId],
  );

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setBootstrapping(true);
      setStoresLoadError(null);
      try {
        const storesRes = await authApi.listUsers();
        if (cancelled) return;
        const nextStores = storesRes.users;
        setStores(nextStores);

        const rememberedStoreId = readLocal(LAST_STORE_STORAGE_KEY);
        const nextSelectedStoreId = nextStores.some((store) => store.id === rememberedStoreId)
          ? rememberedStoreId
          : (nextStores[0]?.id ?? '');
        setSelectedStoreId(nextSelectedStoreId);

        try {
          const adminRes = await backofficeApi.adminMe().catch(() => null);
          if (adminRes?.ok) {
            setAdminAuthed(true);
            return;
          }
          const meRes = await authApi.me();
          if (cancelled) return;
          setUser(meRes.user);
          writeLocal(LAST_STORE_STORAGE_KEY, meRes.store.id);
          setSelectedStoreId(meRes.store.id);
        } catch {
          if (cancelled) return;
          setUser(null);
        }
      } catch (error) {
        if (cancelled) return;
        setStores([]);
        setStoresLoadError(error instanceof Error ? error.message : '店面清單載入失敗');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async () => {
    if (!selectedStoreId) {
      setMessage('選店面');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await authApi.login({ storeId: selectedStoreId });
      setUser(response.user);
      writeLocal(LAST_STORE_STORAGE_KEY, response.store.id);
      setSelectedStoreId(response.store.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登入失敗');
    } finally {
      setBusy(false);
    }
  };

  const handleAdminLogin = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await backofficeApi.adminLogin(adminPassword);
      setAdminAuthed(true);
      setAdminPassword('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '後台登入失敗');
    } finally {
      setBusy(false);
    }
  };

  if (bootstrapping) {
    return (
      <main className="bafang-minimal min-h-screen bg-slate-100 p-4">
        <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-700">...</p>
        </section>
      </main>
    );
  }

  if (user) {
    const content = typeof children === 'function' ? children(user) : children;
    return <>{content}</>;
  }

  if (adminAuthed) {
    return (
      <BackofficePanel
        onLogout={async () => {
          await backofficeApi.adminLogout().catch(() => undefined);
          setAdminAuthed(false);
          setAdminMode(false);
          setMessage(null);
        }}
      />
    );
  }

  return (
    <main className="bafang-page-bg flex min-h-screen items-center justify-center px-3 py-4 sm:px-5 sm:py-6">
      <div className="w-full max-w-lg">
        <header className="mb-5 text-center md:mb-7">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-700 sm:text-xs md:text-sm">
            BAFANG PRO OPERATIONS
          </p>
          <h1 className="mt-2 text-[clamp(2rem,5.8vw,4rem)] font-black leading-tight tracking-[0.12em] text-[#20365a]">
            八方PRO
          </h1>
        </header>
        <section className="rounded-3xl border p-5 shadow-sm bafang-glass text-center">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setAdminMode(false);
                setMessage(null);
              }}
              className={`h-10 rounded-xl text-sm font-semibold transition ${
                !adminMode
                  ? 'bg-[#20365a] text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              門市
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminMode(true);
                setMessage(null);
              }}
              className={`h-10 rounded-xl text-sm font-semibold transition ${
                adminMode
                  ? 'bg-[#20365a] text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              後台
            </button>
          </div>

          {!adminMode && (
            <>
              <div className="space-y-2">
                {stores.map((store) => {
                  const active = selectedStoreId === store.id;
                  return (
                    <button
                      key={store.id}
                      type="button"
                      onClick={() => {
                        setSelectedStoreId(store.id);
                        writeLocal(LAST_STORE_STORAGE_KEY, store.id);
                        setMessage(null);
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-center transition ${
                        active
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-900">{store.displayName}</p>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  handleLogin().catch(() => undefined);
                }}
                disabled={busy || !selectedStore}
                className="mt-4 h-11 w-full rounded-xl bg-[#1f3356] text-sm font-semibold text-white hover:bg-[#2d4770] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '登入中...' : '進入'}
              </button>
            </>
          )}

          {adminMode && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type={showAdminPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  placeholder="後台密碼"
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword((prev) => !prev)}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400"
                >
                  {showAdminPassword ? '隱藏' : '顯示'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  handleAdminLogin().catch(() => undefined);
                }}
                disabled={busy || !adminPassword.trim()}
                className="mt-4 h-11 w-full rounded-xl bg-[#1f3356] text-sm font-semibold text-white hover:bg-[#2d4770] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '驗證中...' : '進入後台'}
              </button>
            </>
          )}

          {(storesLoadError || message) && (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 text-left">
              {storesLoadError || message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

export default AuthGate;
