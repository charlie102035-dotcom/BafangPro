from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

import pos_norm.cache as cache_module  # noqa: E402
from pos_norm.audit import AuditLogger  # noqa: E402
from pos_norm.cache import (  # noqa: E402
    GROUP_PATTERN_CACHE,
    ITEM_MAPPING_CACHE,
    NOTE_MODS_CACHE,
    POSNormCache,
)


@pytest.mark.parametrize(
    ("namespace", "key_payload", "value"),
    [
        (
            ITEM_MAPPING_CACHE,
            {"name_raw": "招牌鍋貼", "menu_catalog_version": "menu-v1"},
            {"item_id": "I001"},
        ),
        (
            NOTE_MODS_CACHE,
            {"note_raw": "加辣去醬", "allowed_mods_version": "mods-v1"},
            ["加辣", "去醬"],
        ),
        (
            GROUP_PATTERN_CACHE,
            {
                "group_pattern": "上面兩項同袋",
                "menu_catalog_version": "menu-v1",
                "allowed_mods_version": "mods-v1",
            },
            {"grouping": "pack_together", "line_indices": [0, 1]},
        ),
    ],
)
def test_cache_ttl_expiration_auto_miss_all_namespaces(
    monkeypatch,  # type: ignore[no-untyped-def]
    namespace: str,
    key_payload: dict[str, str],
    value: object,
) -> None:
    base_time = 1700000000.0
    monkeypatch.setattr(cache_module.time, "time", lambda: base_time)
    cache = POSNormCache(namespace_ttls={namespace: 5})
    cache.set(namespace, key_payload, value=value, confidence=0.8, meta={})

    monkeypatch.setattr(cache_module.time, "time", lambda: base_time + 4.99)
    assert cache.get(namespace, key_payload) is not None

    monkeypatch.setattr(cache_module.time, "time", lambda: base_time + 5.0)
    assert cache.get(namespace, key_payload) is None


def test_cache_hit_and_miss_for_item_mapping_namespace() -> None:
    cache = POSNormCache(namespace_ttls={ITEM_MAPPING_CACHE: 30})
    key = {
        "name_raw": "咖哩雞肉鍋貼",
        "menu_catalog_version": "menu-v1",
    }

    assert cache.get(ITEM_MAPPING_CACHE, key) is None

    cache.set(
        ITEM_MAPPING_CACHE,
        key,
        value={"item_id": "I003"},
        confidence=0.93,
        meta={"source": "candidate_top1"},
    )
    entry = cache.get(ITEM_MAPPING_CACHE, key)

    assert entry is not None
    assert entry.value == {"item_id": "I003"}
    assert entry.confidence == 0.93
    assert entry.meta["source"] == "candidate_top1"


