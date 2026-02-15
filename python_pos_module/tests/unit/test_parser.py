from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.parser import parse_receipt_text  # noqa: E402


def test_parse_x_qty_format() -> None:
    result = parse_receipt_text("招牌鍋貼 x5")
    assert len(result.lines) == 1
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].qty == 5
    assert result.lines[0].note_raw is None


def test_parse_star_qty_format() -> None:
    result = parse_receipt_text("招牌鍋貼*5")
    assert len(result.lines) == 1
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].qty == 5


def test_parse_fen_qty_format() -> None:
    result = parse_receipt_text("招牌鍋貼 5份")
    assert len(result.lines) == 1
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].qty == 5


def test_parse_parenthetical_note() -> None:
    result = parse_receipt_text("招牌鍋貼(去醬) x2")
    assert len(result.lines) == 1
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].qty == 2
    assert result.lines[0].note_raw == "去醬"


def test_parse_inline_note_keyword() -> None:
    result = parse_receipt_text("招牌鍋貼 x2 備註:加辣")
    assert len(result.lines) == 1
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].qty == 2
    assert result.lines[0].note_raw == "加辣"


def test_parse_dirty_whitespace_and_symbols() -> None:
    raw = "  * 01.　招牌鍋貼　＊  3　註記：少油  "
    result = parse_receipt_text(raw)
    assert len(result.lines) == 1
    line = result.lines[0]
    assert line.raw_line == raw
    assert line.line_index == 0
    assert line.name_raw == "招牌鍋貼"
    assert line.qty == 3
    assert line.note_raw == "少油"


def test_qty_missing_or_invalid_defaults_to_one_with_warning() -> None:
    text = "\n".join(
        [
            "招牌鍋貼 xO",
            "辣味鍋貼 x",
            "韭菜鍋貼 -2",
            "酸辣湯",
        ]
    )
    result = parse_receipt_text(text)

    assert len(result.lines) == 4
    assert [line.qty for line in result.lines] == [1, 1, 1, 1]
    assert all(line.needs_review for line in result.lines)
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].raw_line == "招牌鍋貼 xO"
    assert result.lines[1].name_raw == "辣味鍋貼"
    assert result.lines[1].raw_line == "辣味鍋貼 x"
    assert result.needs_review is True
    assert len(result.parse_warnings) == 4
    assert any("qty invalid" in warning for warning in result.parse_warnings)
    assert any("qty missing" in warning for warning in result.parse_warnings)


def test_skip_non_item_noise_lines_and_keep_original_line_index() -> None:
    text = "\n".join(
        [
            "電話:02-12345678",
            "招牌鍋貼 x2",
            "時間:2026/02/14 12:30",
            "酸辣湯 1份",
            "單號:AB123",
        ]
    )
    result = parse_receipt_text(text)

    assert [line.line_index for line in result.lines] == [1, 3]
    assert [line.name_raw for line in result.lines] == ["招牌鍋貼", "酸辣湯"]
    assert [line.qty for line in result.lines] == [2, 1]


def test_skip_address_and_order_id_noise_lines() -> None:
    text = "\n".join(
        [
            "地址:台北市大安區和平東路一段1號",
            "TEL: 02-23456789",
            "單號: AB-20260214-01",
            "時間:2026/02/14 18:30",
            "高麗菜鍋貼 x3",
        ]
    )
    result = parse_receipt_text(text)
    assert [line.line_index for line in result.lines] == [4]
    assert result.lines[0].name_raw == "高麗菜鍋貼"
    assert result.lines[0].qty == 3


def test_noise_keyword_inside_item_name_should_not_be_skipped() -> None:
    result = parse_receipt_text("時間限定鍋貼 x2 備註:加蒜")
    assert len(result.lines) == 1
    line = result.lines[0]
    assert line.name_raw == "時間限定鍋貼"
    assert line.qty == 2
    assert line.note_raw == "加蒜"


def test_skip_plain_phone_and_datetime_noise_lines() -> None:
    text = "\n".join(
        [
            "02-12345678",
            "2026/02/14 18:30",
            "招牌鍋貼 x2",
        ]
    )
    result = parse_receipt_text(text)
    assert len(result.lines) == 1
    assert result.lines[0].line_index == 2
    assert result.lines[0].name_raw == "招牌鍋貼"
    assert result.lines[0].qty == 2


def test_parse_mixed_symbols_and_fullwidth_digits() -> None:
    text = " ● 1) 招牌鍋貼 × ２ 註記：少油 "
    result = parse_receipt_text(text)
    assert len(result.lines) == 1
    line = result.lines[0]
    assert line.name_raw == "招牌鍋貼"
    assert line.qty == 2
    assert line.note_raw == "少油"


def test_parse_item_with_trailing_price_tokens() -> None:
    text = "\n".join(
        [
            "1. 招牌鍋貼 x2 120",
            "韭菜鍋貼 3份 NT$90",
            "玉米濃湯 *2 40元 備註:少胡椒",
        ]
    )
    result = parse_receipt_text(text)
    assert len(result.lines) == 3
    assert [line.name_raw for line in result.lines] == ["招牌鍋貼", "韭菜鍋貼", "玉米濃湯"]
    assert [line.qty for line in result.lines] == [2, 3, 2]
    assert result.lines[2].note_raw == "少胡椒"


def test_noise_prefix_line_with_item_qty_should_not_be_dropped() -> None:
    result = parse_receipt_text("訂單: 招牌鍋貼 x2")
    assert len(result.lines) == 1
    assert result.lines[0].name_raw == "訂單: 招牌鍋貼"
    assert result.lines[0].qty == 2


def test_uncertain_note_only_line_keeps_raw_name_and_note_with_review() -> None:
    text = "備註:加辣"
    result = parse_receipt_text(text)
    assert len(result.lines) == 1
    line = result.lines[0]
    assert line.raw_line == text
    assert line.name_raw == "備註:加辣"
    assert line.note_raw == "加辣"
    assert line.qty == 1
    assert line.needs_review is True
    assert result.needs_review is True


def test_result_fields_are_complete_for_downstream_usage() -> None:
    text = "\n".join(["招牌鍋貼(去醬) x2", "酸辣湯 1份", "韭菜鍋貼 xO"])
    result = parse_receipt_text(text)
    assert isinstance(result.source_text, str)
    assert isinstance(result.lines, list)
    assert isinstance(result.parse_warnings, list)
    assert isinstance(result.metadata.get("parse_errors"), list)
    for line in result.lines:
        assert isinstance(line.line_index, int)
        assert isinstance(line.raw_line, str)
        assert isinstance(line.name_raw, str)
        assert isinstance(line.qty, int)
        assert line.note_raw is None or isinstance(line.note_raw, str)
