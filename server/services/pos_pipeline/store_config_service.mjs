import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_STORE_ID = 'default';
const DEFAULT_STORE_CONFIG_ROOT = process.env.POS_STORE_CONFIG_ROOT
  || path.join(PROJECT_ROOT, 'server', 'data', 'pos_pipeline', 'stores');
const DEFAULT_MENU_CATALOG_PATH = process.env.POS_MENU_CATALOG_PATH
  || path.join(PROJECT_ROOT, 'python_pos_module', 'fixtures', 'menu_catalog.json');
const DEFAULT_ALLOWED_MODS_PATH = process.env.POS_ALLOWED_MODS_PATH
  || path.join(PROJECT_ROOT, 'python_pos_module', 'fixtures', 'allowed_mods.json');

const DEFAULT_SEEDED_STORE_IDS = ['store-songren', 'store-tmuh', 'store-daan'];
const LLM_CONFIG_FILENAME = 'llm_config.json';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const normalizeStoreId = (value) => {
  const text = normalizeText(value);
  if (!text) return DEFAULT_STORE_ID;
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64) || DEFAULT_STORE_ID;
};

const hashJson = (value) => {
  const json = JSON.stringify(value);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
};

const fileFingerprint = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return 'missing';
  }
};

const readJsonFile = (filePath, fallbackValue) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return clone(fallbackValue);
  }
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  return [];
};

const normalizeAllowedMods = (value) => {
  const seen = new Set();
  const output = [];
  for (const entry of ensureArray(value)) {
    if (typeof entry !== 'string') continue;
    const token = entry.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    output.push(token);
  }
  return output;
};

const validateMenuCatalogPayload = (value) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isObject(entry)) {
        throw new Error('menu_catalog list entries must be objects');
      }
      const hasAnyKey = Boolean(
        normalizeText(entry.item_id)
        || normalizeText(entry.id)
        || normalizeText(entry.canonical_name)
        || normalizeText(entry.name),
      );
      if (!hasAnyKey) {
        throw new Error('menu_catalog list entry missing identifier fields');
      }
    }
    return;
  }

  if (isObject(value)) return;
  throw new Error('menu_catalog must be object or list');
};

const validateAllowedModsPayload = (value) => {
  if (!Array.isArray(value)) {
    throw new Error('allowed_mods must be list[string]');
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error('allowed_mods entries must be string');
    }
  }
};

const redactApiKey = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.length <= 8) return '***';
  return `${text.slice(0, 3)}***${text.slice(-4)}`;
};

const normalizeLlmProvider = (value) => {
  const text = normalizeText(value, 'openai').toLowerCase();
  if (text === 'openai') return 'openai';
  return 'openai';
};

const normalizeLlmModel = (value) => normalizeText(value, 'gpt-4o-mini');

const normalizeLlmTimeoutS = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 15;
  return Math.max(2, Math.min(60, Math.round(parsed)));
};

const normalizeLlmEnabled = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  return null;
};

const validateLlmConfigPayload = (value) => {
  if (!isObject(value)) {
    throw new Error('llm_config must be object');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'provider') && typeof value.provider !== 'string') {
    throw new Error('llm_config.provider must be string');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'model') && typeof value.model !== 'string') {
    throw new Error('llm_config.model must be string');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'enabled') && typeof value.enabled !== 'boolean') {
    throw new Error('llm_config.enabled must be boolean');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'timeout_s')) {
    const parsed = Number(value.timeout_s);
    if (!Number.isFinite(parsed)) {
      throw new Error('llm_config.timeout_s must be number');
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'api_key') && typeof value.api_key !== 'string') {
    throw new Error('llm_config.api_key must be string');
  }
};

