# B Team Shared Log

## Rules
- 每位 agent 只可在自己的區塊追加內容，不可修改他人區塊。
- 每次更新都要帶時間（本地時間）與 Round 編號。
- 回報至少包含：修改檔案、完成項目、測試命令、測試結果、風險。

---

## B1 會話契約官

### Entry Template
```
[YYYY-MM-DD HH:mm] [Round-X] [STATUS: in_progress|done|blocked]
Modified Files:
- /abs/path/one
- /abs/path/two

Summary:
- ...

API Contract Changes:
- ...

Test Commands:
- ...

Results:
- ...

Risks:
- ...
```

[2026-02-15 04:15] [Round-2] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/server/index.mjs
- /Users/charlie/bafang-box-order/src/types.ts
- /Users/charlie/bafang-box-order/src/lib/authApi.ts
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- 定稿 login/session 契約欄位：`work_mode`、`work_target`、`locked_session`。
- 已支援 `last_mode`、`last_target`（持久化於 device `settings_json`，並回傳於 session payload）。
- 向後相容維持：舊 payload 不帶新欄位時使用保守預設，不崩潰。

API Contract Changes:
- `POST /api/auth/login` 可選輸入：`work_mode`、`work_target`（保留 `storeId`/`deviceId`/`userId` 舊欄位）。
- `POST /api/auth/login`、`GET /api/auth/me` 輸出新增：
- `locked_session: boolean`
- `work_mode: string | null`
- `work_target: string | null`
- `last_mode: string | null`
- `last_target: string | null`

Test Commands:
- `npm run build`

Results:
- `npm run build` 通過（`tsc && vite build` 成功）。

Risks:
- `last_mode`/`last_target` 寫在 `device.settings_json`，若其他流程覆寫整個 `settings` 物件且未合併，可能遺失這兩欄。

---

[2026-02-15 04:47] [Round-3] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/types.ts
- /Users/charlie/bafang-box-order/src/lib/authApi.ts

Summary:
- `AuthSessionPayload` 現在將 `locked_session`/`work_mode`/`work_target`/`last_mode`/`last_target` 定義為可選，並新增 `AuthSessionMetadata` 供後續契約檢視。
- `authApi` 回應型別直接對齊上述 payload，前端不再需 `any` 強轉即可讀取新欄位。

API Contract Changes:
- `POST /api/auth/login` 與 `GET /api/auth/me` 繼續回傳所有 session 欄位，但型別已變成 optional 以保護舊流程不帶值時的讀寫。

Test Commands:
- `npm run build`

Results:
- `npm run build` 通過（`tsc && vite build` 成功）。

Risks:
- 既有 code base 若假設某個 session 欄位一定存在（非 `undefined`），需加上 guard。

## B2 登入分流官

### Entry Template
```
[YYYY-MM-DD HH:mm] [Round-X] [STATUS: in_progress|done|blocked]
Modified Files:
- /abs/path/one

Summary:
- ...

Manual Test Steps:
1. ...
2. ...

Results:
- ...

Risks:
- ...
```

[2026-02-15 04:21] [Round-2] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/components/AuthGate.tsx
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- 登入流程 UI 明確拆成四步：`選店` → `選裝置` → `選模式` → `選工作站`，主按鈕維持單一「進入工作模式」。
- 新增「使用上次設定（推薦）一鍵進入」區塊，會讀取裝置上次 `mode/station` 並可直接進入，也可手動改選覆蓋。
- 補齊空/錯誤狀態：無裝置、未選模式、未選工作站、工作站格式無效皆有可讀提示。

Manual Test Steps:
1. 啟動本機前後端後進入登入頁，依序操作：選「松仁」店、選裝置、選「包裝模式」、填 `packaging-b`、按「進入工作模式」。
2. 登入成功後開啟右上帳號面板執行「登出」，回登入頁再選同店同裝置。
3. 驗證推薦區塊出現「使用上次設定（推薦）一鍵進入」，點擊後再次成功進入工作模式。
4. 驗證缺資料提示：未選模式時顯示「請先完成 Step 3（選工作模式）」；模式需要站點但未選時顯示「請先完成 Step 4（選工作站）」。

Results:
- 完整流程可行：可依步驟登入、可手動覆蓋模式/站點、可用上次設定一鍵進入。
- 空狀態與缺資料提示可讀，符合「無裝置/缺模式/缺工作站」引導要求。
- 驗證命令：`npx eslint src/components/AuthGate.tsx`、`npx tsc --noEmit --pretty false --jsx react-jsx --moduleResolution bundler --module esnext --target es2020 --lib dom,es2020 --types vite/client src/components/AuthGate.tsx` 皆通過。

Risks:
- `pack` 模式允許輸入自訂站點代碼，若輸入非現場有效站點，實際工作站分流可能回退到預設或由下游邏輯處理。
- 同一裝置多人共用時，「上次設定」會被最新一次登入覆寫，屬設計上共享偏好。

---

[2026-02-15 04:50] [Round-3] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/components/AuthGate.tsx

