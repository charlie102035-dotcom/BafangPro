# 八方工作流程 Demo

這個專案現在包含：
- 前端：React + Vite + Tailwind
- 後端：Express API
- 資料庫：SQLite（`server/data/auth.db`）
- 驗證：免帳密，只選「店面」登入

預設店面（profiles，已自動建立）：
- 松仁
- 北醫
- 大安

## 登入新流程

1. 選擇店面（store）
2. 直接進入系統（不需選崗位）

資料持久化：
- 店面資料寫入 SQLite（`server/data/auth.db`）
- 前端只記住「最近登入店面」在 localStorage

目前所有登入者都可看到全部視角：
- `customer`（顧客端）
- `production`（製作端）
- `packaging`（包裝端）
- `settings`（設定）
- `ingest`（進單引擎）

另新增「全螢幕模式」按鈕：
- 開啟後會隱藏主要切換器，放大工作區
- 可再按一次退出

`settings_json` 可覆蓋：
- `defaultPerspective`：`customer | production | packaging | settings | ingest`
- `allowedPerspectives`：上述字串陣列

範例：

```json
{
  "defaultPerspective": "packaging",
  "allowedPerspectives": ["packaging", "settings", "ingest"]
}
```

保守 fallback 規則：
- `settings_json` 非法或值不在允許範圍，會回退到系統預設，不會崩潰

## 本地啟動

安裝依賴：

```bash
npm install
```

只啟動前端：

```bash
npm run dev
```

只啟動 API：

```bash
npm run dev:api
```

前後端一起啟動：

```bash
npm run dev:full
```

前端預設：`http://127.0.0.1:5173`
後端預設：`http://127.0.0.1:8787`

## API（Auth）

- `GET /api/auth/users`
  - 取得店面清單（profiles）
- `POST /api/auth/login`
  - 新格式：`{ "storeId": "..." }`（推薦）
  - 相容舊欄位：`{ "userId": "..." }`
    - 會自動走店家登入流程
- `POST /api/auth/logout`
- `GET /api/auth/me`
  - 回傳 `store + user`
- `GET /api/health`

## API（POS 進單引擎）

- `POST /api/orders/ingest-pos-text`
  - 將 POS 文字送入進單引擎，預設走 Python pipeline（parser + candidates + llm + merge）
  - 建議 body 最小欄位：
    ```json
    {
      "api_version": "1.1.0",
      "store_id": "store-songren",
      "source_text": "咖哩雞肉鍋貼 x2\n酸辣湯 x1"
    }
    ```
  - 可選覆蓋：`menu_catalog`、`allowed_mods`
    - 若不帶，會自動套用 `store_id` 對應的店面配置
- `POST /api/orders/stores/:storeId/ingest-pos-text`
  - 店家專屬進單 URL（推薦給外部系統）
  - 由 URL 綁定店家，不需再在 body 帶 `store_id`
  - 可直接傳入髒資料文字，供 parser/LLM fallback 流程處理
- `GET /api/orders/review`
  - 讀取審核佇列（含前端相容欄位 `pendingReview` / `tracking`）
- `GET /api/orders/review/details`
  - 讀取待確認訂單詳細內容（含 `order_payload`、低信心行索引與原始髒資料）
- `GET /api/orders/review/:orderId`
  - 讀取單筆待確認訂單詳情
- `DELETE /api/orders/review/:orderId`
  - 刪除待確認訂單（用於「拒單」或「已人工進單後移除」）
- `POST /api/orders/review/decision`
  - 提交審核決策
  - 若帶 `patched_order`，其 `order_id` 必須與 request `order_id` 相同，否則回 `400`
- `POST /api/orders/review/clear-test-data`
  - 清空測試資料（`scope=test_only|all`，預設 `test_only`）
- `GET /api/orders/pipeline-config?store_id=...`
  - 讀取店面 menu/mods 配置與版本
- `PUT /api/orders/pipeline-config`
  - 更新店面 menu/mods 配置（即時生效，無需重啟）
  - body 範例：
    ```json
    {
      "store_id": "store-songren",
      "allowed_mods": ["加辣", "去醬", "SMOKE_MARKER_A"]
    }
    ```
- `GET /api/orders/ingest-engine/status?store_id=...`
  - 讀取目前進單引擎狀態（Python pipeline、timeout、LLM runtime、store menu/mods 版本、審核佇列摘要）
- `GET /api/orders/ingest-fixtures`
  - 讀取內建測試樣本（6+ 情境）
- `POST /api/orders/ingest-test-suite`
  - 批次執行測試樣本，可選 `inject_dirty` 注入髒資料，輸出每筆結果摘要
  - body 範例：
    ```json
    {
      "store_id": "store-songren",
      "inject_dirty": true,
      "max_cases": 6
    }
    ```

店面配置存放位置（可直接檔案維護，支援熱更新）：
- `server/data/pos_pipeline/stores/<store_id>/menu_catalog.json`
- `server/data/pos_pipeline/stores/<store_id>/allowed_mods.json`

## 前端補充

- 進單引擎已獨立成第 5 視角（`進單引擎`）：
  - 預設只顯示兩區：
    - `待確認訂單`：僅顯示「信心不足」或「包含已售完品項」的單
    - `通知`：顯示成功進單的訂單編號
  - 待確認單支援三個動作：
    - `編輯`：載入到顧客端並跳轉修單
    - `進單`：直接寫入製作/包裝流程，並從待確認清單移除
    - `拒單`：直接刪除該筆資料
  - 所有進階設定收在 `引擎調整` 折疊卡（LLM key、外部 API 範例、清空測試資料）
