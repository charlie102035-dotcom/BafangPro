from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.contracts import (  # noqa: E402
    CONTRACT_VERSION,
    CandidateItem,
    GroupResult,
    Mod,
    NormalizedItem,
    OrderRawParsed,
    RawLine,
)
from pos_norm.merge_validate import merge_and_validate  # noqa: E402


MENU_CATALOG = {
    "I001": ["招牌鍋貼"],
    "I002": ["酸辣湯"],
    "I003": ["冰豆漿"],
}
ALLOWED_MODS = ["加辣", "去冰", "少鹽"]


def _make_order() -> OrderRawParsed:
    lines = [
        RawLine(line_index=0, raw_line="招牌鍋貼 x2 備註:加辣", name_raw="招牌鍋貼", qty=2, note_raw="加辣"),
        RawLine(line_index=1, raw_line="酸辣湯 x1", name_raw="酸辣湯", qty=1, note_raw=None),
    ]
    return OrderRawParsed(source_text="\n".join(line.raw_line for line in lines), lines=lines)


def _make_candidates(order: OrderRawParsed) -> dict[int, list[CandidateItem]]:
    return {
        order.lines[0].line_index: [
            CandidateItem(
                line_index=order.lines[0].line_index,
                raw_line=order.lines[0].raw_line,
                name_raw=order.lines[0].name_raw,
                qty=order.lines[0].qty,
                note_raw=order.lines[0].note_raw,
                candidate_name="招牌鍋貼",
                candidate_code="I001",
            )
        ],
        order.lines[1].line_index: [
            CandidateItem(
                line_index=order.lines[1].line_index,
                raw_line=order.lines[1].raw_line,
                name_raw=order.lines[1].name_raw,
                qty=order.lines[1].qty,
                note_raw=order.lines[1].note_raw,
                candidate_name="酸辣湯",
                candidate_code="I002",
            )
        ],
    }


def _item(
    *,
    line_index: int,
    item_code: str | None,
    name_normalized: str | None,
    qty: int,
    mods: list[Mod] | None = None,
    confidence_item: float = 0.95,
    confidence_mods: float = 0.95,
    needs_review: bool = False,
) -> NormalizedItem:
    return NormalizedItem(
        line_index=line_index,
        raw_line="dummy_raw",
        name_raw="dummy_name",
        qty=qty,
        name_normalized=name_normalized or "",
        item_code=item_code,
        note_raw="dummy_note",
        mods=mods or [],
        confidence_item=confidence_item,
        confidence_mods=confidence_mods,
        needs_review=needs_review,
    )


def _group(
    *,
    group_id: str,
    line_indices: list[int],
    confidence_group: float = 0.95,
    needs_review: bool = False,
    type: str = "pack_together",
    label: str = "同袋",
) -> GroupResult:
    return GroupResult(
        group_id=group_id,
        type=type,
        label=label,
        line_indices=line_indices,
        confidence_group=confidence_group,
        needs_review=needs_review,
    )


def _structured(
    *,
    items: Any = None,
    groups: Any = None,
    audit_events: Any = None,
    metadata: Any = None,
) -> dict[str, Any]:
    return {
        "items": [] if items is None else items,
        "groups": [] if groups is None else groups,
        "audit_events": [] if audit_events is None else audit_events,
        "metadata": {} if metadata is None else metadata,
        "version": CONTRACT_VERSION,
    }


def _assert_raw_fields_preserved(result: Any, order: OrderRawParsed) -> None:
    by_index = {line.line_index: line for line in order.lines}
    for item in result.items:
        raw = by_index[item.line_index]
        assert item.raw_line == raw.raw_line
        assert item.name_raw == raw.name_raw
        assert item.note_raw == raw.note_raw


