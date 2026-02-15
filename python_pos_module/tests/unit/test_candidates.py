from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.candidates import generate_candidates  # noqa: E402
from pos_norm.contracts import RawLine  # noqa: E402


MENU_CATALOG = {
    "I001": ["招牌鍋貼", "黃金鍋貼"],
    "I002": ["咖哩鍋貼", "咖哩雞肉鍋貼"],
    "I003": ["酸辣湯", "酸辣湯(小)"],
    "I004": ["玉米濃湯"],
    "I005": ["韭菜鍋貼"],
    "I006": ["珍珠奶茶"],
}

MENU_CATALOG_DICT_SHAPE = {
    "I001": {"canonical_name": "招牌鍋貼", "aliases": ["黃金鍋貼"]},
    "I002": {"canonical_name": "咖哩鍋貼", "aliases": ["咖哩雞肉鍋貼"]},
    "I003": {"canonical_name": "酸辣湯", "aliases": ["酸辣湯(小)"]},
    "I004": {"canonical_name": "玉米濃湯", "aliases": []},
    "I005": {"canonical_name": "韭菜鍋貼", "aliases": []},
    "I006": {"canonical_name": "珍珠奶茶", "aliases": []},
}

MENU_CATALOG_LIST_SHAPE = [
    {"item_id": "I001", "canonical_name": "招牌鍋貼", "aliases": ["黃金鍋貼"]},
    {"item_id": "I002", "canonical_name": "咖哩鍋貼", "aliases": ["咖哩雞肉鍋貼"]},
    {"item_id": "I003", "canonical_name": "酸辣湯", "aliases": ["酸辣湯(小)"]},
    {"item_id": "I004", "canonical_name": "玉米濃湯", "aliases": []},
    {"item_id": "I005", "canonical_name": "韭菜鍋貼", "aliases": []},
    {"item_id": "I006", "canonical_name": "珍珠奶茶", "aliases": []},
]


def _line(index: int, name: str, raw: str | None = None) -> RawLine:
    return RawLine(
        line_index=index,
        raw_line=raw or name,
        name_raw=name,
        qty=1,
    )


def test_canonical_exact_match_ranked_first() -> None:
    result = generate_candidates([_line(0, "酸辣湯")], MENU_CATALOG, top_k=3)
    first = result[0][0]
    assert first.candidate_code == "I003"
    assert first.candidate_name == "酸辣湯"
    assert first.metadata["match_basis"] == "canonical"


def test_alias_match_uses_alias_basis() -> None:
    result = generate_candidates([_line(1, "咖哩雞肉鍋貼")], MENU_CATALOG, top_k=3)
    first = result[1][0]
    assert first.candidate_code == "I002"
    assert first.candidate_name == "咖哩鍋貼"
    assert first.metadata["match_basis"] == "alias"


def test_partial_token_match_still_hits_expected_item() -> None:
    result = generate_candidates([_line(2, "咖哩鍋")], MENU_CATALOG, top_k=3)
    assert result[2][0].candidate_code == "I002"


def test_noise_symbols_and_spaces_are_normalized() -> None:
    noisy = "  酸辣   湯 ！！！  "
    result = generate_candidates([_line(3, noisy, raw=noisy)], MENU_CATALOG, top_k=3)
    first = result[3][0]
    assert first.candidate_code == "I003"
    assert first.metadata["match_basis"] in {"canonical", "token"}


def test_no_obvious_match_still_returns_candidates_with_low_confidence_hint() -> None:
    result = generate_candidates([_line(4, "火星奶蓋麵")], MENU_CATALOG, top_k=4)
    candidates = result[4]
    assert len(candidates) == 4
    assert all(candidate.metadata["low_confidence"] is True for candidate in candidates)
    assert all(candidate.needs_review is True for candidate in candidates)


def test_top_k_limit_is_enforced() -> None:
    result = generate_candidates([_line(5, "鍋貼")], MENU_CATALOG, top_k=2)
    assert len(result[5]) == 2


def test_scores_are_sorted_desc_and_monotonic_non_increasing() -> None:
    result = generate_candidates([_line(6, "鍋貼")], MENU_CATALOG, top_k=6)
    scores = [float(candidate.confidence_item or 0.0) for candidate in result[6]]
    assert scores == sorted(scores, reverse=True)
    assert all(scores[i] >= scores[i + 1] for i in range(len(scores) - 1))


def test_output_never_contains_item_id_outside_catalog() -> None:
    lines = [_line(7, "咖哩雞肉鍋貼"), _line(8, "完全未知品項")]
    result = generate_candidates(lines, MENU_CATALOG, top_k=5)
    valid_ids = set(MENU_CATALOG.keys())
    for line_candidates in result.values():
        for candidate in line_candidates:
            assert candidate.candidate_code in valid_ids


def test_supports_line_mapping_input_with_required_fields_only() -> None:
    line = {"line_index": 9, "name_raw": "酸辣湯", "raw_line": "酸辣湯"}
    result = generate_candidates([line], MENU_CATALOG, top_k=3)
    first = result[9][0]
    assert first.candidate_code == "I003"
    assert first.qty == 1


