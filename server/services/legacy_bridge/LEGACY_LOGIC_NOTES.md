# Legacy Logic Extraction Notes

來源檔案（2026-02-15）：
- `/tmp/bafang_legacy_src/display_wifi_2/display_wifi_2.php`
- `/tmp/bafang_legacy_src/pick_display8/pick_display8.php`
- `/tmp/bafang_legacy_src/p1/p1.php`
- `/tmp/bafang_legacy_src/p2/p2.php`
- `/tmp/bafang_legacy_src/p3/p3.php`
- `/tmp/bafang_legacy_src/p21/p21.php`
- `/tmp/bafang_legacy_src/display_call_10*/display_call_10*.php`

## 1) POS 抓單方式（legacy）

觀察到舊系統主要透過 HTTP GET 輪詢內網 API：
- `.../kds/fired/find_real_order.php?device=1&mode=1`
- `.../kds/fired/read_order2_220225.php?...`
- `.../kds/noodle/find_noodle.php?...`

資料格式不是 JSON，而是 `#` 與 `^` 分隔：
- `payload.split("#")`
- 每筆明細再 `segment.split("^")`
- 常見欄位：
  - `[1]` 品項名
  - `[2]` 時間
  - `[3]` 數量
  - `[4]` 桌號/外帶代碼
  - `[5]` 單號（顯示用）
  - `[6]` 訂單序號（分組 key）
  - `[7]` 明細序號
  - `[10]` 備註

## 2) 煎台自動化（legacy）

觀察到兩類控制：
- 明細派工：透過 `find_real_order.php?mode=21/22` 把選取品項分配到左/右煎台
- 溫度控制：透過 MQTT topic `pad32` 發送 `tempXXXX-` 命令（如 `temp000175-`）

其中溫度邏輯核心是「目標溫度 + 當前溫度 + 狀態告警」。
本次重構後保留此核心，改為 API ingest 溫度讀值，避免綁定特定 MQTT 命令格式。

## 3) 叫號器輸出（legacy）

觀察到流程：
- 輪詢下一筆：
  - `callm/keyin_1.php?insert=0&mach=X`（或 innerkeyin）
- 回寫已播報：
  - `...insert=2&no1=<id>`
- 播放音檔規則：
  - `start.wav` + 千/百/十/個位（例如 `100.wav`, `20.wav`, `no5.wav`）
- 另有 `play_call.php?mode=1&mach=X` 回傳最新叫號號碼。

本次重構成內建 call queue module，提供 enqueue / next / ack / voice-script API。
