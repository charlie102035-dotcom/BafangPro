from __future__ import annotations

import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.audit import AuditLogger  # noqa: E402
from pos_norm.cache import ITEM_MAPPING_CACHE, POSNormCache  # noqa: E402
from pos_norm.candidates import generate_candidates  # noqa: E402
from pos_norm.contracts import (  # noqa: E402
    CONTRACT_VERSION,
    AuditEvent,
    CandidateItem,
    GroupResult,
    Mod,
    NormalizedItem,
    OrderNormalized,
    OrderRawParsed,
    RawLine,
)
from pos_norm.llm_pipeline import llm_normalize_and_group  # noqa: E402
from pos_norm.merge_validate import merge_and_validate  # noqa: E402
from pos_norm.parser import parse_receipt_text  # noqa: E402


def _assert_core_item_fields(item: CandidateItem | NormalizedItem) -> None:
    assert isinstance(item.line_index, int)
    assert isinstance(item.raw_line, str)
    assert isinstance(item.name_raw, str)
    assert isinstance(item.qty, int)
    assert item.note_raw is None or isinstance(item.note_raw, str)
    assert item.group_id is None or isinstance(item.group_id, str)
    assert item.confidence_item is None or isinstance(item.confidence_item, float)
    assert item.confidence_mods is None or isinstance(item.confidence_mods, float)
    assert isinstance(item.needs_review, bool)
    assert isinstance(item.metadata, dict)
    assert isinstance(item.version, str)


def _assert_mod_fields(mod: Mod) -> None:
    assert isinstance(mod.mod_raw, str)
    assert mod.mod_name is None or isinstance(mod.mod_name, str)
    assert mod.mod_value is None or isinstance(mod.mod_value, str)
    assert mod.confidence is None or isinstance(mod.confidence, float)
    assert isinstance(mod.needs_review, bool)
    assert isinstance(mod.metadata, dict)
    assert isinstance(mod.version, str)


def _assert_group_fields(group: GroupResult) -> None:
    assert isinstance(group.group_id, str)
    assert group.type in {"pack_together", "separate", "other"}
    assert isinstance(group.label, str)
    assert isinstance(group.line_indices, list)
    assert all(isinstance(line_index, int) for line_index in group.line_indices)
    assert group.confidence_group is None or isinstance(group.confidence_group, float)
    assert isinstance(group.needs_review, bool)
    assert isinstance(group.metadata, dict)
    assert isinstance(group.version, str)


def _assert_audit_event_fields(event: AuditEvent) -> None:
    assert isinstance(event.event_type, str)
    assert isinstance(event.message, str)
    assert event.line_index is None or isinstance(event.line_index, int)
    assert event.item_index is None or isinstance(event.item_index, int)
    assert isinstance(event.metadata, dict)
    assert isinstance(event.version, str)


def _build_menu_catalog_fixture() -> list[dict[str, object]]:
    fixture_path = PROJECT_ROOT / "fixtures" / "menu_catalog.json"
    menu_catalog = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(menu_catalog, list)
    assert menu_catalog and isinstance(menu_catalog[0], dict)
    return menu_catalog


def _build_allowed_mods_fixture() -> list[str]:
    fixture_path = PROJECT_ROOT / "fixtures" / "allowed_mods.json"
    allowed_mods = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(allowed_mods, list)
    assert all(isinstance(mod, str) for mod in allowed_mods)
    return allowed_mods


def _run_pipeline_for_contract_check() -> tuple[OrderRawParsed, dict[int, list[CandidateItem]], dict[str, object], OrderNormalized]:
    source_text = "\n".join(
        [
            "招牌鍋貼 x2",
            "酸辣湯 x1",
            "豆漿 x1 備註:上面兩項同袋",
        ]
    )
    menu_catalog = _build_menu_catalog_fixture()
    allowed_mods = _build_allowed_mods_fixture()

    order_raw = parse_receipt_text(source_text)
    candidates = generate_candidates(order_raw.lines, menu_catalog, top_k=3)
    structured_result = llm_normalize_and_group(
        order_raw,
        candidates,
        allowed_mods=allowed_mods,
        llm_client=None,
    )
    merged = merge_and_validate(
        order_raw,
        candidates,
        structured_result,
        menu_catalog=menu_catalog,
        allowed_mods=allowed_mods,
    )
    return order_raw, candidates, structured_result, merged


