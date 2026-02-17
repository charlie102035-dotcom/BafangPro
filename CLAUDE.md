# BafangPro POS 系統

## Stack
- Frontend: React 18 + TypeScript + Tailwind CSS (Vite 5)
- Backend: Express 5 + better-sqlite3 (server/index.mjs)
- Python module: python_pos_module/ (LLM-based order parsing pipeline)
- Deploy: Docker (app + Caddy reverse proxy) → VPS 176.57.150.37

## Commands
- Type check: `npx tsc --noEmit`
- Build: `npm run build` (runs tsc + vite build)
- Dev: `npm run dev:full` (frontend + API concurrently)
- Python tests: `BAFANG_DB_PATH=":memory:" PYTHONPATH=src python3 -m pytest`
- Deploy: `ssh agent@176.57.150.37 "cd ~/bafang-box-order && docker compose up -d --build"`

## Architecture
- src/components/AppShell.tsx: 主要 POS 邏輯 (~12000 行，包含所有工作站 UI)
- server/index.mjs: API 入口，routes 在 server/routes/
- server/services/: 業務邏輯層
- server/fry_automation/: 煎台自動化邏輯
- python_pos_module/: Python LLM pipeline for order text parsing
- Feature flags: localStorage-based, `readFeatureFlags()` in AppShell
- 製作端 i18n: `pt(key, lang)` / `ptf(key, lang, vars)` + `PROD_I18N` table (zh-TW/vi/my/id)

## Rules
- IMPORTANT: 修改任何 .ts/.tsx 檔案後必須 `npx tsc --noEmit` 驗證零錯誤
- 修改前先 read 檔案理解現有 pattern，不要憑猜測改
- AppShell.tsx 很大，改動前用 Grep 精確定位，避免讀取整個檔案浪費 context
- Commit message 用中文，描述「為什麼」而非「什麼」