def test_happy_path_all_high_confidence() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2, mods=[Mod(mod_raw="加辣", mod_name="加辣")]),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ],
        groups=[_group(group_id="G1", line_indices=[0, 1], confidence_group=0.95)],
    )

    result = merge_and_validate(
        order,
        candidates,
        structured,
        menu_catalog=MENU_CATALOG,
        allowed_mods=ALLOWED_MODS,
    )

    assert result.overall_needs_review is False
    assert all(item.needs_review is False for item in result.items)
    assert result.groups[0].needs_review is False
    assert result.metadata["dispatch_decision"]["route"] == "auto-dispatch"
    assert result.metadata["dispatch_decision"]["should_auto_dispatch"] is True
    _assert_raw_fields_preserved(result, order)


def test_item_low_confidence_marks_review() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2, confidence_item=0.4),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.items[0].needs_review is True
    assert result.overall_needs_review is True
    assert result.metadata["dispatch_decision"]["route"] == "review-queue"
    assert result.metadata["dispatch_decision"]["should_auto_dispatch"] is False
    _assert_raw_fields_preserved(result, order)


def test_mods_low_confidence_marks_review() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(
                line_index=0,
                item_code="I001",
                name_normalized="招牌鍋貼",
                qty=2,
                mods=[Mod(mod_raw="加辣", mod_name="加辣", confidence=0.2)],
                confidence_mods=0.2,
            ),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.items[0].needs_review is True
    assert result.items[0].mods[0].needs_review is True
    assert result.overall_needs_review is True
    _assert_raw_fields_preserved(result, order)


def test_group_low_confidence_marks_review() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ],
        groups=[_group(group_id="G1", line_indices=[0, 1], confidence_group=0.5)],
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.groups[0].needs_review is True
    assert result.overall_needs_review is True
    _assert_raw_fields_preserved(result, order)


def test_item_id_not_in_catalog_fallback_to_candidate() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="NOT_IN_MENU", name_normalized="未知品項", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.items[0].item_code == "I001"
    assert result.items[0].needs_review is True
    assert any(event.event_type == "item_code_not_in_catalog" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)


def test_mods_not_allowed_are_filtered_and_reviewed() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(
                line_index=0,
                item_code="I001",
                name_normalized="招牌鍋貼",
                qty=2,
                mods=[Mod(mod_raw="加辣", mod_name="加辣"), Mod(mod_raw="神秘醬", mod_name="神秘醬")],
            ),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert [mod.mod_raw for mod in result.items[0].mods] == ["加辣", "神秘醬"]
    _assert_raw_fields_preserved(result, order)


def test_group_line_out_of_range_is_trimmed_and_reviewed() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ],
        groups=[_group(group_id="G1", line_indices=[0, 99, 0], confidence_group=0.95)],
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.groups[0].line_indices == [0]
    assert result.groups[0].needs_review is True
    assert any(event.event_type == "group_line_index_out_of_range" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)


def test_llm_missing_fields_and_partial_results_fallback() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = {
        "items": [{"line_index": 0}],
        "version": CONTRACT_VERSION,
    }

    result = merge_and_validate(
        order,
        candidates,
        structured,  # type: ignore[arg-type]
        menu_catalog=MENU_CATALOG,
        allowed_mods=ALLOWED_MODS,
    )

    assert len(result.items) == 2
    assert result.items[0].item_code == "I001"
    assert result.items[1].item_code == "I002"
    assert result.items[0].needs_review is True
    assert result.items[1].needs_review is True
    assert result.overall_needs_review is True
    _assert_raw_fields_preserved(result, order)


def test_qty_invalid_marks_review_and_keeps_raw_qty() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=0),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.items[0].qty == 2
    assert result.items[0].needs_review is True
    assert any(event.event_type == "qty_invalid" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)


def test_overall_needs_review_aggregation_logic() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1, needs_review=True),
        ],
        groups=[_group(group_id="G1", line_indices=[0, 1], confidence_group=0.95)],
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.items[1].needs_review is True
    assert result.groups[0].needs_review is False
    assert result.overall_needs_review is True
    _assert_raw_fields_preserved(result, order)