def test_contract_compatibility_for_module_outputs() -> None:
    order_raw, candidates, structured_result, merged = _run_pipeline_for_contract_check()

    assert isinstance(order_raw, OrderRawParsed)
    assert isinstance(order_raw.source_text, str)
    assert isinstance(order_raw.lines, list)
    assert isinstance(order_raw.parse_warnings, list)
    assert isinstance(order_raw.needs_review, bool)
    assert isinstance(order_raw.metadata, dict)
    assert isinstance(order_raw.version, str)

    for raw_line in order_raw.lines:
        assert isinstance(raw_line, RawLine)
        assert isinstance(raw_line.line_index, int)
        assert isinstance(raw_line.raw_line, str)
        assert isinstance(raw_line.name_raw, str)
        assert isinstance(raw_line.qty, int)
        assert raw_line.note_raw is None or isinstance(raw_line.note_raw, str)
        assert isinstance(raw_line.needs_review, bool)
        assert isinstance(raw_line.metadata, dict)
        assert isinstance(raw_line.version, str)

    assert isinstance(candidates, dict)
    assert set(candidates.keys()) == {line.line_index for line in order_raw.lines}
    for line_candidates in candidates.values():
        assert isinstance(line_candidates, list)
        assert line_candidates
        for candidate in line_candidates:
            assert isinstance(candidate, CandidateItem)
            _assert_core_item_fields(candidate)
            assert isinstance(candidate.candidate_name, str)
            assert candidate.candidate_code is None or isinstance(candidate.candidate_code, str)
            assert isinstance(candidate.mods, list)
            for mod in candidate.mods:
                _assert_mod_fields(mod)

    assert set(structured_result.keys()) == {"items", "groups", "audit_events", "metadata", "version"}
    assert isinstance(structured_result["items"], list)
    assert isinstance(structured_result["groups"], list)
    assert isinstance(structured_result["audit_events"], list)
    assert isinstance(structured_result["metadata"], dict)
    assert isinstance(structured_result["version"], str)
    assert structured_result["version"] == CONTRACT_VERSION

    for item in structured_result["items"]:
        assert isinstance(item, NormalizedItem)
        _assert_core_item_fields(item)
        assert isinstance(item.name_normalized, str)
        assert item.item_code is None or isinstance(item.item_code, str)
        assert isinstance(item.mods, list)
        for mod in item.mods:
            _assert_mod_fields(mod)

    for group in structured_result["groups"]:
        assert isinstance(group, GroupResult)
        _assert_group_fields(group)

    for event in structured_result["audit_events"]:
        assert isinstance(event, AuditEvent)
        _assert_audit_event_fields(event)

    assert isinstance(merged, OrderNormalized)
    assert isinstance(merged.source_text, str)
    assert isinstance(merged.items, list)
    assert isinstance(merged.groups, list)
    assert isinstance(merged.lines, list)
    assert isinstance(merged.audit_events, list)
    assert isinstance(merged.overall_needs_review, bool)
    assert isinstance(merged.metadata, dict)
    assert isinstance(merged.version, str)
    assert merged.version == CONTRACT_VERSION
    assert merged.overall_needs_review is True

    for item in merged.items:
        assert isinstance(item, NormalizedItem)
        _assert_core_item_fields(item)
        assert isinstance(item.name_normalized, str)
        assert item.item_code is None or isinstance(item.item_code, str)
        for mod in item.mods:
            _assert_mod_fields(mod)

    for group in merged.groups:
        assert isinstance(group, GroupResult)
        _assert_group_fields(group)

    for event in merged.audit_events:
        assert isinstance(event, AuditEvent)
        _assert_audit_event_fields(event)


def test_module6_outputs_keep_contract_traceability() -> None:
    _, _, _, merged = _run_pipeline_for_contract_check()

    cache = POSNormCache(namespace_ttls={ITEM_MAPPING_CACHE: 30})
    cache_key = {
        "name_raw": merged.items[0].name_raw,
        "menu_catalog_version": merged.version,
    }
    cache.set(
        ITEM_MAPPING_CACHE,
        cache_key,
        value={"item_code": merged.items[0].item_code, "line_index": merged.items[0].line_index},
        confidence=0.9,
        meta={"contract_version": merged.version, "audit_event_count": len(merged.audit_events)},
    )
    entry = cache.get(ITEM_MAPPING_CACHE, cache_key)

    assert entry is not None
    assert isinstance(entry.value, dict)
    assert isinstance(entry.confidence, float)
    assert isinstance(entry.meta, dict)
    assert entry.meta["contract_version"] == CONTRACT_VERSION
    assert isinstance(entry.meta["audit_event_count"], int)

    logger = AuditLogger(PROJECT_ROOT / "tests" / "integration" / "tmp.contract.audit.jsonl")
    try:
        written = logger.write_event(
            {
                "order_id": "RC-COMPAT-001",
                "event_type": "contract_compat_check",
                "metadata": {
                    "contract_version": merged.version,
                    "overall_needs_review": merged.overall_needs_review,
                    "audit_event_count": len(merged.audit_events),
                },
            }
        )
        events = logger.list_events("RC-COMPAT-001")
    finally:
        logger.path.unlink(missing_ok=True)

    assert isinstance(written, dict)
    assert len(events) == 1
    assert events[0]["metadata"]["contract_version"] == CONTRACT_VERSION
    assert isinstance(events[0]["metadata"]["overall_needs_review"], bool)
    assert isinstance(events[0]["metadata"]["audit_event_count"], int)