def test_cache_ttl_expiration_auto_miss(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    base_time = 1700000000.0
    monkeypatch.setattr(cache_module.time, "time", lambda: base_time)

    cache = POSNormCache(namespace_ttls={NOTE_MODS_CACHE: 10})
    key = {
        "note_raw": "加辣去醬",
        "allowed_mods_version": "mods-v1",
    }
    cache.set(NOTE_MODS_CACHE, key, value=["加辣", "去醬"], confidence=0.8, meta={})

    monkeypatch.setattr(cache_module.time, "time", lambda: base_time + 9)
    assert cache.get(NOTE_MODS_CACHE, key) is not None

    monkeypatch.setattr(cache_module.time, "time", lambda: base_time + 10)
    assert cache.get(NOTE_MODS_CACHE, key) is None


def test_cache_ttl_zero_means_no_expiry(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    base_time = 1700000000.0
    monkeypatch.setattr(cache_module.time, "time", lambda: base_time)
    cache = POSNormCache(namespace_ttls={ITEM_MAPPING_CACHE: 0})
    key = {"name_raw": "酸辣湯", "menu_catalog_version": "menu-v1"}
    cache.set(ITEM_MAPPING_CACHE, key, value={"item_id": "I007"}, confidence=0.9, meta={})

    monkeypatch.setattr(cache_module.time, "time", lambda: base_time + 99999)
    assert cache.get(ITEM_MAPPING_CACHE, key) is not None


def test_cache_version_change_invalidates_lookup() -> None:
    cache = POSNormCache()
    cache.set(
        ITEM_MAPPING_CACHE,
        {
            "name_raw": "酸辣湯",
            "menu_catalog_version": "menu-v1",
        },
        value={"item_id": "I007"},
        confidence=0.99,
        meta={},
    )

    same_key_hit = cache.get(
        ITEM_MAPPING_CACHE,
        {
            "name_raw": "酸辣湯",
            "menu_catalog_version": "menu-v1",
        },
    )
    changed_version_miss = cache.get(
        ITEM_MAPPING_CACHE,
        {
            "name_raw": "酸辣湯",
            "menu_catalog_version": "menu-v2",
        },
    )

    assert same_key_hit is not None
    assert changed_version_miss is None


def test_cache_missing_required_version_field_is_rejected() -> None:
    cache = POSNormCache()
    with pytest.raises(ValueError, match="menu_catalog_version"):
        cache.set(
            ITEM_MAPPING_CACHE,
            {"name_raw": "酸辣湯", "menu_catalog_version": "   "},
            value={"item_id": "I007"},
            confidence=0.9,
            meta={},
        )


def test_cache_version_change_misses_for_note_and_group_namespaces() -> None:
    cache = POSNormCache()
    cache.set(
        NOTE_MODS_CACHE,
        {"note_raw": "加辣", "allowed_mods_version": "mods-v1"},
        value=["加辣"],
        confidence=0.9,
        meta={},
    )
    cache.set(
        GROUP_PATTERN_CACHE,
        {
            "group_pattern": "上面兩項同袋",
            "menu_catalog_version": "menu-v1",
            "allowed_mods_version": "mods-v1",
        },
        value={"grouping": "pack_together"},
        confidence=0.9,
        meta={},
    )

    assert cache.get(NOTE_MODS_CACHE, {"note_raw": "加辣", "allowed_mods_version": "mods-v1"}) is not None
    assert cache.get(NOTE_MODS_CACHE, {"note_raw": "加辣", "allowed_mods_version": "mods-v2"}) is None
    assert (
        cache.get(
            GROUP_PATTERN_CACHE,
            {
                "group_pattern": "上面兩項同袋",
                "menu_catalog_version": "menu-v2",
                "allowed_mods_version": "mods-v1",
            },
        )
        is None
    )
    assert (
        cache.get(
            GROUP_PATTERN_CACHE,
            {
                "group_pattern": "上面兩項同袋",
                "menu_catalog_version": "menu-v1",
                "allowed_mods_version": "mods-v2",
            },
        )
        is None
    )


def test_cache_rejects_unknown_ttl_namespace() -> None:
    with pytest.raises(ValueError, match="Unsupported TTL namespace"):
        POSNormCache(namespace_ttls={"unknown_namespace": 10})


def test_all_three_namespaces_are_supported() -> None:
    cache = POSNormCache()

    cache.set(
        ITEM_MAPPING_CACHE,
        {"name_raw": "招牌鍋貼", "menu_catalog_version": "menu-v1"},
        value={"item_id": "I001"},
        confidence=0.9,
        meta={},
    )
    cache.set(
        NOTE_MODS_CACHE,
        {"note_raw": "加辣", "allowed_mods_version": "mods-v1"},
        value=["加辣"],
        confidence=0.88,
        meta={},
    )
    cache.set(
        GROUP_PATTERN_CACHE,
        {
            "group_pattern": "上面兩項同袋",
            "menu_catalog_version": "menu-v1",
            "allowed_mods_version": "mods-v1",
        },
        value={"grouping": "pack_together", "line_indices": [0, 1]},
        confidence=0.77,
        meta={"rule": "reference_phrase"},
    )

    assert cache.get(ITEM_MAPPING_CACHE, {"name_raw": "招牌鍋貼", "menu_catalog_version": "menu-v1"}) is not None
    assert cache.get(NOTE_MODS_CACHE, {"note_raw": "加辣", "allowed_mods_version": "mods-v1"}) is not None
    assert (
        cache.get(
            GROUP_PATTERN_CACHE,
            {
                "group_pattern": "上面兩項同袋",
                "menu_catalog_version": "menu-v1",
                "allowed_mods_version": "mods-v1",
            },
        )
        is not None
    )


def test_cache_invalidate_removes_entry() -> None:
    cache = POSNormCache()
    key = {"note_raw": "去醬", "allowed_mods_version": "mods-v1"}
    cache.set(NOTE_MODS_CACHE, key, value=["去醬"], confidence=0.7, meta={})
    assert cache.get(NOTE_MODS_CACHE, key) is not None

    cache.invalidate(NOTE_MODS_CACHE, key)
    assert cache.get(NOTE_MODS_CACHE, key) is None


def test_audit_write_read_order_and_list_by_type(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")

    logger.write_event(
        {
            "order_id": "ORD-1",
            "event_type": "parse",
            "timestamp": "2026-02-14T10:00:00+00:00",
            "raw_text": "招牌鍋貼 x2",
            "parse_result": {"lines": 1},
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-1",
            "event_type": "llm_fallback",
            "timestamp": "2026-02-14T10:00:01+00:00",
            "fallback_reason": "llm_timeout",
            "final_output": {"strategy": "first_candidate"},
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-2",
            "event_type": "parse",
            "timestamp": "2026-02-14T10:00:02+00:00",
            "raw_text": "酸辣湯 x1",
            "parse_result": {"lines": 1},
        }
    )

    ord1_events = logger.list_events("ORD-1")
    parse_events = logger.list_by_type("parse")

    assert [event["event_type"] for event in ord1_events] == ["parse", "llm_fallback"]
    assert [event["order_id"] for event in parse_events] == ["ORD-1", "ORD-2"]


def test_audit_list_events_keeps_append_order_even_with_same_timestamp(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")

    logger.write_event(
        {
            "order_id": "ORD-SEQ-1",
            "event_type": "first",
            "timestamp": "2026-02-14T10:00:00+00:00",
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-SEQ-1",
            "event_type": "second",
            "timestamp": "2026-02-14T10:00:00+00:00",
        }
    )

    events = logger.list_events("ORD-SEQ-1")
    assert [event["event_type"] for event in events] == ["first", "second"]


def test_audit_human_correction_is_traceable(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")

    logger.write_event(
        {
            "order_id": "ORD-REV-1",
            "event_type": "manual_correction",
            "raw_text": "咖哩雞肉鍋貼 x1",
            "before": {"item_id": "I001"},
            "after": {"item_id": "I003"},
            "human_correction": {
                "before": {"item_id": "I001"},
                "after": {"item_id": "I003"},
                "operator": "alice",
                "timestamp": "2026-02-14T12:00:00+00:00",
            },
        }
    )

    events = logger.list_events("ORD-REV-1")
    assert len(events) == 1
    correction = events[0]["human_correction"]

    assert correction["before"]["item_id"] == "I001"
    assert correction["after"]["item_id"] == "I003"
    assert correction["operator"] == "alice"
    assert correction["timestamp"] == "2026-02-14T12:00:00+00:00"


def test_audit_legacy_manual_fields_are_promoted_to_human_correction(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")
    logger.write_event(
        {
            "order_id": "ORD-LEGACY-1",
            "event_type": "manual_correction",
            "before": {"item_id": "I001"},
            "after": {"item_id": "I003"},
            "operator": "bob",
            "correction_timestamp": "2026-02-14T13:00:00+00:00",
        }
    )

    event = logger.list_events("ORD-LEGACY-1")[0]
    correction = event["human_correction"]
    assert correction["before"] == {"item_id": "I001"}
    assert correction["after"] == {"item_id": "I003"}
    assert correction["operator"] == "bob"
    assert correction["timestamp"] == "2026-02-14T13:00:00+00:00"


def test_audit_human_correction_defaults_operator_and_timestamp(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")
    logger.write_event(
        {
            "order_id": "ORD-HC-DEFAULT-1",
            "event_type": "manual_correction",
            "human_correction": {
                "before": {"item_id": "I001"},
                "after": {"item_id": "I003"},
                "operator": "   ",
            },
        }
    )

    event = logger.list_events("ORD-HC-DEFAULT-1")[0]
    correction = event["human_correction"]
    assert correction["before"] == {"item_id": "I001"}
    assert correction["after"] == {"item_id": "I003"}
    assert correction["operator"] == "unknown"
    assert isinstance(correction["timestamp"], str)
    assert correction["timestamp"].strip() != ""


def test_audit_order_trace_covers_pipeline_stages(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")
    logger.write_event(
        {
            "order_id": "ORD-TRACE-1",
            "event_type": "ingest_pipeline",
            "raw_text": "招牌鍋貼 x2 備註:加辣",
            "parse_result": {"lines": [{"line_index": 0, "name_raw": "招牌鍋貼", "qty": 2}]},
            "candidates": {"0": [{"item_id": "I001", "score": 0.97}]},
            "llm_request": {"prompt": "normalize order"},
            "llm_response": {"items": [{"line_index": 0, "item_id": "I001"}]},
            "merge_result": {"items": [{"item_code": "I001"}], "overall_needs_review": True},
            "final_output": {"order_id": "ORD-TRACE-1", "overall_needs_review": True},
            "fallback_reason": "llm_timeout",
            "needs_review": True,
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-TRACE-1",
            "event_type": "manual_correction",
            "human_correction": {
                "before": {"item_code": "I999"},
                "after": {"item_code": "I001"},
                "operator": "carol",
                "timestamp": "2026-02-14T14:00:00+00:00",
            },
        }
    )

    trace = logger.get_order_trace("ORD-TRACE-1")
    assert trace["order_id"] == "ORD-TRACE-1"
    assert "招牌鍋貼" in trace["raw_text"]
    assert trace["parse_result"]["lines"][0]["name_raw"] == "招牌鍋貼"
    assert trace["candidates"]["0"][0]["item_id"] == "I001"
    assert trace["llm_request"]["prompt"] == "normalize order"
    assert trace["llm_response"]["items"][0]["item_id"] == "I001"
    assert trace["merge_result"]["items"][0]["item_code"] == "I001"
    assert trace["final_output"]["overall_needs_review"] is True
    assert trace["fallback_reason"] == "llm_timeout"
    assert trace["manual_corrections"][0]["operator"] == "carol"
    assert len(trace["events"]) == 2


def test_audit_review_queue_resolves_after_manual_fix(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")

    logger.write_event(
        {
            "order_id": "ORD-Q-1",
            "event_type": "ingest_pipeline",
            "raw_text": "酸辣湯 x1",
            "fallback_reason": "llm_timeout",
            "final_output": {"overall_needs_review": True},
            "needs_review": True,
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-Q-2",
            "event_type": "ingest_pipeline",
            "raw_text": "豆漿 x1",
            "needs_review": True,
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-Q-1",
            "event_type": "manual_correction",
            "human_correction": {
                "before": {"item_code": "I000"},
                "after": {"item_code": "I007"},
                "operator": "dave",
                "timestamp": "2026-02-14T15:00:00+00:00",
            },
        }
    )

    unresolved = logger.list_review_queue()
    all_items = logger.list_review_queue(unresolved_only=False)

    assert [item["order_id"] for item in unresolved] == ["ORD-Q-2"]
    assert {item["order_id"] for item in all_items} == {"ORD-Q-1", "ORD-Q-2"}
    q1 = next(item for item in all_items if item["order_id"] == "ORD-Q-1")
    assert q1["has_manual_correction"] is True
    assert q1["latest_manual_correction"]["operator"] == "dave"


def test_audit_review_queue_with_dispatch_and_review_decision(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")
    logger.write_event(
        {
            "order_id": "ORD-Q-3",
            "event_type": "ingest_pipeline",
            "raw_text": "咖哩雞肉鍋貼 x2",
            "needs_review": True,
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-Q-3",
            "event_type": "dispatch_decision",
            "final_output": {"route": "review-queue", "overall_needs_review": True},
            "needs_review": True,
        }
    )
    logger.write_event(
        {
            "order_id": "ORD-Q-3",
            "event_type": "review_decision",
            "metadata": {"decision": "need_manual_fix", "needs_review": True},
            "needs_review": True,
        }
    )

    unresolved = logger.list_review_queue(unresolved_only=True)
    assert any(item["order_id"] == "ORD-Q-3" for item in unresolved)

    logger.write_event(
        {
            "order_id": "ORD-Q-3",
            "event_type": "manual_correction",
            "human_correction": {
                "before": {"item_id": None},
                "after": {"item_id": "I003"},
                "operator": "reviewer_1",
                "timestamp": "2026-02-15T04:45:00+08:00",
            },
        }
    )

    unresolved_after = logger.list_review_queue(unresolved_only=True)
    all_rows = logger.list_review_queue(unresolved_only=False)
    assert not any(item["order_id"] == "ORD-Q-3" for item in unresolved_after)
    assert any(item["order_id"] == "ORD-Q-3" for item in all_rows)


def test_audit_masks_sensitive_fields_in_llm_payload(tmp_path: Path) -> None:
    logger = AuditLogger(tmp_path / "audit.jsonl")

    logger.write_event(
        {
            "order_id": "ORD-SEC-1",
            "event_type": "llm_call",
            "llm_request": {
                "prompt": "normalize this order",
                "api_key": "sk-1234567890ABCDEF",
                "operator_email": "staff@example.com",
            },
            "llm_response": {
                "token": "response-token-12345",
                "result": {"item_id": "I001"},
            },
        }
    )

    event = logger.list_events("ORD-SEC-1")[0]
    assert event["llm_request"]["api_key"] == "***"
    assert event["llm_request"]["operator_email"] == "***"
    assert event["llm_response"]["token"] == "***"
    assert event["llm_response"]["result"]["item_id"] == "I001"


def test_fixtures_cover_required_scenarios() -> None:
    menu_catalog = json.loads((PROJECT_ROOT / "fixtures" / "menu_catalog.json").read_text(encoding="utf-8"))
    allowed_mods = json.loads((PROJECT_ROOT / "fixtures" / "allowed_mods.json").read_text(encoding="utf-8"))
    receipts = json.loads((PROJECT_ROOT / "fixtures" / "receipts.json").read_text(encoding="utf-8"))

    assert isinstance(menu_catalog, list)
    assert len(menu_catalog) >= 20
    assert all("item_id" in item and "canonical_name" in item for item in menu_catalog)
    item_ids = [item["item_id"] for item in menu_catalog]
    canonical_names = [item["canonical_name"] for item in menu_catalog]
    assert len(item_ids) == len(set(item_ids))
    assert len(canonical_names) == len(set(canonical_names))

    assert isinstance(allowed_mods, list)
    assert len(allowed_mods) >= 15
    assert len(allowed_mods) == len(set(allowed_mods))

    required_scenarios = {
        "name_variation",
        "single_line_note",
        "cross_line_pack_together",
        "reference_phrase",
        "ambiguous_need_manual_review",
        "llm_timeout_fallback",
    }
    actual_scenarios = {receipt.get("scenario") for receipt in receipts}
    order_ids = [receipt.get("order_id") for receipt in receipts]

    assert len(receipts) >= 6
    assert len(order_ids) == len(set(order_ids))
    assert all(isinstance(receipt.get("source_text"), str) and receipt.get("source_text").strip() for receipt in receipts)
    assert required_scenarios.issubset(actual_scenarios)
    assert any(receipt.get("simulate", {}).get("llm_timeout") is True for receipt in receipts)
    assert any("咖哩雞肉鍋貼" in receipt.get("source_text", "") and "咖哩鍋貼" in receipt.get("source_text", "") for receipt in receipts)
    assert any("5 招牌 + 10 韭菜同袋" in receipt.get("source_text", "") for receipt in receipts)

    by_scenario = {receipt["scenario"]: receipt for receipt in receipts}
    assert "加辣" in by_scenario["single_line_note"]["source_text"]
    assert "去醬" in by_scenario["single_line_note"]["source_text"]
    assert "上面兩項同袋" in by_scenario["reference_phrase"]["source_text"]
    assert by_scenario["ambiguous_need_manual_review"]["requires_manual_review"] is True
    assert by_scenario["llm_timeout_fallback"]["simulate"]["llm_timeout"] is True
    assert by_scenario["ambiguous_need_manual_review"]["manual_fix_example"]["operator"] == "shift_lead_a"
    assert by_scenario["ambiguous_need_manual_review"]["manual_fix_example"]["after"]["item_id"] == "I003"
    assert by_scenario["llm_timeout_fallback"]["expected_audit_stages"] == [
        "raw_ingest",
        "candidate_generation",
        "llm_timeout_fallback",
        "merge_validate",
    ]
