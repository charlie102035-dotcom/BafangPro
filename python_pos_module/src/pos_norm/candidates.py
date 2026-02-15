from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Mapping, Sequence

from .contracts import CandidateItem, CandidatesByLine, MenuCatalog, RawLine

try:
    from rapidfuzz import fuzz  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    fuzz = None


_COMMON_SYMBOLS_RE = re.compile(
    r"""[!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~，。！？、；：／（）【】「」『』《》〈〉·．]"""
)
_MULTI_SPACE_RE = re.compile(r"\s+")

_W_CHAR = 0.50
_W_PARTIAL = 0.30
_W_TOKEN = 0.20
_LOW_CONFIDENCE_THRESHOLD = 55.0


@dataclass(slots=True)
class _CatalogEntry:
    item_id: str
    canonical_name: str
    aliases: list[str]


def _normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).lower()
    normalized = _COMMON_SYMBOLS_RE.sub(" ", normalized)
    normalized = _MULTI_SPACE_RE.sub(" ", normalized)
    return normalized.strip()


def _compact_text(text: str) -> str:
    return text.replace(" ", "")


def _tokenize(text: str) -> set[str]:
    normalized = _normalize_text(text)
    compact = _compact_text(normalized)
    if not compact:
        return set()
    tokens: set[str] = {part for part in normalized.split(" ") if part}
    if len(compact) == 1:
        tokens.add(compact)
        return tokens
    tokens.update(compact[i : i + 2] for i in range(len(compact) - 1))
    return tokens


