from __future__ import annotations

import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.pipeline_entry import ingest_receipt  # noqa: E402


def _menu_catalog() -> dict[str, dict[str, object]]:
    return {
        "A01": {"canonical_name": "招牌鍋貼", "aliases": ["鍋貼"]},
        "B01": {"canonical_name": "酸辣湯", "aliases": []},
    }


def test_ingest_receipt_returns_full_json_payload() -> None:
    result = ingest_receipt(
        receipt_text="招牌鍋貼 x2\n酸辣湯 x1",
        order_id="ORDER-001",
        menu_catalog=_menu_catalog(),
        allowed_mods=["加辣", "去醬"],
    )

    assert result["accepted"] is True
    assert "order_raw" in result
    assert "candidates" in result
    assert "structured" in result
    assert "merged" in result
    assert result["order_raw"]["order_id"] == "ORDER-001"
    assert isinstance(result["order_raw"]["lines"], list)
    assert isinstance(result["structured"]["items"], list)
    assert isinstance(result["merged"]["items"], list)
    json.dumps(result, ensure_ascii=False)


def test_ingest_receipt_parser_exception_falls_back_with_review(monkeypatch) -> None:
    def _raise_parser(_: str) -> object:
        raise RuntimeError("parse failed")

    monkeypatch.setattr("pos_norm.pipeline_entry.parse_receipt_text", _raise_parser)
    result = ingest_receipt(
        receipt_text="任意內容",
        order_id="ORDER-ERR-1",
        menu_catalog=_menu_catalog(),
        allowed_mods=[],
    )

    assert result["accepted"] is False
    assert result["needs_review"] is True
    assert result["errors"]
    assert result["order_raw"]["needs_review"] is True
    assert result["order_raw"]["lines"][0]["raw_line"] == "任意內容"
    assert result["merged"]["overall_needs_review"] is True


def test_ingest_receipt_merge_exception_falls_back_without_crash(monkeypatch) -> None:
    def _raise_merge(*args, **kwargs) -> object:
        raise ValueError("merge failed")

    monkeypatch.setattr("pos_norm.pipeline_entry.merge_and_validate", _raise_merge)
    result = ingest_receipt(
        receipt_text="招牌鍋貼 x1",
        order_id="ORDER-ERR-2",
        menu_catalog=_menu_catalog(),
        allowed_mods=["加辣"],
    )

    assert result["accepted"] is False
    assert result["needs_review"] is True
    assert any(str(err).startswith("merge:") for err in result["errors"])
    assert result["merged"]["overall_needs_review"] is True
    assert result["merged"]["items"]
    json.dumps(result, ensure_ascii=False)


def test_ingest_receipt_uses_injected_llm_client_when_provided() -> None:
    class FakeLLMClient:
        def __init__(self) -> None:
            self.calls = 0

        def complete(self, prompt: str, timeout_s: float | None = None) -> str:
            self.calls += 1
            assert "allowed_mods" in prompt
            return json.dumps(
                {
                    "items": [
                        {
                            "line_index": 0,
                            "item_id": "A01",
                            "mods": [],
                            "confidence_item": 0.95,
                            "confidence_mods": 0.9,
                            "needs_review": False,
                        },
                        {
                            "line_index": 1,
                            "item_id": "B01",
                            "mods": [],
                            "confidence_item": 0.95,
                            "confidence_mods": 0.9,
                            "needs_review": False,
                        },
                    ],
                    "groups": [],
                },
                ensure_ascii=False,
            )

    client = FakeLLMClient()
    result = ingest_receipt(
        receipt_text="招牌鍋貼 x2\n酸辣湯 x1",
        order_id="ORDER-LLM-1",
        menu_catalog=_menu_catalog(),
        allowed_mods=["加辣"],
        llm_client=client,
        llm_timeout_s=3.0,
    )

    assert client.calls == 1
    assert result["structured"]["metadata"]["fallback_reason"] is None
    assert result["structured"]["metadata"]["llm_attempts"] == 1
    assert result["structured"]["metadata"]["llm_runtime"]["reason"] == "injected_client"
    assert result["llm_runtime"]["enabled"] is True
