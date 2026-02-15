import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import Database from 'better-sqlite3';
import express from 'express';
import jwt from 'jsonwebtoken';

import { createCallOutputModule } from './call_output/index.mjs';
import { createFryAutomationModule } from './fry_automation/index.mjs';
import { createOrdersRouter } from './routes/orders.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
const AUTH_COOKIE_NAME = 'bafang_auth';
const ADMIN_COOKIE_NAME = 'bafang_admin';
const JWT_EXPIRES_IN = '14d';
const DEV_JWT_SECRET = 'bafang-dev-secret-change-me';
const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? DEV_JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '0000';
const IS_PROD = process.env.NODE_ENV === 'production';
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DIST_INDEX_PATH = path.join(DIST_DIR, 'index.html');

const dbPath = process.env.AUTH_DB_PATH ?? path.join(__dirname, 'data', 'auth.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL UNIQUE,
    seed_order INTEGER NOT NULL DEFAULT 999,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS order_records (
    store_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'unknown',
    service_mode TEXT,
    status TEXT NOT NULL DEFAULT 'waiting_pickup',
    total_amount REAL NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (store_id, order_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workflow_reset_state (
    store_id TEXT PRIMARY KEY,
    reset_version INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
  );
`);

const seedProfiles = [
  { id: 'store-songren', displayName: '松仁', seedOrder: 1 },
  { id: 'store-tmuh', displayName: '北醫', seedOrder: 2 },
  { id: 'store-daan', displayName: '大安', seedOrder: 3 },
];

const upsertSeedProfileStmt = db.prepare(`
  INSERT INTO profiles (id, display_name, seed_order, is_active, created_at, updated_at)
  VALUES (@id, @display_name, @seed_order, 1, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    display_name = excluded.display_name,
    seed_order = excluded.seed_order,
    is_active = 1,
    updated_at = excluded.updated_at
`);

const upsertResetStateStmt = db.prepare(`
  INSERT INTO workflow_reset_state (store_id, reset_version, updated_at, updated_by)
  VALUES (@store_id, 0, @updated_at, @updated_by)
  ON CONFLICT(store_id) DO NOTHING
`);

const seedTransaction = db.transaction((now) => {
  for (const entry of seedProfiles) {
    upsertSeedProfileStmt.run({
      id: entry.id,
      display_name: entry.displayName,
      seed_order: entry.seedOrder,
      created_at: now,
      updated_at: now,
    });
    upsertResetStateStmt.run({
      store_id: entry.id,
      updated_at: now,
      updated_by: 'seed',
    });
  }
});
seedTransaction(Date.now());

const upsertOrderRecordStmt = db.prepare(`
  INSERT INTO order_records (
    store_id,
    order_id,
    source,
    service_mode,
    status,
    total_amount,
    total_count,
    payload_json,
    created_at,
    updated_at
  )
  VALUES (
    @store_id,
    @order_id,
    @source,
    @service_mode,
    @status,
    @total_amount,
    @total_count,
    @payload_json,
    @created_at,
    @updated_at
  )
  ON CONFLICT(store_id, order_id) DO UPDATE SET
    source = excluded.source,
    service_mode = excluded.service_mode,
    status = excluded.status,
    total_amount = excluded.total_amount,
    total_count = excluded.total_count,
    payload_json = excluded.payload_json,
    updated_at = excluded.updated_at
`);

const listOrderRecordsStmt = db.prepare(`
  SELECT
    store_id,
    order_id,
    source,
    service_mode,
    status,
    total_amount,
    total_count,
    payload_json,
    created_at,
    updated_at
  FROM order_records
  WHERE (@store_id = '' OR store_id = @store_id)
  ORDER BY updated_at DESC
  LIMIT @limit
`);

const deleteOrderRecordsAllStmt = db.prepare(`
  DELETE FROM order_records
`);

const deleteOrderRecordsByStoreStmt = db.prepare(`
  DELETE FROM order_records
  WHERE store_id = ?
`);

const getResetStateStmt = db.prepare(`
  SELECT store_id, reset_version, updated_at, updated_by
  FROM workflow_reset_state
  WHERE store_id = ?
`);

const incrementResetStateStmt = db.prepare(`
  INSERT INTO workflow_reset_state (store_id, reset_version, updated_at, updated_by)
  VALUES (@store_id, 1, @updated_at, @updated_by)
  ON CONFLICT(store_id) DO UPDATE SET
    reset_version = workflow_reset_state.reset_version + 1,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
`);

const listProfilesStmt = db.prepare(`
  SELECT id, display_name, seed_order, is_active, created_at, updated_at
  FROM profiles
  WHERE is_active = 1
  ORDER BY seed_order ASC, created_at ASC
`);

const findProfileByIdStmt = db.prepare(`
  SELECT id, display_name, seed_order, is_active, created_at, updated_at
  FROM profiles
  WHERE id = ?
`);

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!IS_PROD) return true;
  return false;
};

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
if (fs.existsSync(DIST_INDEX_PATH)) {
  app.use(
    express.static(DIST_DIR, {
      index: false,
      maxAge: IS_PROD ? '7d' : 0,
    }),
  );
}

const fryAutomation = createFryAutomationModule({
  pollIntervalMs: Number(process.env.FRY_SENSOR_POLL_INTERVAL_MS ?? 4000),
  maxEvents: Number(process.env.FRY_EVENT_BUFFER_SIZE ?? 200),
});
fryAutomation.start().catch((error) => {
  console.error('[fry-automation] failed to start background polling', error);
});

const callOutput = createCallOutputModule({
  historyLimit: Number(process.env.CALL_OUTPUT_HISTORY_LIMIT ?? 500),
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => isObject(value) && Object.prototype.hasOwnProperty.call(value, key);

const normalizeText = (value, maxLength) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';

const normalizeStoreId = (value) => normalizeText(value, 64);
const normalizeWorkMode = (value) => normalizeText(value, 64);
const normalizeWorkTarget = (value) => normalizeText(value, 128);
const normalizeStatus = (value) => normalizeText(value, 64);
const normalizeSource = (value) => normalizeText(value, 64);
const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
};

const toPublicStore = (row) => ({
  id: row.id,
  displayName: row.display_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildDefaultUserSettings = () => ({
  defaultPerspective: 'production',
  allowedPerspectives: ['customer', 'production', 'packaging', 'settings', 'ingest'],
});

const toSessionPayload = (storeRow, sessionMeta = {}) => {
  const store = toPublicStore(storeRow);
  const lockedSession = isObject(sessionMeta) && sessionMeta.lockedSession === true;
  const workMode = isObject(sessionMeta) ? normalizeWorkMode(sessionMeta.workMode) : '';
  const workTarget = isObject(sessionMeta) ? normalizeWorkTarget(sessionMeta.workTarget) : '';
  const now = Date.now();
  return {
    store,
    user: {
      id: store.id,
      displayName: store.displayName,
      storeId: store.id,
      storeName: store.displayName,
      settings: buildDefaultUserSettings(),
      createdAt: now,
      updatedAt: now,
    },
    locked_session: lockedSession,
    work_mode: workMode || null,
    work_target: workTarget || null,
    last_mode: null,
    last_target: null,
  };
};

const signAuthToken = (input) => {
  const storeId = normalizeStoreId(input?.storeId);
  const workMode = normalizeWorkMode(input?.workMode);
  const workTarget = normalizeWorkTarget(input?.workTarget);
  const lockedSession = Boolean(input?.lockedSession) && Boolean(workMode || workTarget);

  const tokenPayload = { sub: storeId };
  if (lockedSession) tokenPayload.ls = 1;
  if (workMode) tokenPayload.wm = workMode;
  if (workTarget) tokenPayload.wt = workTarget;

  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
  });
};

const signAdminToken = () =>
  jwt.sign(
    {
      sub: 'admin',
      role: 'admin',
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
    },
  );

const setAdminCookie = (res, token) => {
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
};

const clearAdminCookie = (res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: '/',
  });
};

const resolveActiveStore = (storeId) => {
  const store = findProfileByIdStmt.get(storeId);
  if (!store || store.is_active !== 1) return null;
  return store;
};

const authMiddleware = (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: '尚未登入' });
      return;
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const storeId = payload && typeof payload === 'object' && typeof payload.sub === 'string'
      ? payload.sub
      : '';
    const tokenWorkMode = payload && typeof payload === 'object' ? normalizeWorkMode(payload.wm) : '';
    const tokenWorkTarget = payload && typeof payload === 'object' ? normalizeWorkTarget(payload.wt) : '';
    const tokenLockedSession = payload && typeof payload === 'object'
      ? payload.ls === true || payload.ls === 1 || payload.ls === '1'
      : false;

    if (!storeId) {
      clearAuthCookie(res);
      res.status(401).json({ error: '登入狀態失效' });
      return;
    }

    const store = resolveActiveStore(storeId);
    if (!store) {
      clearAuthCookie(res);
      res.status(401).json({ error: '店面不存在或已停用' });
      return;
    }

    req.auth = {
      store,
      session: {
        lockedSession: Boolean(tokenLockedSession) && Boolean(tokenWorkMode || tokenWorkTarget),
        workMode: tokenWorkMode || null,
        workTarget: tokenWorkTarget || null,
      },
    };
    next();
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ error: '登入狀態失效' });
  }
};

const adminAuthMiddleware = (req, res, next) => {
  try {
    const token = req.cookies?.[ADMIN_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: '尚未登入後台' });
      return;
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const role = payload && typeof payload === 'object' ? payload.role : '';
    if (role !== 'admin') {
      clearAdminCookie(res);
      res.status(401).json({ error: '後台登入已失效' });
      return;
    }
    next();
  } catch {
    clearAdminCookie(res);
    res.status(401).json({ error: '後台登入已失效' });
  }
};

const parseOrderPayloadForAnalytics = (payloadJson) => {
  try {
    const parsed = JSON.parse(payloadJson);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const pad2 = (value) => String(value).padStart(2, '0');
const toMonthKey = (timestamp) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
};
const toDayKey = (timestamp) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};
const resolveMonth = (value) => {
  const text = normalizeText(value);
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
};
const buildMonthDays = (monthKey) => {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const dayCount = new Date(year, month, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) => `${yearText}-${monthText}-${pad2(index + 1)}`);
};

const collectItemSales = (payload) => {
  const counts = new Map();
  const cartLines = Array.isArray(payload?.cartLines) ? payload.cartLines : [];
  cartLines.forEach((line) => {
    const name = typeof line?.name === 'string' && line.name.trim() ? line.name.trim() : '未命名';
    const qty = Math.max(0, Math.round(toSafeNumber(line?.quantity, 0)));
    if (!qty) return;
    counts.set(name, (counts.get(name) ?? 0) + qty);
  });
  const boxRows = Array.isArray(payload?.boxRows) ? payload.boxRows : [];
  boxRows.forEach((row) => {
    const items = Array.isArray(row?.items) ? row.items : [];
    items.forEach((item) => {
      const name = typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : '未命名';
      const qty = Math.max(0, Math.round(toSafeNumber(item?.count, 0)));
      if (!qty) return;
      counts.set(name, (counts.get(name) ?? 0) + qty);
    });
  });
  return counts;
};

const buildStoreAnalytics = (rows, monthKey) => {
  const monthDays = buildMonthDays(monthKey);
  const byStore = new Map();
  rows.forEach((row) => {
    const storeId = normalizeStoreId(row.store_id);
    if (!storeId) return;
    if (!byStore.has(storeId)) {
      byStore.set(storeId, {
        revenue: 0,
        orderCount: 0,
        completedCount: 0,
        itemSales: new Map(),
        hourlySales: Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, orders: 0 })),
        dailyRevenue: monthDays.map((day) => ({ day, revenue: 0, orders: 0 })),
        monthlyItemSales: new Map(),
        monthlyItemDaily: new Map(),
      });
    }
    const bucket = byStore.get(storeId);
    const revenue = Math.max(0, toSafeNumber(row.total_amount, 0));
    const orderCreatedAt = Number(row.created_at) || Date.now();
    const orderMonthKey = toMonthKey(orderCreatedAt);
    const orderDayKey = toDayKey(orderCreatedAt);
    const orderHour = new Date(orderCreatedAt).getHours();
    const orderStatus = normalizeStatus(row.status);
    if (orderStatus === 'served' || orderStatus === 'archived' || orderStatus === 'dispatched') {
      bucket.completedCount += 1;
    }
    bucket.revenue += revenue;
    bucket.orderCount += 1;
    if (bucket.hourlySales[orderHour]) {
      bucket.hourlySales[orderHour].revenue += revenue;
      bucket.hourlySales[orderHour].orders += 1;
    }
    const payload = parseOrderPayloadForAnalytics(row.payload_json);
    const itemCounts = collectItemSales(payload);
    itemCounts.forEach((qty, name) => {
      bucket.itemSales.set(name, (bucket.itemSales.get(name) ?? 0) + qty);
      if (orderMonthKey === monthKey) {
        bucket.monthlyItemSales.set(name, (bucket.monthlyItemSales.get(name) ?? 0) + qty);
        if (!bucket.monthlyItemDaily.has(name)) {
          bucket.monthlyItemDaily.set(name, monthDays.map((day) => ({ day, qty: 0 })));
        }
        const series = bucket.monthlyItemDaily.get(name);
        const point = series.find((entry) => entry.day === orderDayKey);
        if (point) point.qty += qty;
      }
    });
    if (orderMonthKey === monthKey) {
      const dayPoint = bucket.dailyRevenue.find((entry) => entry.day === orderDayKey);
      if (dayPoint) {
        dayPoint.revenue += revenue;
        dayPoint.orders += 1;
      }
    }
  });

  return [...byStore.entries()].map(([storeId, value]) => {
    const topItems = [...value.itemSales.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, qty]) => ({ name, qty }));
    const monthlyTopItemNames = [...value.monthlyItemSales.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    const itemCurves = monthlyTopItemNames.map((name) => ({
      name,
      points: (value.monthlyItemDaily.get(name) ?? monthDays.map((day) => ({ day, qty: 0 }))).map((entry) => ({
        day: entry.day,
        qty: entry.qty,
      })),
    }));
    const peakHour = [...value.hourlySales].sort((a, b) => b.orders - a.orders)[0] ?? { hour: 0, orders: 0 };
    const peakDay = [...value.dailyRevenue].sort((a, b) => b.revenue - a.revenue)[0] ?? { day: monthDays[0] ?? '', revenue: 0 };
    const avgOrderValue = value.orderCount > 0 ? Math.round(value.revenue / value.orderCount) : 0;
    const completionRate = value.orderCount > 0
      ? Math.round((value.completedCount / value.orderCount) * 1000) / 10
      : 0;

    return {
      storeId,
      revenue: Math.round(value.revenue),
      orderCount: value.orderCount,
      topItems,
      hourlySales: value.hourlySales.map((entry) => ({
        hour: entry.hour,
        revenue: Math.round(entry.revenue),
        orders: entry.orders,
      })),
      month: monthKey,
      dailyRevenue: value.dailyRevenue.map((entry) => ({
        day: entry.day,
        revenue: Math.round(entry.revenue),
        orders: entry.orders,
      })),
      itemCurves,
      kpis: {
        avgOrderValue,
        completionRate,
        peakHour: `${pad2(peakHour.hour)}:00`,
        peakDay: peakDay.day,
      },
    };
  });
};

const RANDOM_MENU = [
  { name: '招牌鍋貼', price: 8 },
  { name: '韭菜鍋貼', price: 8 },
  { name: '玉米鍋貼', price: 9 },
  { name: '高麗菜水餃', price: 7 },
  { name: '韭菜水餃', price: 7 },
  { name: '酸辣湯', price: 35 },
  { name: '玉米濃湯', price: 35 },
  { name: '黃金豆腐', price: 40 },
  { name: '酸辣湯餃', price: 70 },
  { name: '麻醬麵', price: 55 },
  { name: '酸辣湯麵', price: 65 },
  { name: '真傳紅茶', price: 25 },
];

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const generateRandomMonthOrders = ({ monthKey, avgPerDay, storeIds }) => {
  const monthDays = buildMonthDays(monthKey);
  let created = 0;
  storeIds.forEach((storeId) => {
    monthDays.forEach((day, dayIndex) => {
      const [yearText, monthText, dateText] = day.split('-');
      const baseCount = Math.max(1, avgPerDay);
      const orderCount = Math.max(1, baseCount + randomInt(-3, 3));
      for (let index = 0; index < orderCount; index += 1) {
        const hour = randomInt(10, 21);
        const minute = randomInt(0, 59);
        const createdAt = new Date(
          Number(yearText),
          Number(monthText) - 1,
          Number(dateText),
          hour,
          minute,
          randomInt(0, 59),
        ).getTime();
        const lineCount = randomInt(1, 4);
        const picked = Array.from({ length: lineCount }, () => RANDOM_MENU[randomInt(0, RANDOM_MENU.length - 1)]);
        const cartLines = picked.map((item, lineIndex) => {
          const qty = randomInt(1, 4);
          return {
            id: `${lineIndex + 1}`,
            name: item.name,
            quantity: qty,
            unitPrice: item.price,
          };
        });
        const totalAmount = cartLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
        const totalCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
        const orderId = `SIM-${day.replace(/-/g, '')}-${String(dayIndex + 1).padStart(2, '0')}${String(index + 1).padStart(2, '0')}-${storeId.slice(-2)}`;
        const statusSeed = randomInt(1, 100);
        const status = statusSeed <= 65 ? 'served' : statusSeed <= 88 ? 'waiting_pickup' : 'archived';
        const payload = {
          id: orderId,
          cartLines,
          boxRows: [],
          source: 'simulator',
        };
        upsertOrderRecordStmt.run({
          store_id: storeId,
          order_id: orderId,
          source: 'simulator',
          service_mode: Math.random() > 0.5 ? 'dine_in' : 'takeout',
          status,
          total_amount: totalAmount,
          total_count: totalCount,
          payload_json: JSON.stringify(payload),
          created_at: createdAt,
          updated_at: Date.now(),
        });
        created += 1;
      }
    });
  });
  return created;
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'bafang-auth-api' });
});

app.get('/api/auth/users', (_req, res) => {
  const rows = listProfilesStmt.all();
  res.json({ users: rows.map(toPublicStore) });
});

app.post('/api/auth/login', (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  const storeId = normalizeStoreId(body.storeId ?? body.userId);
  const hasWorkModeInput = hasOwn(body, 'work_mode');
  const hasWorkTargetInput = hasOwn(body, 'work_target');
  const requestedWorkMode = hasWorkModeInput ? normalizeWorkMode(body.work_mode) : null;
  const requestedWorkTarget = hasWorkTargetInput ? normalizeWorkTarget(body.work_target) : null;

  if (!storeId) {
    res.status(400).json({ error: '請先選擇店面' });
    return;
  }

  const store = resolveActiveStore(storeId);
  if (!store) {
    res.status(404).json({ error: '找不到該店面' });
    return;
  }

  const workMode = requestedWorkMode || null;
  const workTarget = requestedWorkTarget || null;
  const lockedSession = Boolean(workMode || workTarget);

  const token = signAuthToken({
    storeId: store.id,
    lockedSession,
    workMode,
    workTarget,
  });
  setAuthCookie(res, token);
  res.json(
    toSessionPayload(store, {
      lockedSession,
      workMode,
      workTarget,
    }),
  );
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json(toSessionPayload(req.auth.store, req.auth.session));
});

app.post('/api/admin/login', (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  const password = normalizeText(body.password);
  if (!password || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: '密碼錯誤' });
    return;
  }
  const token = signAdminToken();
  setAdminCookie(res, token);
  res.status(200).json({ ok: true, role: 'admin' });
});

app.post('/api/admin/logout', (_req, res) => {
  clearAdminCookie(res);
  res.status(204).end();
});

app.get('/api/admin/me', adminAuthMiddleware, (_req, res) => {
  res.status(200).json({ ok: true, role: 'admin' });
});

app.post('/api/admin/order-upsert', authMiddleware, (req, res) => {
  try {
    const body = isObject(req.body) ? req.body : {};
    const bodyStoreId = normalizeStoreId(body.store_id ?? body.storeId);
    const storeId = bodyStoreId || req.auth.store.id;
    if (storeId !== req.auth.store.id) {
      res.status(403).json({ error: '無法寫入其他店面資料' });
      return;
    }
    const orderId = normalizeText(body.order_id ?? body.orderId, 128);
    if (!orderId) {
      res.status(400).json({ error: 'order_id 必填' });
      return;
    }
    const now = Date.now();
    const createdAt = Math.max(0, Math.round(toSafeNumber(body.created_at ?? body.createdAt, now)));
    const updatedAt = now;
    const payload = isObject(body.payload) ? body.payload : {};
    upsertOrderRecordStmt.run({
      store_id: storeId,
      order_id: orderId,
      source: normalizeSource(body.source || 'workflow') || 'workflow',
      service_mode: normalizeText(body.service_mode ?? body.serviceMode) || null,
      status: normalizeStatus(body.status || 'waiting_pickup') || 'waiting_pickup',
      total_amount: Math.max(0, toSafeNumber(body.total_amount ?? body.totalAmount, 0)),
      total_count: Math.max(0, Math.round(toSafeNumber(body.total_count ?? body.totalCount, 0))),
      payload_json: JSON.stringify(payload),
      created_at: createdAt,
      updated_at: updatedAt,
    });
    res.status(200).json({ ok: true, store_id: storeId, order_id: orderId });
  } catch (error) {
    console.error('[admin.order-upsert] error', error);
    res.status(500).json({ error: '寫入訂單資料失敗' });
  }
});

app.get('/api/admin/orders', adminAuthMiddleware, (req, res) => {
  try {
    const storeId = normalizeStoreId(req.query?.store_id ?? req.query?.storeId);
    const limit = Math.max(1, Math.min(5000, Math.round(toSafeNumber(req.query?.limit, 1000))));
    const rows = listOrderRecordsStmt.all({
      store_id: storeId,
      limit,
    });
    res.status(200).json({
      total: rows.length,
      orders: rows.map((row) => ({
        storeId: row.store_id,
        orderId: row.order_id,
        source: row.source,
        serviceMode: row.service_mode,
        status: row.status,
        totalAmount: row.total_amount,
        totalCount: row.total_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        payload: parseOrderPayloadForAnalytics(row.payload_json),
      })),
    });
  } catch (error) {
    console.error('[admin.orders] error', error);
    res.status(500).json({ error: '讀取訂單資料失敗' });
  }
});

app.get('/api/admin/analytics', adminAuthMiddleware, (req, res) => {
  try {
    const month = resolveMonth(req.query?.month);
    const rows = listOrderRecordsStmt.all({
      store_id: '',
      limit: 200000,
    });
    const storeRows = listProfilesStmt.all().map(toPublicStore);
    const resetStates = storeRows.reduce((acc, store) => {
      const reset = getResetStateStmt.get(store.id);
      acc[store.id] = {
        version: Number(reset?.reset_version) || 0,
        updatedAt: Number(reset?.updated_at) || null,
        updatedBy: normalizeText(reset?.updated_by) || null,
      };
      return acc;
    }, {});
    const analytics = buildStoreAnalytics(rows, month);
    const byStore = new Map(analytics.map((entry) => [entry.storeId, entry]));
    res.status(200).json({
      month,
      stores: storeRows.map((store) => ({
        storeId: store.id,
        storeName: store.displayName,
        revenue: byStore.get(store.id)?.revenue ?? 0,
        orderCount: byStore.get(store.id)?.orderCount ?? 0,
        topItems: byStore.get(store.id)?.topItems ?? [],
        hourlySales: byStore.get(store.id)?.hourlySales ?? Array.from({ length: 24 }, (_, hour) => ({
          hour,
          revenue: 0,
          orders: 0,
        })),
        dailyRevenue: byStore.get(store.id)?.dailyRevenue ?? [],
        itemCurves: byStore.get(store.id)?.itemCurves ?? [],
        kpis: byStore.get(store.id)?.kpis ?? {
          avgOrderValue: 0,
          completionRate: 0,
          peakHour: '00:00',
          peakDay: null,
        },
        resetState: resetStates[store.id] ?? {
          version: 0,
          updatedAt: null,
          updatedBy: null,
        },
      })),
    });
  } catch (error) {
    console.error('[admin.analytics] error', error);
    res.status(500).json({ error: '讀取後台分析資料失敗' });
  }
});

app.post('/api/admin/generate-random-month', adminAuthMiddleware, (req, res) => {
  try {
    const body = isObject(req.body) ? req.body : {};
    const month = resolveMonth(body.month);
    const avgPerDay = Math.max(1, Math.min(50, Math.round(toSafeNumber(body.avg_per_day ?? body.avgPerDay, 10))));
    const targetStoreId = normalizeStoreId(body.store_id ?? body.storeId);
    const targetStores = targetStoreId
      ? [targetStoreId]
      : listProfilesStmt.all().map((row) => normalizeStoreId(row.id)).filter(Boolean);
    const createdCount = generateRandomMonthOrders({
      monthKey: month,
      avgPerDay,
      storeIds: targetStores,
    });
    res.status(200).json({
      ok: true,
      month,
      avgPerDay,
      storeCount: targetStores.length,
      createdCount,
    });
  } catch (error) {
    console.error('[admin.generate-random-month] error', error);
    res.status(500).json({ error: '生成隨機訂單失敗' });
  }
});

app.post('/api/admin/clear-order-records', adminAuthMiddleware, (req, res) => {
  try {
    const body = isObject(req.body) ? req.body : {};
    const storeId = normalizeStoreId(body.store_id ?? body.storeId);
    let deleted = 0;
    if (storeId) {
      deleted = deleteOrderRecordsByStoreStmt.run(storeId).changes;
    } else {
      deleted = deleteOrderRecordsAllStmt.run().changes;
    }
    res.status(200).json({
      ok: true,
      deletedCount: deleted,
      scope: storeId ? 'store' : 'all',
      storeId: storeId || null,
    });
  } catch (error) {
    console.error('[admin.clear-order-records] error', error);
    res.status(500).json({ error: '清空後台資料失敗' });
  }
});

app.post('/api/admin/reset-store', adminAuthMiddleware, (req, res) => {
  try {
    const body = isObject(req.body) ? req.body : {};
    const storeId = normalizeStoreId(body.store_id ?? body.storeId);
    if (!storeId) {
      res.status(400).json({ error: 'store_id 必填' });
      return;
    }
    const store = resolveActiveStore(storeId);
    if (!store) {
      res.status(404).json({ error: '店面不存在' });
      return;
    }
    incrementResetStateStmt.run({
      store_id: storeId,
      updated_at: Date.now(),
      updated_by: 'admin',
    });
    const next = getResetStateStmt.get(storeId);
    res.status(200).json({
      ok: true,
      storeId,
      resetState: {
        version: Number(next?.reset_version) || 0,
        updatedAt: Number(next?.updated_at) || null,
        updatedBy: normalizeText(next?.updated_by) || null,
      },
    });
  } catch (error) {
    console.error('[admin.reset-store] error', error);
    res.status(500).json({ error: '重置失敗' });
  }
});

app.get('/api/admin/workflow-reset-state', authMiddleware, (req, res) => {
  try {
    const storeId = req.auth.store.id;
    const state = getResetStateStmt.get(storeId);
    res.status(200).json({
      storeId,
      version: Number(state?.reset_version) || 0,
      updatedAt: Number(state?.updated_at) || null,
      updatedBy: normalizeText(state?.updated_by) || null,
    });
  } catch (error) {
    console.error('[admin.workflow-reset-state] error', error);
    res.status(500).json({ error: '讀取重置狀態失敗' });
  }
});

app.use('/api/fry', fryAutomation.router);
app.use('/api/call-output', callOutput.router);
app.use('/api/orders', createOrdersRouter());

if (fs.existsSync(DIST_INDEX_PATH)) {
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(DIST_INDEX_PATH);
  });
}

app.use((err, _req, res, _next) => {
  if (String(err?.message ?? '').includes('Origin not allowed by CORS')) {
    res.status(403).json({ error: '目前來源未被允許，請聯繫管理員設定 CORS_ORIGINS' });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON 格式錯誤' });
    return;
  }
  console.error('[API ERROR]', err);
  res.status(500).json({ error: '伺服器錯誤，請稍後重試' });
});

app.listen(API_PORT, () => {
  if (JWT_SECRET === DEV_JWT_SECRET) {
    console.warn('[auth-api] Using default JWT secret. Set AUTH_JWT_SECRET for production.');
  }
  console.log(`[auth-api] listening on http://127.0.0.1:${API_PORT}`);
  console.log(`[auth-api] sqlite path: ${dbPath}`);
});
