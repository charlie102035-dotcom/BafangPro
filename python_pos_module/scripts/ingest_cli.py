from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any


def _load_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("stdin payload is empty")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    return payload


def _ensure_src_on_path() -> None:
    module_root = Path(__file__).resolve().parents[1]
    src_dir = module_root / "src"
    src_text = str(src_dir)
    if src_text not in sys.path:
        sys.path.insert(0, src_text)


def main() -> int:
    try:
        _ensure_src_on_path()
        from pos_norm.pipeline_entry import ingest_receipt

        payload = _load_payload()
        receipt_text = payload.get("receipt_text")
        if not isinstance(receipt_text, str):
            receipt_text = payload.get("source_text")
        if not isinstance(receipt_text, str):
            receipt_text = payload.get("text")
        if not isinstance(receipt_text, str):
            receipt_text = ""

        raw_order_id = payload.get("order_id")
        order_id = str(raw_order_id).strip() if raw_order_id is not None else None
        if not order_id:
            order_id = None

        menu_catalog = payload.get("menu_catalog")
        if menu_catalog is None:
            menu_catalog = []

        allowed_mods = payload.get("allowed_mods")
        if not isinstance(allowed_mods, list):
            allowed_mods = []

        result = ingest_receipt(
            receipt_text=receipt_text,
            order_id=order_id,
            menu_catalog=menu_catalog,
            allowed_mods=allowed_mods,
        )

        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover - CLI hardening path
        error_payload = {
            "ok": False,
            "error": {
                "type": exc.__class__.__name__,
                "message": str(exc),
                "traceback": traceback.format_exc(limit=10),
            },
        }
        print(json.dumps(error_payload, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