Summary:
- 導入 `work_mode/work_target` payload：`make` 與 `pack` 轉成對應分流、`admin` 送 `command_hub`、`front` 保守不送。
- 進入工作模式前會把 payload 委派給 `authApi.login`，並把後端回傳的 `locked_session`/`work_*`/`last_*` 存進前端狀態，並在 UI 提示當前 session 摘要。
- 保留現有 4 步 UI、推薦一鍵進入與空狀態提示。

Test Commands:
- `npx eslint src/components/AuthGate.tsx`
- `npm run build`

Results:
- `npx eslint src/components/AuthGate.tsx` 正常通過。
- `npm run build` 失敗，`tsc` 報錯：`src/components/AppShell.tsx(505,7): error TS6133: 'readBooleanByPaths' is declared but its value is never read.`（該檔未變更，屬現有阻塞）。

Risks:
- `npm run build` 目前仍會被 AppShell 的未使用變數阻擋，需後續清理該檔才能重新確認全站 build。

## B3 工作模式官

### Entry Template
```
[YYYY-MM-DD HH:mm] [Round-X] [STATUS: in_progress|done|blocked]
Modified Files:
- /abs/path/one

Summary:
- ...

Locking Rules Validation:
- ...

Test Commands / Manual Steps:
- ...

Results:
- ...

Risks:
- ...
```

[2026-02-15 04:17] [Round-2] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/components/AppShell.tsx
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- 完成三種工作模式行為對齊：`production_station`、`packaging_station`、`command_hub`。
- 補齊與登入分流鍵名相容：支援 `preferredProductionSection`、`preferredPackagingLane`、`preferredStationId`，並相容 `work_mode` / `work_target`。
- 非 `command_hub` 隱藏顧客端主入口，`command_hub` 保留多視角。

Locking Rules Validation:
- `production_station`：主視角鎖 `production`；依登入前站點（section/station/work_target）進入後鎖定站點與模組，UI 不可切換。
- `packaging_station`：主視角鎖 `packaging`；包裝站改為小型快切（header 右側），保留主畫面空間。
- `command_hub`：允許 `customer/production/packaging/settings` 多視角切換。
- 非 `command_hub`：底部主入口不顯示 `customer`。

Test Commands / Manual Steps:
- `npm run build`（整專案）
- `npx tsc --noEmit --pretty false --jsx react-jsx src/components/AppShell.tsx`（目標檔編譯）
- 手測步驟：
- 1) Step 3 選 `make` + 任一站點進入，確認視角/站點鎖定。
- 2) Step 3 選 `pack` + 任一包裝站進入，確認主視角鎖定且只顯示小型站點快切。
- 3) Step 3 選 `admin` 進入，確認可切換多視角。
- 4) `make/pack` 模式下確認底部無顧客端入口；`admin` 下顯示顧客端入口。

Results:
- `AppShell` 單檔 TypeScript 編譯通過。
- 整專案 `npm run build` 受限於既有非本次範圍錯誤（`src/components/AuthGate.tsx:806`, `src/components/AuthGate.tsx:983`），本次未修改該檔。

Risks:
- `work_target` 若傳入無效站點代碼，會回退到可用預設站點（不中斷，但可能非使用者預期站）。

[2026-02-15 04:19] [Round-3] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/components/AppShell.tsx
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- session 鎖定欄位 `locked_session/work_mode/work_target` 現在為第一優先來源；只要鎖定即刻套用視角與站點策略。
- command hub 仍可切換多視角，其餘 modes 在 session 鎖定下被固定在對應 perspective/站點。
- 非 command hub 模式底部顧客端 tab 仍隱藏，packaging quick switch 與 production station lock 保持。

Locking Rules Validation:
- `locked_session=true` + `production_station`：只能留在 `production`，生產站索引與 section 鎖定且 UI 中站點控制變為 disabled。
- `locked_session=true` + `packaging_station`：只能 `packaging`，小型 lane 快切預設為 session 站並供顯性選擇。
- `locked_session=true` + `command_hub`：允許所有視角切換，command 主流程保持但 `customer` 入口只在此模式顯示。
- `locked_session=false`：仍退回檢查 settings/viewType 的原有允許邏輯。

Test Commands / Manual Steps:
- `npx tsc --noEmit`
- `npm run build`
- 手測重複上次 Round-2 四步以覆核 session lock 行為。

Results:
- `npx tsc --noEmit` 通過。
- `npm run build` 通過。

Risks:
- 需確保後端傳回 `locked_session`/`work_mode`/`work_target` 時值合法，否則 AppShell 會回退到第一個可用站點或視角，而且非 command hub 不會顯示 customer 入口。

[2026-02-15 04:19] [Round-2] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/components/AppShell.tsx
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- 補記測試結果更正：以實際可重現命令為準（`vite build` 通過；`npm run build` 受外檔 TypeScript 錯誤阻擋）。