class StoreConfigService {
  constructor({
    storeRoot = DEFAULT_STORE_CONFIG_ROOT,
    defaultMenuCatalogPath = DEFAULT_MENU_CATALOG_PATH,
    defaultAllowedModsPath = DEFAULT_ALLOWED_MODS_PATH,
    seededStoreIds = DEFAULT_SEEDED_STORE_IDS,
  } = {}) {
    this.storeRoot = storeRoot;
    this.defaultMenuCatalogPath = defaultMenuCatalogPath;
    this.defaultAllowedModsPath = defaultAllowedModsPath;
    this.cache = new Map();

    this.defaultMenuCatalog = readJsonFile(defaultMenuCatalogPath, []);
    this.defaultAllowedMods = normalizeAllowedMods(readJsonFile(defaultAllowedModsPath, []));

    fs.mkdirSync(this.storeRoot, { recursive: true });
    for (const rawStoreId of seededStoreIds) {
      this.#ensureStoreFiles(normalizeStoreId(rawStoreId));
    }
  }

  getConfig(rawStoreId = DEFAULT_STORE_ID) {
    const storeId = normalizeStoreId(rawStoreId);
    const { menuCatalogPath, allowedModsPath, llmConfigPath } = this.#ensureStoreFiles(storeId);
    const nextMenuFingerprint = fileFingerprint(menuCatalogPath);
    const nextModsFingerprint = fileFingerprint(allowedModsPath);
    const nextLlmFingerprint = fileFingerprint(llmConfigPath);

    const cached = this.cache.get(storeId);
    if (
      cached
      && cached.menuFingerprint === nextMenuFingerprint
      && cached.modsFingerprint === nextModsFingerprint
      && cached.llmFingerprint === nextLlmFingerprint
    ) {
      return clone(cached.payload);
    }

    const menuCatalogRaw = readJsonFile(menuCatalogPath, this.defaultMenuCatalog);
    const menuCatalog = Array.isArray(menuCatalogRaw) || isObject(menuCatalogRaw)
      ? menuCatalogRaw
      : clone(this.defaultMenuCatalog);

    const allowedModsRaw = readJsonFile(allowedModsPath, this.defaultAllowedMods);
    const allowedMods = normalizeAllowedMods(allowedModsRaw);

    const llmConfigRaw = readJsonFile(llmConfigPath, {});
    const llmConfig = isObject(llmConfigRaw) ? llmConfigRaw : {};
    const llmProvider = normalizeLlmProvider(llmConfig.provider);
    const llmModel = normalizeLlmModel(llmConfig.model);
    const llmTimeoutS = normalizeLlmTimeoutS(llmConfig.timeout_s);
    const llmEnabled = normalizeLlmEnabled(llmConfig.enabled);
    const llmApiKey = normalizeText(llmConfig.api_key);

    const payload = {
      store_id: storeId,
      menu_catalog: menuCatalog,
      allowed_mods: allowedMods,
      menu_catalog_version: `menu_${hashJson(menuCatalog)}`,
      allowed_mods_version: `mods_${hashJson(allowedMods)}`,
      llm_config_version: `llm_${hashJson({
        provider: llmProvider,
        model: llmModel,
        timeout_s: llmTimeoutS,
        enabled: llmEnabled,
        has_api_key: Boolean(llmApiKey),
      })}`,
      llm_config: {
        provider: llmProvider,
        model: llmModel,
        timeout_s: llmTimeoutS,
        enabled: llmEnabled,
        has_api_key: Boolean(llmApiKey),
        api_key_redacted: redactApiKey(llmApiKey),
      },
      file_paths: {
        menu_catalog: menuCatalogPath,
        allowed_mods: allowedModsPath,
        llm_config: llmConfigPath,
      },
      loaded_at: new Date().toISOString(),
    };

    this.cache.set(storeId, {
      menuFingerprint: nextMenuFingerprint,
      modsFingerprint: nextModsFingerprint,
      llmFingerprint: nextLlmFingerprint,
      payload,
    });

    return clone(payload);
  }

  updateConfig(rawStoreId, { menu_catalog, allowed_mods } = {}) {
    const storeId = normalizeStoreId(rawStoreId);
    const { menuCatalogPath, allowedModsPath } = this.#ensureStoreFiles(storeId);
    const current = this.getConfig(storeId);

    const nextMenuCatalog = menu_catalog === undefined ? current.menu_catalog : menu_catalog;
    const nextAllowedModsRaw = allowed_mods === undefined ? current.allowed_mods : allowed_mods;

    validateMenuCatalogPayload(nextMenuCatalog);
    validateAllowedModsPayload(nextAllowedModsRaw);

    const nextAllowedMods = normalizeAllowedMods(nextAllowedModsRaw);

    fs.writeFileSync(menuCatalogPath, `${JSON.stringify(nextMenuCatalog, null, 2)}\n`, 'utf8');
    fs.writeFileSync(allowedModsPath, `${JSON.stringify(nextAllowedMods, null, 2)}\n`, 'utf8');

    this.cache.delete(storeId);
    return this.getConfig(storeId);
  }