- 鍋貼/水餃盒數量限制已改為彈性：
  - 每盒顆數不再被容量上限阻擋
  - 盒型容量改為「建議值」

## 環境變數（可選）

- `API_PORT`：API 監聽埠（預設 `8787`）
- `AUTH_DB_PATH`：SQLite 檔案路徑（預設 `server/data/auth.db`）
- `AUTH_JWT_SECRET`：JWT 簽章密鑰（正式環境務必設定）
- `CORS_ORIGINS`：允許來源，多個用逗號分隔
  - 開發模式（`NODE_ENV != production`）預設允許 LAN 來源，方便平板/手機測試
- `POS_LLM_ENABLED`：`1/0`，是否啟用 LLM（若不設，會依是否有 API key 自動判斷）
- `POS_LLM_PROVIDER`：目前支援 `openai`
- `POS_LLM_MODEL`：預設 `gpt-4o-mini`
- `POS_LLM_TIMEOUT_S`：Python LLM 呼叫 timeout 秒數（預設 `15`）
- `POS_LLM_BASE_URL`：預設 `https://api.openai.com/v1`
- `OPENAI_API_KEY` 或 `POS_LLM_API_KEY`：OpenAI key

## 建置

```bash
npm run build
```

## VPS 公開網域 + 自動更新（Push 即部署）

這個專案已內建以下檔案，可直接做「一次上線，之後 git push 自動更新」：

- `Dockerfile`
- `docker-compose.yml`
- `deploy/Caddyfile`
- `deploy/deploy.sh`
- `.github/workflows/deploy-vps.yml`
- `.env.production.example`

### 1. VPS 首次安裝

在 Ubuntu/Debian VPS：

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER
```

重新登入 SSH 讓 docker 群組生效。

也可用一鍵初始化（推薦）：

```bash
curl -fsSL https://raw.githubusercontent.com/charlie102035-dotcom/BafangPro/main/deploy/bootstrap-vps.sh -o /tmp/bootstrap-vps.sh
chmod +x /tmp/bootstrap-vps.sh
REPO_URL="https://github.com/charlie102035-dotcom/BafangPro.git" \
DOMAIN="app.yourdomain.com" \
EMAIL="ops@yourdomain.com" \
AUTH_JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')" \
ADMIN_PASSWORD="0000" \
/tmp/bootstrap-vps.sh
```

如果你暫時沒有網域，可直接填 VPS IP（先用 HTTP）：

```bash
REPO_URL="https://github.com/charlie102035-dotcom/BafangPro.git" \
DOMAIN="176.57.150.37" \
EMAIL="charlie.102035@gmail.com" \
AUTH_JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')" \
ADMIN_PASSWORD="0000" \
/tmp/bootstrap-vps.sh
```

### 2. DNS 與程式放置

1. 把網域 `A` 記錄指到 VPS 公網 IP（例如 `app.yourdomain.com`）。
2. 在 VPS 準備專案目錄：

```bash
sudo mkdir -p /opt
sudo chown -R $USER:$USER /opt
cd /opt
git clone <你的repo網址> bafang-box-order
cd bafang-box-order
cp .env.production.example .env
```

編輯 `.env` 至少要改：

- `DOMAIN`
- `EMAIL`
- `AUTH_JWT_SECRET`（長隨機字串）
- `ADMIN_PASSWORD`

### 3. 首次啟動

```bash
docker compose up -d --build
docker compose ps
```

成功後會由 Caddy 自動申請 HTTPS 憑證。

### 4. GitHub 自動部署（之後只要 push）

在 GitHub Repository Secrets 新增：

- `VPS_HOST`：VPS IP 或網域
- `VPS_USER`：SSH 使用者
- `VPS_SSH_KEY`：該使用者私鑰（整段）
- `VPS_PORT`：通常 `22`
- `VPS_APP_DIR`：`/opt/bafang-box-order`

完成後，每次 push 到 `main` 會觸發 `.github/workflows/deploy-vps.yml`，SSH 到 VPS 執行：

```bash
bash deploy/deploy.sh
```

也就是：

- `git pull`
- `docker compose up -d --build`

## Render 部署（改用 Render 推薦走這段）

本專案已提供 `/render.yaml`，可直接 Blueprint 部署。

1. 到 Render Dashboard 選 `New +` -> `Blueprint`  
2. 連接 GitHub repo：`charlie102035-dotcom/BafangPro`  
3. 套用 `render.yaml` 後，填入這些 secret：
   - `AUTH_JWT_SECRET`
   - `OPENAI_API_KEY` 或 `POS_LLM_API_KEY`（要用 AI 才填）
4. 部署完成後，將 `CORS_ORIGINS` 改成你的實際 Render 網址（若服務名非 `bafang-pro`）：
   - 例如：`https://<your-service>.onrender.com`

注意：
- 目前 `render.yaml` 使用 `plan: starter`，因為有掛載 persistent disk（SQLite 與店面設定會保存）。  
- 如果改成 free，通常無法使用 persistent disk，資料可能在重啟後遺失。  

不需要再手動上傳 zip、解壓、重部署。

[deploy check 2026年 2月15日 星期日 10時52分28秒 CST]
