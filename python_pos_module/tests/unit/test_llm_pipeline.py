from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.contracts import CandidateItem, CONTRACT_VERSION, OrderRawParsed, RawLine  # noqa: E402
from pos_norm.llm_pipeline import llm_normalize_and_group  # noqa: E402


class FakeLLMClient:
    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.calls = 0
        self.prompts: list[str] = []

    def complete(self, prompt: str, timeout_s: float | None = None) -> str:
        self.calls += 1
        self.prompts.append(prompt)
        if not self.responses:
            raise RuntimeError("No fake response available")
        current = self.responses.pop(0)
        if isinstance(current, Exception):
            raise current
        if isinstance(current, str):
            return current
        return json.dumps(current, ensure_ascii=False)


class UpstreamReadTimeout(Exception):
    pass


def _make_order(lines: list[tuple[str, str | None]]) -> OrderRawParsed:
    parsed_lines: list[RawLine] = []
    source_lines: list[str] = []
    for idx, (name, note) in enumerate(lines):
        raw = f"{name} x1"
        if note:
            raw = f"{raw} 備註:{note}"
        source_lines.append(raw)
        parsed_lines.append(
            RawLine(
                line_index=idx,
                raw_line=raw,
                name_raw=name,
                qty=1,
                note_raw=note,
            )
        )
    return OrderRawParsed(source_text="\n".join(source_lines), lines=parsed_lines)


def _make_candidates(order: OrderRawParsed) -> dict[int, list[CandidateItem]]:
    by_line: dict[int, list[CandidateItem]] = {}
    for line in order.lines:
        by_line[line.line_index] = [
            CandidateItem(
                line_index=line.line_index,
                raw_line=line.raw_line,
                name_raw=line.name_raw,
                qty=line.qty,
                candidate_name=f"{line.name_raw}-A",
                candidate_code=f"L{line.line_index}A",
            ),
            CandidateItem(
                line_index=line.line_index,
                raw_line=line.raw_line,
                name_raw=line.name_raw,
                qty=line.qty,
                candidate_name=f"{line.name_raw}-B",
                candidate_code=f"L{line.line_index}B",
            ),
        ]
    return by_line