  getLlmConfig(rawStoreId = DEFAULT_STORE_ID) {
    const storeId = normalizeStoreId(rawStoreId);
    const config = this.getConfig(storeId);
    return {
      store_id: storeId,
      llm_config: config.llm_config,
      llm_config_version: config.llm_config_version,
      loaded_at: config.loaded_at,
    };
  }

  updateLlmConfig(rawStoreId, { llm_config } = {}) {
    const storeId = normalizeStoreId(rawStoreId);
    if (llm_config === undefined) {
      throw new Error('llm_config is required');
    }
    validateLlmConfigPayload(llm_config);

    const { llmConfigPath } = this.#ensureStoreFiles(storeId);
    const current = readJsonFile(llmConfigPath, {});
    const merged = isObject(current) ? { ...current, ...llm_config } : { ...llm_config };

    const normalized = {
      provider: normalizeLlmProvider(merged.provider),
      model: normalizeLlmModel(merged.model),
      timeout_s: normalizeLlmTimeoutS(merged.timeout_s),
      enabled: normalizeLlmEnabled(merged.enabled),
      api_key: normalizeText(merged.api_key),
    };

    fs.writeFileSync(llmConfigPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    this.cache.delete(storeId);
    return this.getLlmConfig(storeId);
  }

  getLlmRuntimeConfig(rawStoreId = DEFAULT_STORE_ID) {
    const storeId = normalizeStoreId(rawStoreId);
    const { llmConfigPath } = this.#ensureStoreFiles(storeId);
    const current = readJsonFile(llmConfigPath, {});
    const source = isObject(current) ? current : {};
    return {
      provider: normalizeLlmProvider(source.provider),
      model: normalizeLlmModel(source.model),
      timeout_s: normalizeLlmTimeoutS(source.timeout_s),
      enabled: normalizeLlmEnabled(source.enabled),
      api_key: normalizeText(source.api_key),
    };
  }

  listStores() {
    const entries = fs.readdirSync(this.storeRoot, { withFileTypes: true });
    const stores = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeStoreId(entry.name));
    return [...new Set(stores)].sort();
  }

  invalidate(rawStoreId = null) {
    if (rawStoreId === null || rawStoreId === undefined) {
      this.cache.clear();
      return;
    }
    const storeId = normalizeStoreId(rawStoreId);
    this.cache.delete(storeId);
  }

  #ensureStoreFiles(storeId) {
    const safeStoreId = normalizeStoreId(storeId);
    const storeDir = path.join(this.storeRoot, safeStoreId);
    fs.mkdirSync(storeDir, { recursive: true });

    const menuCatalogPath = path.join(storeDir, 'menu_catalog.json');
    const allowedModsPath = path.join(storeDir, 'allowed_mods.json');
    const llmConfigPath = path.join(storeDir, LLM_CONFIG_FILENAME);

    if (!fs.existsSync(menuCatalogPath)) {
      fs.writeFileSync(menuCatalogPath, `${JSON.stringify(this.defaultMenuCatalog, null, 2)}\n`, 'utf8');
    }
    if (!fs.existsSync(allowedModsPath)) {
      fs.writeFileSync(allowedModsPath, `${JSON.stringify(this.defaultAllowedMods, null, 2)}\n`, 'utf8');
    }
    if (!fs.existsSync(llmConfigPath)) {
      fs.writeFileSync(
        llmConfigPath,
        `${JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini', timeout_s: 15, enabled: null, api_key: '' }, null, 2)}\n`,
        'utf8',
      );
    }

    return {
      storeDir,
      menuCatalogPath,
      allowedModsPath,
      llmConfigPath,
    };
  }
}

export const createStoreConfigService = (options = {}) => new StoreConfigService(options);
export { normalizeStoreId };