def _ratio(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if fuzz is not None:
        return float(fuzz.ratio(left, right))
    return SequenceMatcher(a=left, b=right).ratio() * 100.0


def _partial_ratio(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if fuzz is not None:
        return float(fuzz.partial_ratio(left, right))

    short, long = (left, right) if len(left) <= len(right) else (right, left)
    if short in long:
        return 100.0
    if len(short) == len(long):
        return _ratio(short, long)
    max_score = 0.0
    window = len(short)
    for start in range(0, len(long) - window + 1):
        score = SequenceMatcher(a=short, b=long[start : start + window]).ratio() * 100.0
        if score > max_score:
            max_score = score
    return max_score


def _token_similarity(left_tokens: set[str], right_tokens: set[str]) -> float:
    if not left_tokens or not right_tokens:
        return 0.0
    inter = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    if union == 0:
        return 0.0
    return (inter / union) * 100.0


def _score_match(query: str, candidate: str) -> tuple[float, str]:
    query_norm = _normalize_text(query)
    candidate_norm = _normalize_text(candidate)
    query_compact = _compact_text(query_norm)
    candidate_compact = _compact_text(candidate_norm)

    char_score = _ratio(query_compact, candidate_compact)
    partial_score = _partial_ratio(query_compact, candidate_compact)
    token_score = _token_similarity(_tokenize(query_norm), _tokenize(candidate_norm))

    score = (_W_CHAR * char_score) + (_W_PARTIAL * partial_score) + (_W_TOKEN * token_score)
    if query_compact and candidate_compact and (
        query_compact in candidate_compact or candidate_compact in query_compact
    ):
        score += 5.0

    score = max(0.0, min(100.0, score))
    basis = "token" if token_score >= max(char_score, partial_score) + 5.0 else "string"
    return score, basis


def _coerce_aliases(raw_aliases: Any) -> list[str]:
    if raw_aliases is None:
        return []
    if isinstance(raw_aliases, Mapping):
        return [str(alias) for alias in raw_aliases.values() if str(alias).strip()]
    if isinstance(raw_aliases, str):
        text = raw_aliases.strip()
        return [text] if text else []
    if isinstance(raw_aliases, Sequence) and not isinstance(raw_aliases, (bytes, bytearray)):
        return [str(alias) for alias in raw_aliases if str(alias).strip()]
    text = str(raw_aliases).strip()
    return [text] if text else []


def _normalize_catalog_entry(item_id: Any, payload: Any) -> _CatalogEntry:
    canonical_name = ""
    aliases: list[str] = []

    if isinstance(payload, str):
        canonical_name = payload
    elif isinstance(payload, Mapping):
        raw_name = payload.get("canonical_name") or payload.get("name")
        canonical_name = str(raw_name or item_id)
        aliases = _coerce_aliases(payload.get("aliases", payload.get("alias")))
    elif isinstance(payload, Sequence) and not isinstance(payload, (str, bytes, bytearray)):
        names = [str(part) for part in payload if str(part).strip()]
        if names:
            canonical_name = names[0]
            aliases = names[1:]
        else:
            canonical_name = str(item_id)
    else:
        canonical_name = str(payload).strip() or str(item_id)

    canonical_name = canonical_name.strip()
    item_id_text = str(item_id).strip()
    if not item_id_text:
        item_id_text = canonical_name or "unknown_item"
    if not canonical_name:
        canonical_name = item_id_text

    return _CatalogEntry(
        item_id=item_id_text,
        canonical_name=canonical_name,
        aliases=aliases,
    )


def _as_catalog_entries(menu_catalog: Any) -> list[_CatalogEntry]:
    entries: list[_CatalogEntry] = []

    if isinstance(menu_catalog, Mapping):
        for item_id, payload in menu_catalog.items():
            entry_item_id = item_id
            if isinstance(payload, Mapping):
                payload_item_id = payload.get("item_id") or payload.get("id")
                if payload_item_id is not None and str(payload_item_id).strip():
                    entry_item_id = payload_item_id
            entries.append(_normalize_catalog_entry(item_id=entry_item_id, payload=payload))
        return entries

    if isinstance(menu_catalog, Sequence) and not isinstance(menu_catalog, (str, bytes, bytearray)):
        for index, payload in enumerate(menu_catalog):
            if not isinstance(payload, Mapping):
                continue
            item_id = payload.get("item_id") or payload.get("id")
            if item_id is None or not str(item_id).strip():
                item_id = payload.get("canonical_name") or payload.get("name") or f"list_item_{index}"
            entries.append(_normalize_catalog_entry(item_id=item_id, payload=payload))

    return entries


def _read_line_value(line: RawLine | Mapping[str, Any], key: str, default: Any) -> Any:
    if isinstance(line, Mapping):
        return line.get(key, default)
    return getattr(line, key, default)


def generate_candidates(
    lines: Sequence[RawLine],
    menu_catalog: MenuCatalog,
    top_k: int = 10,
    low_confidence_threshold: float = _LOW_CONFIDENCE_THRESHOLD,
) -> CandidatesByLine:
    entries = _as_catalog_entries(menu_catalog)
    limit = max(0, int(top_k))
    candidates_by_line: CandidatesByLine = {}

    for line in lines:
        line_index = int(_read_line_value(line, "line_index", -1))
        raw_line = str(_read_line_value(line, "raw_line", ""))
        name_raw = str(_read_line_value(line, "name_raw", ""))
        qty = int(_read_line_value(line, "qty", 1) or 1)
        note_raw = _read_line_value(line, "note_raw", None)
        line_needs_review = bool(_read_line_value(line, "needs_review", False))

        scored: list[tuple[float, str, str, _CatalogEntry]] = []
        for entry in entries:
            best_score = -1.0
            best_basis = "canonical"
            matched_text = entry.canonical_name

            canonical_score, canonical_basis = _score_match(name_raw, entry.canonical_name)
            if canonical_score > best_score:
                best_score = canonical_score
                best_basis = "token" if canonical_basis == "token" else "canonical"
                matched_text = entry.canonical_name

            for alias in entry.aliases:
                alias_score, alias_basis = _score_match(name_raw, alias)
                if alias_score > best_score:
                    best_score = alias_score
                    best_basis = "token" if alias_basis == "token" else "alias"
                    matched_text = alias

            scored.append((best_score, best_basis, matched_text, entry))

        scored.sort(key=lambda row: (-row[0], row[3].canonical_name, row[3].item_id))
        selected = scored[:limit] if limit > 0 else []
        best_line_score = selected[0][0] if selected else 0.0
        low_confidence = best_line_score < low_confidence_threshold

        line_candidates: list[CandidateItem] = []
        for rank, (score, basis, matched_text, entry) in enumerate(selected, start=1):
            review_reason = "best_score_below_threshold" if low_confidence else "ok"
            candidate = CandidateItem(
                line_index=line_index,
                raw_line=raw_line,
                name_raw=name_raw,
                qty=qty,
                candidate_name=entry.canonical_name,
                candidate_code=entry.item_id,
                note_raw=note_raw,
                confidence_item=round(score, 4),
                needs_review=line_needs_review or low_confidence,
                metadata={
                    "match_basis": basis,
                    "score": round(score, 4),
                    "low_confidence": low_confidence,
                    "matched_text": matched_text,
                    "rank": rank,
                    "best_line_score": round(best_line_score, 4),
                    "low_confidence_threshold": round(low_confidence_threshold, 4),
                    "review_reason": review_reason,
                },
            )
            line_candidates.append(candidate)

        candidates_by_line[line_index] = line_candidates

    return candidates_by_line


__all__ = ["generate_candidates"]