def test_normal_json_response() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    allowed_mods = ["加辣", "去蔥", "少冰"]
    client = FakeLLMClient(
        [
            {
                "items": [
                    {
                        "line_index": 0,
                        "item_id": "L0B",
                        "mods": ["加辣"],
                        "confidence_item": 0.92,
                        "confidence_mods": 0.8,
                        "needs_review": False,
                    },
                    {
                        "line_index": 1,
                        "item_id": "L1A",
                        "mods": [],
                        "confidence_item": 0.9,
                        "confidence_mods": 0.9,
                        "needs_review": False,
                    },
                ],
                "groups": [
                    {
                        "group_id": "G-1",
                        "type": "pack_together",
                        "label": "同袋",
                        "line_indices": [0, 1],
                        "confidence_group": 0.88,
                        "needs_review": False,
                    }
                ],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, allowed_mods, llm_client=client)

    assert result["version"] == CONTRACT_VERSION
    assert result["metadata"]["fallback_reason"] is None
    assert result["items"][0].item_code == "L0B"
    assert [mod.mod_raw for mod in result["items"][0].mods] == ["加辣"]
    assert result["items"][0].needs_review is False
    assert result["groups"][0].line_indices == [0, 1]
    assert result["groups"][0].type == "pack_together"
    assert result["groups"][0].needs_review is False
    assert result["metadata"]["review_queue"]["needs_review"] is False


def test_invalid_json_retries_once_then_success() -> None:
    order = _make_order([("鍋貼", None)])
    candidates = _make_candidates(order)
    allowed_mods = ["加辣"]
    client = FakeLLMClient(
        [
            "this is not json",
            {
                "items": [
                    {
                        "line_index": 0,
                        "item_id": "L0A",
                        "mods": ["加辣"],
                        "confidence_item": 0.8,
                        "confidence_mods": 0.8,
                        "needs_review": False,
                    }
                ],
                "groups": [],
            },
        ]
    )

    result = llm_normalize_and_group(order, candidates, allowed_mods, llm_client=client)

    assert client.calls == 2
    assert result["metadata"]["llm_attempts"] == 2
    assert result["metadata"]["fallback_reason"] is None
    assert result["items"][0].item_code == "L0A"
    assert any(event.event_type == "llm_json_parse_retry" for event in result["audit_events"])


def test_invalid_json_twice_falls_back() -> None:
    order = _make_order([("鍋貼", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient(["{bad-json", "still not json"])

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["metadata"]["llm_attempts"] == 2
    assert result["metadata"]["fallback_reason"] == "llm_json_parse_error"
    assert result["items"][0].item_code == "L0A"
    assert result["items"][0].needs_review is True
    assert any(event.event_type == "llm_json_parse_error" for event in result["audit_events"])


def test_timeout_uses_fallback_and_marks_review() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None), ("豆漿", "上面兩項同袋")])
    candidates = _make_candidates(order)
    allowed_mods = ["去冰", "加辣"]
    client = FakeLLMClient([TimeoutError("timeout")])

    result = llm_normalize_and_group(order, candidates, allowed_mods, llm_client=client, timeout_s=0.01)

    assert result["metadata"]["fallback_reason"] == "llm_timeout"
    assert all(item.item_code == f"L{item.line_index}A" for item in result["items"])
    assert all(item.needs_review is True for item in result["items"])
    assert all(item.confidence_item == 0.0 for item in result["items"])
    assert any(group.line_indices == [0, 1] for group in result["groups"])
    assert all(group.needs_review is True for group in result["groups"])
    assert result["metadata"]["review_queue"]["needs_review"] is True
    assert "fallback:llm_timeout" in result["metadata"]["review_queue"]["reasons"]
    assert "llm_timeout" in result["metadata"]["review_queue"]["audit_tags"]


def test_timeout_like_error_is_classified_as_timeout_fallback() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient([UpstreamReadTimeout("request timeout on upstream")])

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["metadata"]["fallback_reason"] == "llm_timeout"
    assert any(event.event_type == "llm_timeout" for event in result["audit_events"])
    assert all(item.needs_review is True for item in result["items"])


def test_api_error_uses_fallback_and_marks_review() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient([RuntimeError("upstream error")])

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["metadata"]["fallback_reason"] == "llm_api_error"
    assert all(item.item_code == f"L{item.line_index}A" for item in result["items"])
    assert all(item.needs_review is True for item in result["items"])
    assert any(event.event_type == "llm_api_error" for event in result["audit_events"])


def test_out_of_scope_item_id_is_blocked_and_fallback_to_first_candidate() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {
                        "line_index": 0,
                        "item_id": "NOT-ALLOWED",
                        "mods": [],
                        "confidence_item": 0.9,
                        "confidence_mods": 0.9,
                        "needs_review": False,
                    },
                    {
                        "line_index": 1,
                        "item_id": "L1B",
                        "mods": [],
                        "confidence_item": 0.9,
                        "confidence_mods": 0.9,
                        "needs_review": False,
                    },
                ],
                "groups": [],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["items"][0].item_code == "L0A"
    assert result["items"][0].needs_review is True
    assert result["items"][1].item_code == "L1B"
    assert any(event.event_type == "item_id_out_of_candidates" for event in result["audit_events"])


def test_custom_mods_are_filtered_and_marked_review() -> None:
    order = _make_order([("鍋貼", None)])
    candidates = _make_candidates(order)
    allowed_mods = ["加辣", "去蔥"]
    client = FakeLLMClient(
        [
            {
                "items": [
                    {
                        "line_index": 0,
                        "item_id": "L0A",
                        "mods": ["加辣", "神秘醬"],
                        "confidence_item": 0.95,
                        "confidence_mods": 0.95,
                        "needs_review": False,
                    }
                ],
                "groups": [],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, allowed_mods, llm_client=client)

    assert [mod.mod_raw for mod in result["items"][0].mods] == ["加辣", "神秘醬"]
    assert result["items"][0].needs_review is False
    assert result["items"][0].mods[0].confidence == 0.95
    assert any(event.event_type == "mods_beyond_reference" for event in result["audit_events"])


def test_non_list_mods_payload_is_blocked_and_marked_review() -> None:
    order = _make_order([("鍋貼", "加辣")])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {
                        "line_index": 0,
                        "item_id": "L0A",
                        "mods": "加辣",
                        "confidence_item": 0.95,
                        "confidence_mods": 0.95,
                        "needs_review": False,
                    }
                ],
                "groups": [],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert [mod.mod_raw for mod in result["items"][0].mods] == ["加辣"]
    assert result["items"][0].needs_review is True
    assert any(event.event_type == "invalid_mods_payload" for event in result["audit_events"])


def test_reference_phrase_is_sent_to_llm_and_converted_to_group_indices() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None), ("豆漿", "上面兩項同袋")])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {"line_index": 0, "item_id": "L0A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                    {"line_index": 1, "item_id": "L1A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                    {"line_index": 2, "item_id": "L2A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                ],
                "groups": [
                    {
                        "group_id": "G-ref",
                        "type": "pack_together",
                        "label": "上面兩項同袋",
                        "line_indices": [0, 1],
                        "confidence_group": 0.91,
                        "needs_review": False,
                    }
                ],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert "上面兩項同袋" in client.prompts[0]
    assert any(group.line_indices == [0, 1] for group in result["groups"])
    assert result["groups"][0].confidence_group == 0.91


def test_reference_grouping_backstops_when_llm_misses_groups() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None), ("豆漿", "上面兩項同袋")])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {"line_index": 0, "item_id": "L0A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                    {"line_index": 1, "item_id": "L1A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                    {"line_index": 2, "item_id": "L2A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                ],
                "groups": [],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert any(group.line_indices == [0, 1] for group in result["groups"])
    assert any(group.metadata.get("source") == "rule_backstop" for group in result["groups"])
    assert any(group.needs_review is True for group in result["groups"])
    assert "rule_group_backstop" in result["metadata"]["review_queue"]["reasons"]


def test_missing_item_id_and_string_bool_are_safely_handled() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {
                        "line_index": 0,
                        "mods": [],
                        "confidence_item": 0.9,
                        "confidence_mods": 0.9,
                        "needs_review": "false",
                    },
                    {
                        "line_index": 1,
                        "item_id": "L1A",
                        "mods": [],
                        "confidence_item": 0.9,
                        "confidence_mods": 0.9,
                        "needs_review": "false",
                    },
                ],
                "groups": [
                    {
                        "group_id": "G1",
                        "type": "pack_together",
                        "label": "同袋",
                        "line_indices": [0, 1],
                        "confidence_group": 0.9,
                        "needs_review": "false",
                    }
                ],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["items"][0].item_code == "L0A"
    assert result["items"][0].needs_review is True
    assert result["items"][1].needs_review is False
    assert result["groups"][0].needs_review is False
    assert any(event.event_type == "missing_item_id" for event in result["audit_events"])
    assert "item_id_missing" in result["metadata"]["review_queue"]["reasons"]


def test_group_out_of_scope_line_indices_and_type_are_intercepted() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {"line_index": 0, "item_id": "L0A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                    {"line_index": 1, "item_id": "L1A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                ],
                "groups": [
                    {
                        "group_id": "G-unsafe",
                        "type": "merge_all",
                        "label": "錯誤分組",
                        "line_indices": [0, 99, 1],
                        "confidence_group": 0.8,
                        "needs_review": False,
                    }
                ],
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["groups"][0].line_indices == [0, 1]
    assert result["groups"][0].type == "other"
    assert result["groups"][0].needs_review is True
    assert any(event.event_type == "group_line_indices_out_of_scope" for event in result["audit_events"])
    assert any(event.event_type == "group_type_out_of_allowed" for event in result["audit_events"])
    assert "group_line_indices_out_of_scope" in result["metadata"]["review_queue"]["audit_tags"]
    assert "group_type_out_of_scope" in result["metadata"]["review_queue"]["reasons"]


def test_llm_client_missing_triggers_traceable_fallback() -> None:
    order = _make_order([("鍋貼", None)])
    candidates = _make_candidates(order)

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=None)

    assert result["metadata"]["fallback_reason"] == "llm_client_missing"
    assert result["metadata"]["review_queue"]["needs_review"] is True
    assert "fallback:llm_client_missing" in result["metadata"]["review_queue"]["reasons"]
    assert "llm_client_missing" in result["metadata"]["review_queue"]["audit_tags"]
    assert result["items"][0].needs_review is True


def test_invalid_groups_payload_without_other_flags_still_needs_review() -> None:
    order = _make_order([("鍋貼", None), ("酸辣湯", None)])
    candidates = _make_candidates(order)
    client = FakeLLMClient(
        [
            {
                "items": [
                    {"line_index": 0, "item_id": "L0A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                    {"line_index": 1, "item_id": "L1A", "mods": [], "confidence_item": 0.9, "confidence_mods": 0.9, "needs_review": False},
                ],
                "groups": "invalid",
            }
        ]
    )

    result = llm_normalize_and_group(order, candidates, ["加辣"], llm_client=client)

    assert result["groups"] == []
    assert any(event.event_type == "invalid_groups_payload" for event in result["audit_events"])
    assert result["metadata"]["review_queue"]["needs_review"] is True
    assert "invalid_groups_payload" in result["metadata"]["review_queue"]["audit_tags"]