def test_top_k_zero_returns_empty_candidates() -> None:
    result = generate_candidates([_line(10, "鍋貼")], MENU_CATALOG, top_k=0)
    assert result[10] == []


def test_top_k_exceeds_catalog_returns_all_catalog_items() -> None:
    result = generate_candidates([_line(11, "鍋貼")], MENU_CATALOG, top_k=999)
    assert len(result[11]) == len(MENU_CATALOG)


def test_low_confidence_metadata_is_explainable() -> None:
    result = generate_candidates([_line(12, "火星奶蓋麵")], MENU_CATALOG, top_k=3)
    for idx, candidate in enumerate(result[12], start=1):
        assert candidate.metadata["low_confidence"] is True
        assert float(candidate.metadata["best_line_score"]) <= float(
            candidate.metadata["low_confidence_threshold"]
        )
        assert candidate.metadata["rank"] == idx
        assert candidate.metadata["review_reason"] == "best_score_below_threshold"


def test_dict_catalog_shape_generates_correct_item_id() -> None:
    result = generate_candidates([_line(13, "咖哩雞肉鍋貼")], MENU_CATALOG_DICT_SHAPE, top_k=3)
    first = result[13][0]
    assert first.candidate_code == "I002"
    assert first.candidate_name == "咖哩鍋貼"


def test_list_catalog_shape_generates_correct_item_id() -> None:
    result = generate_candidates([_line(14, "咖哩雞肉鍋貼")], MENU_CATALOG_LIST_SHAPE, top_k=3)
    first = result[14][0]
    assert first.candidate_code == "I002"
    assert first.candidate_name == "咖哩鍋貼"


def test_list_and_dict_catalog_shapes_produce_same_item_ids() -> None:
    lines = [_line(15, "咖哩雞肉鍋貼"), _line(16, "酸辣湯")]
    from_dict = generate_candidates(lines, MENU_CATALOG_DICT_SHAPE, top_k=5)
    from_list = generate_candidates(lines, MENU_CATALOG_LIST_SHAPE, top_k=5)

    for line in lines:
        dict_ids = [candidate.candidate_code for candidate in from_dict[line.line_index]]
        list_ids = [candidate.candidate_code for candidate in from_list[line.line_index]]
        assert dict_ids == list_ids


def test_list_catalog_never_emits_empty_candidate_code() -> None:
    list_catalog = [
        {"item_id": "", "canonical_name": "酸辣湯", "aliases": ["酸辣湯(小)"]},
        {"canonical_name": "玉米濃湯", "aliases": []},
    ]
    result = generate_candidates([_line(17, "酸辣湯")], list_catalog, top_k=5)
    assert result[17]
    assert all((candidate.candidate_code or "").strip() for candidate in result[17])


def test_dict_catalog_payload_item_id_overrides_mapping_key() -> None:
    dict_catalog = {
        "legacy-key": {"item_id": "I200", "canonical_name": "牛肉湯", "aliases": ["清燉牛肉湯"]},
        "I003": {"canonical_name": "酸辣湯", "aliases": ["酸辣湯(小)"]},
    }
    result = generate_candidates([_line(18, "清燉牛肉湯")], dict_catalog, top_k=3)
    assert result[18][0].candidate_code == "I200"


def test_dict_catalog_never_emits_empty_candidate_code() -> None:
    dict_catalog = {
        "": {"canonical_name": "酸辣湯", "aliases": ["酸辣湯(小)"]},
        " ": {"canonical_name": "", "aliases": []},
    }
    result = generate_candidates([_line(19, "酸辣湯")], dict_catalog, top_k=5)
    assert result[19]
    assert all((candidate.candidate_code or "").strip() for candidate in result[19])


def test_alias_singular_field_is_supported_for_ingest_payload() -> None:
    list_catalog = [
        {"item_id": "I201", "canonical_name": "咖哩鍋貼", "alias": "咖哩雞肉鍋貼"},
        {"item_id": "I003", "canonical_name": "酸辣湯", "aliases": ["酸辣湯(小)"]},
    ]
    result = generate_candidates([_line(20, "咖哩雞肉鍋貼")], list_catalog, top_k=3)
    assert result[20][0].candidate_code == "I201"


def test_ingest_weird_alias_types_do_not_crash_and_keep_non_empty_code() -> None:
    list_catalog = [
        {"item_id": "I301", "canonical_name": "豆漿", "aliases": 123},
        {"item_id": "I302", "canonical_name": "米漿", "aliases": {"a": "甜米漿"}},
    ]
    result = generate_candidates([_line(21, "豆漿")], list_catalog, top_k=5)
    assert result[21]
    assert all((candidate.candidate_code or "").strip() for candidate in result[21])


def test_dict_payload_non_sequence_value_does_not_break_ingest() -> None:
    dict_catalog = {
        "I401": 999,
        "I402": {"canonical_name": "酸辣湯", "aliases": []},
    }
    result = generate_candidates([_line(22, "酸辣湯")], dict_catalog, top_k=5)
    assert result[22]
    assert all((candidate.candidate_code or "").strip() for candidate in result[22])
