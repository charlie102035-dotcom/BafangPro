import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULT_PYTHON_BIN = process.env.POS_PIPELINE_PYTHON_BIN || 'python3';
const DEFAULT_TIMEOUT_MS = Number(process.env.POS_PIPELINE_TIMEOUT_MS || 25000);
const DEFAULT_INGEST_SCRIPT = process.env.POS_PIPELINE_CLI_PATH
  || path.join(PROJECT_ROOT, 'python_pos_module', 'scripts', 'ingest_cli.py');

const DEFAULT_LLM_PROVIDER = process.env.POS_LLM_PROVIDER || 'openai';
const DEFAULT_LLM_MODEL = process.env.POS_LLM_MODEL || 'gpt-4o-mini';
const DEFAULT_LLM_TIMEOUT_S = Number(process.env.POS_LLM_TIMEOUT_S || 15);
const DEFAULT_LLM_BASE_URL = process.env.POS_LLM_BASE_URL || 'https://api.openai.com/v1';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseFirstJsonLine = (rawText) => {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('python ingest output is empty');

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // continue to previous line
    }
  }

  return JSON.parse(text);
};

const normalizeText = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
};

const parseBool = (value, fallback = null) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
};

export const isPythonIngestEnabled = () => process.env.POS_PIPELINE_PYTHON_DISABLED !== '1';

export const getPythonLlmRuntime = (llmConfig = null) => {
  const cfg = isObject(llmConfig) ? llmConfig : {};
  const provider = normalizeText(cfg.provider, normalizeText(process.env.POS_LLM_PROVIDER, DEFAULT_LLM_PROVIDER)).toLowerCase();
  const model = normalizeText(cfg.model, normalizeText(process.env.POS_LLM_MODEL, DEFAULT_LLM_MODEL));
  const baseUrl = normalizeText(process.env.POS_LLM_BASE_URL, DEFAULT_LLM_BASE_URL);
  const timeoutS = Number.isFinite(Number(cfg.timeout_s))
    ? Math.max(2, Math.min(60, Math.round(Number(cfg.timeout_s))))
    : (Number.isFinite(DEFAULT_LLM_TIMEOUT_S) && DEFAULT_LLM_TIMEOUT_S > 0 ? DEFAULT_LLM_TIMEOUT_S : 15);
  const enabledFlag = typeof cfg.enabled === 'boolean' ? cfg.enabled : parseBool(process.env.POS_LLM_ENABLED, null);
  const hasApiKey = Boolean(
    normalizeText(cfg.api_key)
    || normalizeText(process.env.POS_LLM_API_KEY)
    || normalizeText(process.env.OPENAI_API_KEY),
  );

  let enabled = false;
  let reason = 'missing_api_key';
  if (enabledFlag === false) {
    enabled = false;
    reason = 'env_disabled';
  } else if (provider !== 'openai') {
    enabled = false;
    reason = 'unsupported_provider';
  } else if (!hasApiKey) {
    enabled = false;
    reason = 'missing_api_key';
  } else {
    enabled = true;
    reason = 'ready';
  }

  return {
    enabled,
    provider,
    model,
    timeout_s: timeoutS,
    base_url: baseUrl,
    reason,
  };
};

export function runPythonIngest({
  receiptText,
  orderId,
  menuCatalog,
  allowedMods,
  llmConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pythonBin = DEFAULT_PYTHON_BIN,
  scriptPath = DEFAULT_INGEST_SCRIPT,
} = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      receipt_text: typeof receiptText === 'string' ? receiptText : '',
      order_id: typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null,
      menu_catalog: menuCatalog,
      allowed_mods: Array.isArray(allowedMods) ? allowedMods : [],
    };

    const llmTimeoutMs = Number.isFinite(Number(llmConfig?.timeout_s))
      ? Math.max(2000, Math.round(Number(llmConfig.timeout_s) * 1000))
      : 0;
    const derivedTimeoutMs = llmTimeoutMs > 0 ? llmTimeoutMs + 5000 : 0;
    const effectiveTimeoutMs = Math.max(
      1000,
      Number(timeoutMs) || DEFAULT_TIMEOUT_MS,
      derivedTimeoutMs || 0,
    );

    const child = spawn(pythonBin, [scriptPath], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(isObject(llmConfig) ? {
          ...(typeof llmConfig.provider === 'string' ? { POS_LLM_PROVIDER: llmConfig.provider } : {}),
          ...(typeof llmConfig.model === 'string' ? { POS_LLM_MODEL: llmConfig.model } : {}),
          ...(Number.isFinite(Number(llmConfig.timeout_s)) ? { POS_LLM_TIMEOUT_S: String(llmConfig.timeout_s) } : {}),
          ...(typeof llmConfig.enabled === 'boolean' ? { POS_LLM_ENABLED: llmConfig.enabled ? '1' : '0' } : {}),
          ...(typeof llmConfig.api_key === 'string' && llmConfig.api_key.trim()
            ? { POS_LLM_API_KEY: llmConfig.api_key.trim() }
            : {}),
        } : {}),
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const done = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      const error = new Error(`python ingest timeout after ${effectiveTimeoutMs}ms`);
      error.code = 'PYTHON_INGEST_TIMEOUT';
      done(() => reject(error));
    }, effectiveTimeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      done(() => reject(error));
    });

    child.on('close', (code) => {
      done(() => {
        try {
          const parsed = parseFirstJsonLine(stdout);
          if (!isObject(parsed)) {
            const error = new Error('python ingest response must be a JSON object');
            error.code = 'PYTHON_INGEST_INVALID_RESPONSE';
            throw error;
          }
          if (parsed.ok !== true) {
            const message = isObject(parsed.error) && typeof parsed.error.message === 'string'
              ? parsed.error.message
              : `python ingest failed with exit code ${code}`;
            const error = new Error(message);
            error.code = 'PYTHON_INGEST_ERROR';
            error.details = parsed.error;
            error.stderr = stderr;
            throw error;
          }
          resolve({
            result: parsed.result,
            stderr,
          });
          return;
        } catch (error) {
          if ((code ?? 0) === 0) {
            error.stderr = stderr;
            error.stdout = stdout;
            reject(error);
            return;
          }
        }

        const fallbackError = new Error(`python ingest exited with code ${code}`);
        fallbackError.code = 'PYTHON_INGEST_EXIT_NON_ZERO';
        fallbackError.stderr = stderr;
        fallbackError.stdout = stdout;
        reject(fallbackError);
      });
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch (error) {
      done(() => reject(error));
    }
  });
}

export const PYTHON_INGEST_DEFAULTS = Object.freeze({
  pythonBin: DEFAULT_PYTHON_BIN,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  scriptPath: DEFAULT_INGEST_SCRIPT,
});
