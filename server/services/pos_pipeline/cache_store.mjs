import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ITEM_MAPPING_CACHE = 'item_mapping_cache';
export const NOTE_MODS_CACHE = 'note_mods_cache';
export const GROUP_PATTERN_CACHE = 'group_pattern_cache';

export const CACHE_NAMESPACES = new Set([
  ITEM_MAPPING_CACHE,
  NOTE_MODS_CACHE,
  GROUP_PATTERN_CACHE,
]);

const KEY_REQUIREMENTS = {
  [ITEM_MAPPING_CACHE]: ['name_raw', 'menu_catalog_version'],
  [NOTE_MODS_CACHE]: ['note_raw', 'allowed_mods_version'],
  [GROUP_PATTERN_CACHE]: ['group_pattern', 'menu_catalog_version', 'allowed_mods_version'],
};

const DEFAULT_TTLS = {
  [ITEM_MAPPING_CACHE]: 3600,
  [NOTE_MODS_CACHE]: 3600,
  [GROUP_PATTERN_CACHE]: 1800,
};

const DEFAULT_CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'pos_pipeline', 'cache_store.json');

const isMissingRequired = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeValue = (value) => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value instanceof Set || value instanceof Map) {
    const list = Array.from(value.values()).map(normalizeValue);
    return list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[String(key)] = normalizeValue(value[key]);
    }
    return output;
  }
  return value;
};

const canonicalizePayload = (payload) => {
  const normalized = normalizeValue(payload);
  return JSON.stringify(normalized);
};

export const buildCacheKey = (namespace, keyPayload) => {
  if (!CACHE_NAMESPACES.has(namespace)) {
    throw new Error(`Unsupported namespace: ${namespace}`);
  }
  if (!isPlainObject(keyPayload)) {
    throw new Error('keyPayload must be an object');
  }

  const required = KEY_REQUIREMENTS[namespace] ?? [];
  const missing = required.filter((field) => isMissingRequired(keyPayload[field]));
  if (missing.length > 0) {
    throw new Error(`Missing key fields for ${namespace}: ${missing.join(', ')}`);
  }

  const digest = createHash('sha256').update(canonicalizePayload(keyPayload)).digest('hex');
  return `${namespace}:${digest}`;
};

const clampConfidence = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export class FileCacheStore {
  constructor({ filePath = DEFAULT_CACHE_PATH, namespaceTtls = {}, nowMs = () => Date.now() } = {}) {
    const unknownNamespaces = Object.keys(namespaceTtls).filter((name) => !CACHE_NAMESPACES.has(name));
    if (unknownNamespaces.length > 0) {
      throw new Error(`Unsupported TTL namespace(s): ${unknownNamespaces.join(', ')}`);
    }

    this.filePath = filePath;
    this.nowMs = nowMs;
    this.namespaceTtls = { ...DEFAULT_TTLS, ...namespaceTtls };

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  get(namespace, keyPayload) {
    const key = buildCacheKey(namespace, keyPayload);
    const store = this.#loadStore();
    const bucket = this.#bucketFor(store, namespace, false);
    if (!bucket) return null;

    const entry = bucket[key];
    if (!entry) return null;

    const now = this.nowMs();
    if (entry.expires_at_ms !== null && entry.expires_at_ms !== undefined && now >= entry.expires_at_ms) {
      delete bucket[key];
      this.#saveStore(store);
      return null;
    }

    return clone(entry);
  }

  getWithTrace(namespace, keyPayload, { orderId = '', auditStore = null, stage = 'ingest', metadata = {} } = {}) {
    const entry = this.get(namespace, keyPayload);
    const hit = entry !== null;
    if (auditStore && typeof auditStore.appendCacheLookup === 'function' && typeof orderId === 'string' && orderId.trim()) {
      const requiredVersions = {};
      const requirements = KEY_REQUIREMENTS[namespace] ?? [];
      for (const field of requirements) {
        if (field.endsWith('_version')) {
          requiredVersions[field] = keyPayload?.[field] ?? null;
        }
      }
      auditStore.appendCacheLookup({
        orderId,
        namespace,
        keyPayload,
        hit,
        stage,
        metadata: {
          ...metadata,
          ...requiredVersions,
        },
      });
    }
    return entry;
  }

  set(namespace, keyPayload, value, confidence, meta = {}) {
    const key = buildCacheKey(namespace, keyPayload);
    const store = this.#loadStore();
    const bucket = this.#bucketFor(store, namespace, true);
    const now = this.nowMs();

    const ttlSec = this.namespaceTtls[namespace];
    const expiresAtMs = Number.isFinite(ttlSec) && Number(ttlSec) > 0
      ? now + Number(ttlSec) * 1000
      : null;

    const entry = {
      value: clone(value),
      confidence: clampConfidence(confidence),
      meta: isPlainObject(meta) ? clone(meta) : {},
      created_at_ms: now,
      expires_at_ms: expiresAtMs,
    };

    bucket[key] = entry;
    this.#saveStore(store);
    return clone(entry);
  }

  invalidate(namespace, keyPayload) {
    const key = buildCacheKey(namespace, keyPayload);
    const store = this.#loadStore();
    const bucket = this.#bucketFor(store, namespace, false);
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, key)) return false;

    delete bucket[key];
    this.#saveStore(store);
    return true;
  }

  setWithTrace(
    namespace,
    keyPayload,
    value,
    confidence,
    meta = {},
    { orderId = '', auditStore = null, stage = 'ingest', metadata = {} } = {},
  ) {
    const entry = this.set(namespace, keyPayload, value, confidence, meta);
    if (auditStore && typeof auditStore.appendCacheWrite === 'function' && typeof orderId === 'string' && orderId.trim()) {
      const requiredVersions = {};
      const requirements = KEY_REQUIREMENTS[namespace] ?? [];
      for (const field of requirements) {
        if (field.endsWith('_version')) {
          requiredVersions[field] = keyPayload?.[field] ?? null;
        }
      }
      auditStore.appendCacheWrite({
        orderId,
        namespace,
        keyPayload,
        stage,
        confidence: entry.confidence,
        metadata: {
          ...metadata,
          ...requiredVersions,
        },
      });
    }
    return entry;
  }

  #loadStore() {
    if (!fs.existsSync(this.filePath)) {
      return { version: 1, entries: {} };
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8').trim();
      if (!raw) return { version: 1, entries: {} };
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !isPlainObject(parsed.entries)) {
        return { version: 1, entries: {} };
      }
      return parsed;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  #saveStore(store) {
    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  #bucketFor(store, namespace, create) {
    if (!CACHE_NAMESPACES.has(namespace)) {
      throw new Error(`Unsupported namespace: ${namespace}`);
    }

    if (!isPlainObject(store.entries)) store.entries = {};
    const current = store.entries[namespace];
    if (!isPlainObject(current)) {
      if (!create) return null;
      store.entries[namespace] = {};
    }
    return store.entries[namespace];
  }
}

export const createCacheStore = (options = {}) => new FileCacheStore(options);
