from __future__ import annotations

import re

from .contracts import OrderRawParsed, RawLine

_SYMBOL_MAP = str.maketrans(
    {
        "：": ":",
        "（": "(",
        "）": ")",
        "＊": "*",
        "﹡": "*",
        "＄": "$",
        "Ｘ": "x",
        "ｘ": "x",
        "×": "x",
        "　": " ",
    }
)

_LEADING_MARKER_RE = re.compile(
    r"^\s*(?:[*\-•●#]+|\d{1,3}[.)、]|[(（]\d{1,3}[)）]|[A-Za-z][.)])\s*"
)
_SEPARATOR_RE = re.compile(r"^[\-=~_*#\s]{3,}$")
_PHONE_ONLY_RE = re.compile(
    r"^\s*(?:電話|tel)?\s*:?\s*(?:\+?886[-\s]?)?"
    r"(?:0\d{1,2}[-\s]?\d{6,8}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})"
    r"(?:\s*(?:#|ext\.?|轉)\s*\d{1,5})?\s*$",
    re.IGNORECASE,
)
_DATETIME_ONLY_RE = re.compile(
    r"^\s*(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)\s*$"
)
_NOTE_RE = re.compile(r"(?:備註|註記|附註|备注)\s*(?::\s*|\s+)(.+)$", re.IGNORECASE)
_TRAILING_PAREN_RE = re.compile(r"^(?P<base>.+?)\s*\((?P<note>[^()]+)\)\s*$")
_QTY_X_OR_STAR_RE = re.compile(r"^(?P<name>.+?)\s*[x*]\s*(?P<qty>-?\d+)\s*$", re.IGNORECASE)
_QTY_FEN_RE = re.compile(r"^(?P<name>.+?)\s+(?P<qty>-?\d+)\s*份\s*$")
_QTY_PLAIN_RE = re.compile(r"^(?P<name>.+?)\s+(?P<qty>-?\d+)\s*$")
_QTY_MARKER_ANY_RE = re.compile(r"^(?P<name>.+?)\s*[x*]\s*(?P<qty_text>\S*)\s*$", re.IGNORECASE)
_QTY_FEN_ANY_RE = re.compile(r"^(?P<name>.+?)\s+(?P<qty_text>\S+)\s*份\s*$")
_HAS_QTY_HINT_RE = re.compile(r"[x*]\s*\S+|\d+\s*份", re.IGNORECASE)
_HAS_QTY_MARKER_RE = re.compile(r"(?:^|\s)[x*]\s*\S+", re.IGNORECASE)
_HAS_FEN_MARKER_RE = re.compile(r"\d+\s*份")
_TRAILING_CURRENCY_AMOUNT_RE = re.compile(
    r"^(?P<body>.+?)\s*(?:ntd?\$?|twd|\$)\s*(?P<amount>\d+(?:\.\d{1,2})?)\s*$",
    re.IGNORECASE,
)
_TRAILING_AMOUNT_UNIT_RE = re.compile(r"^(?P<body>.+?)\s*(?P<amount>\d+(?:\.\d{1,2})?)\s*元\s*$")
_TRAILING_PLAIN_AMOUNT_RE = re.compile(r"^(?P<body>.+?)\s+(?P<amount>\d+(?:\.\d{1,2})?)\s*$")
_NOISE_PREFIX_RE = re.compile(
    r"^\s*(?:電話|tel|地址|統編|單號|訂單|時間|日期|總計|小計|合計|應收|找零)(?:\s|:|$)",
    re.IGNORECASE,
)


def _normalize_for_parse(line: str) -> str:
    normalized = line.translate(_SYMBOL_MAP)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _strip_leading_markers(line: str) -> str:
    current = line
    while True:
        stripped = _LEADING_MARKER_RE.sub("", current, count=1).strip()
        if stripped == current:
            return current
        current = stripped


def _is_noise_line(normalized_line: str) -> bool:
    if not normalized_line:
        return True
    if _SEPARATOR_RE.match(normalized_line):
        return True
    if _NOISE_PREFIX_RE.match(normalized_line):
        if _HAS_QTY_HINT_RE.search(normalized_line):
            return False
        return True
    if _PHONE_ONLY_RE.match(normalized_line):
        return True
    if _DATETIME_ONLY_RE.match(normalized_line):
        return True
    return False


def _extract_inline_note(text: str) -> tuple[str, str | None]:
    matched = _NOTE_RE.search(text)
    if matched:
        return text[: matched.start()].strip(), matched.group(1).strip()
    return text.strip(), None


def _extract_parenthetical_note(name_with_note: str) -> tuple[str, list[str]]:
    notes: list[str] = []
    current = name_with_note.strip()
    while True:
        matched = _TRAILING_PAREN_RE.match(current)
        if not matched:
            return current, notes
        notes.insert(0, matched.group("note").strip())
        current = matched.group("base").strip()


def _fallback_name(text: str) -> str:
    name = re.sub(r"[x*]\s*-?\d+\s*$", "", text, flags=re.IGNORECASE).strip()
    name = re.sub(r"\s*-?\d+\s*份?\s*$", "", name).strip()
    return name or text.strip()