def test_item_line_index_must_exist_in_raw_lines() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
            _item(line_index=99, item_code="I003", name_normalized="冰豆漿", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert [item.line_index for item in result.items] == [0, 1]
    assert any(event.event_type == "item_invalid_line_index" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)


def test_item_code_not_in_line_candidates_fallback_to_top_candidate() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I003", name_normalized="冰豆漿", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ]
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.items[0].item_code == "I001"
    assert result.items[0].needs_review is True
    assert any(event.event_type == "item_code_not_in_line_candidates" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)


def test_group_conflict_uses_first_wins_policy() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ],
        groups=[
            _group(group_id="G1", line_indices=[0, 1], confidence_group=0.95),
            _group(group_id="G2", line_indices=[1], confidence_group=0.95),
        ],
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.groups[0].line_indices == [0, 1]
    assert result.groups[0].needs_review is False
    assert result.groups[1].line_indices == []
    assert result.groups[1].needs_review is True
    assert any(event.event_type == "group_line_conflict" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)


def test_custom_thresholds_can_be_relaxed() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2, confidence_item=0.8, confidence_mods=0.8),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1, confidence_item=0.8, confidence_mods=0.8),
        ],
        groups=[_group(group_id="G1", line_indices=[0, 1], confidence_group=0.8)],
    )

    result = merge_and_validate(
        order,
        candidates,
        structured,
        menu_catalog=MENU_CATALOG,
        allowed_mods=ALLOWED_MODS,
        item_threshold=0.75,
        mods_threshold=0.75,
        group_threshold=0.75,
    )

    assert all(item.needs_review is False for item in result.items)
    assert all(group.needs_review is False for group in result.groups)
    assert result.overall_needs_review is False
    _assert_raw_fields_preserved(result, order)


def test_menu_catalog_list_valid_item_codes_are_not_misjudged() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    menu_catalog_list = [
        {"item_id": "I001", "canonical_name": "招牌鍋貼", "aliases": ["黃金鍋貼"]},
        {"item_id": "I002", "canonical_name": "酸辣湯", "aliases": ["酸辣湯小"]},
    ]
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2, confidence_item=0.95, confidence_mods=0.95),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1, confidence_item=0.95, confidence_mods=0.95),
        ]
    )

    result = merge_and_validate(
        order,
        candidates,
        structured,
        menu_catalog=menu_catalog_list,  # type: ignore[arg-type]
        allowed_mods=ALLOWED_MODS,
    )

    assert [item.item_code for item in result.items] == ["I001", "I002"]
    assert all(item.needs_review is False for item in result.items)
    assert result.overall_needs_review is False
    _assert_raw_fields_preserved(result, order)


def test_group_invalid_shape_or_too_few_lines_marks_review() -> None:
    order = _make_order()
    candidates = _make_candidates(order)
    structured = _structured(
        items=[
            _item(line_index=0, item_code="I001", name_normalized="招牌鍋貼", qty=2),
            _item(line_index=1, item_code="I002", name_normalized="酸辣湯", qty=1),
        ],
        groups=[
            {
                "group_id": "G1",
                "type": "pack_together",
                "label": "bad-shape",
                "line_indices": "0,1",
                "confidence_group": 0.95,
                "needs_review": False,
            },
            _group(group_id="G2", line_indices=[1], confidence_group=0.95),
        ],
    )

    result = merge_and_validate(order, candidates, structured, menu_catalog=MENU_CATALOG, allowed_mods=ALLOWED_MODS)

    assert result.groups[0].needs_review is True
    assert result.groups[1].needs_review is True
    assert result.overall_needs_review is True
    assert any(event.event_type == "group_line_indices_invalid_shape" for event in result.audit_events)
    assert any(event.event_type == "group_too_few_lines" for event in result.audit_events)
    _assert_raw_fields_preserved(result, order)