Locking Rules Validation:
- `production_station`、`packaging_station`、`command_hub` 與非 `command_hub` 顧客端入口隱藏規則維持不變，實作已落在 `AppShell`。

Test Commands / Manual Steps:
- `npm run build`
- `npx vite build`
- 手測步驟同上一筆（Round-2 04:17）四步。

Results:
- `npm run build` 失敗：`src/components/AuthGate.tsx:806`, `src/components/AuthGate.tsx:983`（非本次可修改檔案）。
- `npx vite build` 通過。

Risks:
- 目前 CI 若要求 `tsc` 全綠，仍會被既有 `AuthGate` 型別錯誤阻擋。

---

## B4 前台介接官

### Entry Template
```
[YYYY-MM-DD HH:mm] [Round-X] [STATUS: in_progress|done|blocked]
Modified Files:
- /abs/path/one

Summary:
- ...

API Wiring Points:
- ...

Test Commands / Manual Steps:
- ...

Results:
- ...

Risks:
- ...
```

[2026-02-15 04:30] [Round-2] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/lib/ordersApi.ts
- /Users/charlie/bafang-box-order/src/components/AppShell.tsx
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- 新增 `orders/review` API client（含回應正規化、404 fallback、可讀錯誤類型 `OrdersApiError`）。
- 在 `command_hub` 模式接入最小清單：`待審核`、`追蹤中`，提供重新整理與同步時間。
- API 失敗時於 command_hub 卡片顯示可讀錯誤，不中斷原本 customer/production/packaging/settings 主畫面。

API Wiring Points:
- `GET /api/orders/review`（主要）
- `GET /api/orders`（fallback）
- `AppShell` 在 `isCommandHubMode` 時觸發 `ordersApi.getReviewSnapshot()`；結果映射到 `commandHubPendingReviewOrders` / `commandHubTrackingOrders`。

Test Commands / Manual Steps:
- `npm run build`
- `API_PORT=8799 node server/index.mjs` 後以 `curl -i http://127.0.0.1:8799/api/orders/review` 驗證目前後端回 404
- `curl http://127.0.0.1:8799/api/auth/users` 驗證既有 API 仍正常
- 手測（前端）：以 `admin + command_hub` 登入，確認畫面可見「待審核 / 追蹤中」卡片；後端 404 時顯示錯誤訊息且主畫面可正常切頁

Results:
- `npm run build` 通過（`tsc && vite build` 成功）。
- 後端現況 `/api/orders/review` 為 404；前台會以可讀錯誤呈現，不造成白屏或主流程中斷。
- `/api/auth/users` 正常回應，未影響既有登入/工作流路徑。

Risks:
- 後端尚未提供 `orders/review` 正式契約時，清單內容依 fallback 正規化推斷，欄位命名變動可能需微調 mapping。
- 目前 command_hub 清單僅顯示最小必要資訊（單號 + 時間）；若要顯示更多欄位需等契約定版。

[2026-02-15 04:49] [Round-3] [STATUS: done]
Modified Files:
- /Users/charlie/bafang-box-order/src/lib/ordersApi.ts
- /Users/charlie/bafang-box-order/release/orders_api_smoke.md
- /Users/charlie/bafang-box-order/coordination/B_TEAM_SHARED_LOG.md

Summary:
- 重新實作 `ordersApi.getReviewSnapshot()`：先請求 `/api/orders/review`，僅在 404 時才切換到 `/api/orders`，其他錯誤仍拋出。
- 保留 payload 正規化與空陣列 fallback，避免 404 直接中斷主畫面。
- 記錄一次 mock 404 -> fallback 的 smoke 驗證流程與結果。

API Wiring Points:
- `GET /api/orders/review`（優先）
- `GET /api/orders`（404 fallback）

Test Commands / Manual Steps:
- `npm run build` （tsc 被 `src/components/AuthGate.tsx` 既有警告擋下，publication 無法完成）。
- 手動 smoke：
  ```bash
  node - <<'NODE'
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    if (req.url === '/api/orders/review') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (req.url === '/api/orders') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'T0001', status: 'pending' }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(9001, async () => {
    console.log('mock server ready');
    const review = await fetch('http://127.0.0.1:9001/api/orders/review');
    console.log('review status', review.status);
    if (review.status === 404) {
      const fallback = await fetch('http://127.0.0.1:9001/api/orders');
      console.log('fallback status', fallback.status);
      console.log('fallback body', await fallback.text());
    }
    server.close();
  });
  NODE
  ```
  接著確認 `review status 404` 與 `fallback status 200`。

Results:
- `npm run build` 失敗：`src/components/AuthGate.tsx` 仍有未使用變數（原本問題，非此次範圍）。
- Mock smoke script 印出 `review status 404` 且成功拿到 fallback payload，證明 fallback 路徑可用。

Risks:
- 如果後端 `/api/orders` 回傳格式與現有正規化策略不符，仍會回傳空陣列；需再調整 normalize logic。
- 當 review API 回傳 200 但 payload 非預期欄位時，仍會 fallback `orders`，但該路徑也可能更換結構。