def _extract_name_and_qty_once(text: str) -> tuple[str, int | None, str]:
    x_or_star = _QTY_X_OR_STAR_RE.match(text)
    if x_or_star:
        return x_or_star.group("name").strip(), int(x_or_star.group("qty")), "ok"

    fen = _QTY_FEN_RE.match(text)
    if fen:
        return fen.group("name").strip(), int(fen.group("qty")), "ok"

    marker_match = _QTY_MARKER_ANY_RE.match(text)
    if marker_match:
        qty_text = marker_match.group("qty_text").strip()
        state = "missing" if not qty_text else "invalid"
        return marker_match.group("name").strip(), None, state

    fen_match = _QTY_FEN_ANY_RE.match(text)
    if fen_match:
        return fen_match.group("name").strip(), None, "invalid"

    if _HAS_QTY_MARKER_RE.search(text) or _HAS_FEN_MARKER_RE.search(text):
        return text, None, "invalid"

    plain = _QTY_PLAIN_RE.match(text)
    if plain:
        return plain.group("name").strip(), int(plain.group("qty")), "ok"

    return text, None, "missing"


def _strip_trailing_amount(text: str) -> str:
    current = text.strip()
    for pattern in (_TRAILING_CURRENCY_AMOUNT_RE, _TRAILING_AMOUNT_UNIT_RE):
        matched = pattern.match(current)
        if matched:
            return matched.group("body").strip()

    plain = _TRAILING_PLAIN_AMOUNT_RE.match(current)
    if plain:
        body = plain.group("body").strip()
        if _HAS_QTY_HINT_RE.search(body):
            return body

    return current


def _extract_name_and_qty(prepared: str) -> tuple[str, int | None, str]:
    name_raw, qty, state = _extract_name_and_qty_once(prepared)
    if qty is not None:
        return name_raw, qty, state

    trimmed = _strip_trailing_amount(prepared)
    if trimmed != prepared:
        trimmed_name, trimmed_qty, trimmed_state = _extract_name_and_qty_once(trimmed)
        if trimmed_qty is not None or trimmed_state == "invalid":
            return trimmed_name, trimmed_qty, trimmed_state

    return name_raw, qty, state


def _parse_line(raw_line: str, line_index: int, warnings: list[str]) -> RawLine:
    normalized = _normalize_for_parse(raw_line)
    prepared = _strip_leading_markers(normalized)
    prepared, inline_note = _extract_inline_note(prepared)

    name_token, qty, qty_state = _extract_name_and_qty(prepared)

    needs_review = False
    if qty is None:
        qty = 1
        needs_review = True
        if qty_state == "invalid":
            warnings.append(f"line {line_index}: qty invalid, defaulted to 1")
        else:
            warnings.append(f"line {line_index}: qty missing, defaulted to 1")
        name_token = _fallback_name(name_token)
    elif qty <= 0:
        qty = 1
        needs_review = True
        warnings.append(f"line {line_index}: qty must be positive, defaulted to 1")

    name_raw, note_parts = _extract_parenthetical_note(name_token)
    if inline_note:
        note_parts.append(inline_note)
    note_raw = "; ".join(part for part in note_parts if part) or None

    if not name_raw:
        name_raw = _fallback_name(prepared) or normalized or raw_line.strip()
        needs_review = True
        warnings.append(f"line {line_index}: unable to confidently parse item name")

    return RawLine(
        line_index=line_index,
        raw_line=raw_line,
        name_raw=name_raw,
        qty=qty,
        note_raw=note_raw,
        needs_review=needs_review,
    )


_STANDALONE_NOTE_RE = re.compile(
    r"^\s*(?:備註|註記|附註|备注)\s*(?::\s*|\s+)(.+)$", re.IGNORECASE
)


def _is_standalone_note(raw_line: str) -> str | None:
    """Return the note text if the line is a standalone note (e.g. '備註:分裝'), else None."""
    normalized = _normalize_for_parse(raw_line)
    matched = _STANDALONE_NOTE_RE.match(normalized)
    if matched:
        return matched.group(1).strip() or None
    return None


def parse_receipt_text(text: str) -> OrderRawParsed:
    parse_warnings: list[str] = []
    parse_errors: list[str] = []
    lines: list[RawLine] = []

    for index, line in enumerate(text.splitlines()):
        raw_line = line.rstrip("\r")
        normalized = _normalize_for_parse(raw_line)
        if not normalized or _is_noise_line(normalized):
            continue

        standalone_note = _is_standalone_note(raw_line)
        if standalone_note:
            if lines:
                prev = lines[-1]
                existing = prev.note_raw
                merged = f"{existing}; {standalone_note}" if existing else standalone_note
                lines[-1] = RawLine(
                    line_index=prev.line_index,
                    raw_line=prev.raw_line,
                    name_raw=prev.name_raw,
                    qty=prev.qty,
                    note_raw=merged,
                    needs_review=prev.needs_review,
                    metadata=dict(prev.metadata),
                    version=prev.version,
                )
            else:
                parse_warnings.append(f"line {index}: standalone note with no preceding item")
            continue

        try:
            parsed = _parse_line(raw_line=raw_line, line_index=index, warnings=parse_warnings)
            lines.append(parsed)
        except Exception as exc:  # pragma: no cover - defensive branch
            parse_errors.append(f"line {index}: {exc}")
            parse_warnings.append(f"line {index}: parser exception fallback, defaulted qty to 1")
            lines.append(
                RawLine(
                    line_index=index,
                    raw_line=raw_line,
                    name_raw=_normalize_for_parse(raw_line) or raw_line.strip(),
                    qty=1,
                    note_raw=None,
                    needs_review=True,
                )
            )

    needs_review = bool(parse_warnings or parse_errors or any(line.needs_review for line in lines))
    return OrderRawParsed(
        source_text=text,
        lines=lines,
        parse_warnings=parse_warnings,
        needs_review=needs_review,
        metadata={"parse_errors": parse_errors},
    )
