# POS 印單正規化模組 (`python_pos_module`)

本模組提供「POS 印單文字 -> 結構化訂單」核心流程，重點是：

- 品項名稱變動時仍可對齊到 canonical `item_id`
- 備註抽取與跨行分組（同袋/裝一起）可控
- LLM 失敗可回退，並且全程可追溯

## 目錄

- `src/pos_norm/contracts.py`：資料契約與型別
- `src/pos_norm/parser.py`：`parse_receipt_text`
- `src/pos_norm/candidates.py`：`generate_candidates`
- `src/pos_norm/llm_pipeline.py`：`llm_normalize_and_group`
- `src/pos_norm/merge_validate.py`：`merge_and_validate`
- `src/pos_norm/cache.py`：快取（TTL + version key）
- `src/pos_norm/audit.py`：audit log（JSONL）
- `fixtures/`：menu/mods/receipts 假資料
- `prompts/normalize_group.prompt.md`：LLM prompt 模板

## 安裝

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r /Users/charlie/bafang-box-order/python_pos_module/requirements.txt
```

## 啟用 LLM（OpenAI）

`ingest_receipt` 會自動讀取環境變數建立 LLM client：

- `OPENAI_API_KEY` 或 `POS_LLM_API_KEY`
- `POS_LLM_PROVIDER=openai`
- `POS_LLM_MODEL=gpt-4o-mini`
- `POS_LLM_TIMEOUT_S=15`
- `POS_LLM_BASE_URL=https://api.openai.com/v1`

若缺 key、provider 不支援、或 `POS_LLM_ENABLED=0`，流程會自動走 fallback 並標記 `needs_review`。

## 測試

```bash
pytest -q /Users/charlie/bafang-box-order/python_pos_module/tests/unit
pytest -q /Users/charlie/bafang-box-order/python_pos_module/tests/integration
```

## 本地送髒資料到 API

可用以下工具直接送到店家專屬 endpoint：

```bash
python3 /Users/charlie/bafang-box-order/python_pos_module/scripts/send_dirty_to_store_api.py --store-id store-songren
```

使用方式：

- 不帶 `--source-text` / `--from-file` 時，會進入互動模式，貼完後輸入 `__END__`
- 可帶 `--simulate-timeout` 測 fallback
- 可帶 `--raw-response` 看完整 JSON

## 核心函式

1. `parse_receipt_text(text) -> OrderRawParsed`
2. `generate_candidates(lines, menu_catalog) -> candidates_by_line`
3. `llm_normalize_and_group(order_raw, candidates, allowed_mods) -> structured_result`
4. `merge_and_validate(...) -> OrderNormalized`

## 回退與審核策略

- LLM timeout / API error / JSON 解析失敗時：
  - item 先走候選第一名
  - mods/group 走規則保守輸出
  - `needs_review=true`
- 任一項目/群組低於 confidence threshold，或資料不一致：
  - 標記 `needs_review=true`
- `overall_needs_review` 由 item/group 聚合。

## Fixtures 說明

- `menu_catalog.json`：22 個品項（含 alias）
- `allowed_mods.json`：20 個常見備註
- `receipts.json`：6 張單，覆蓋：
  - 名稱變動
  - 單行備註
  - 跨行同袋
  - 指代語句
  - 模糊需人工 review
  - LLM timeout fallback 情境

## 已知限制

- LLM 目前支援 provider: `openai`（透過 HTTP Chat Completions + JSON response_format）。
- `contracts.py` 欄位命名採既有實作（`item_code` 等），若要改為 `item_id` 需全模組同步遷移。
