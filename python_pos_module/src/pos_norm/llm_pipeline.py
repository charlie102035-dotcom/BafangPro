from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .contracts import (
    CONTRACT_VERSION,
    AllowedMods,
    AuditEvent,
    CandidateItem,
    CandidatesByLine,
    GroupResult,
    Mod,
    NormalizedItem,
    OrderRawParsed,
    StructuredResult,
)

_PROMPT_PATH = Path(__file__).resolve().parents[2] / "prompts" / "normalize_group.prompt.md"
_GROUP_KEYWORDS = (
    "一起",
    "同一袋",
    "同袋",
    "同包",
    "合併",
    "合并",
    "裝一起",
    "装一起",
    "上面",
    "前面",
)
_REF_COUNT_MAP = {
    "1": 1,
    "2": 2,
    "3": 3,
    "一": 1,
    "二": 2,
    "兩": 2,
    "两": 2,
    "三": 3,
}
_REF_RE = re.compile(r"(上面|前面|前)\s*([123一二兩两三])\s*項")
_VALID_GROUP_TYPES = {"pack_together", "separate", "other"}
_AUDIT_REASON_MAP = {
    "llm_client_missing": "fallback_llm_client_missing",
    "llm_timeout": "fallback_llm_timeout",
    "llm_api_error": "fallback_llm_api_error",
    "llm_json_parse_error": "fallback_llm_json_parse_error",
    "item_id_out_of_candidates": "item_id_out_of_scope",
    "missing_item_id": "item_id_missing",
    "mods_out_of_allowed": "mods_out_of_scope",
    "invalid_mods_payload": "mods_payload_invalid",
    "group_line_indices_out_of_scope": "group_line_indices_out_of_scope",
    "group_type_out_of_allowed": "group_type_out_of_scope",
}


def _load_prompt_template(prompt_path: str | Path | None = None) -> str:
    path = Path(prompt_path) if prompt_path else _PROMPT_PATH
    return path.read_text(encoding="utf-8")


def _build_item_id(candidate: CandidateItem, slot: int) -> str:
    base = candidate.candidate_code or candidate.candidate_name or f"candidate_{slot + 1}"
    return str(base)


def _call_with_optional_timeout(fn: Callable[..., Any], prompt: str, timeout_s: float) -> str:
    attempts = (
        lambda: fn(prompt=prompt, timeout_s=timeout_s),
        lambda: fn(prompt, timeout_s=timeout_s),
        lambda: fn(prompt=prompt),
        lambda: fn(prompt),
    )
    last_type_error: TypeError | None = None
    for attempt in attempts:
        try:
            response = attempt()
            return response if isinstance(response, str) else json.dumps(response, ensure_ascii=False)
        except TypeError as exc:
            last_type_error = exc
    if last_type_error is not None:
        raise last_type_error
    raise RuntimeError("Unable to invoke llm client")


def _invoke_llm(llm_client: Any, prompt: str, timeout_s: float) -> str:
    if hasattr(llm_client, "complete"):
        fn = llm_client.complete
    elif hasattr(llm_client, "invoke"):
        fn = llm_client.invoke
    elif callable(llm_client):
        fn = llm_client
    else:
        raise TypeError("llm_client must be callable or implement complete()/invoke()")
    return _call_with_optional_timeout(fn, prompt=prompt, timeout_s=timeout_s)


def _extract_json_payload(text: str) -> Mapping[str, Any]:
    try:
        value = json.loads(text)
        if not isinstance(value, Mapping):
            raise ValueError("LLM output must be a JSON object")
        return value
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("LLM output is not valid JSON")
        candidate = text[start : end + 1]
        value = json.loads(candidate)
        if not isinstance(value, Mapping):
            raise ValueError("LLM output must be a JSON object")
        return value


def _safe_confidence(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed < 0:
        return 0.0
    if parsed > 1:
        return 1.0
    return parsed


def _safe_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n"}:
            return False
    return default


def _is_timeout_like_error(exc: Exception) -> bool:
    name = exc.__class__.__name__.lower()
    if "timeout" in name:
        return True
    message = str(exc).lower()
    timeout_keywords = ("timeout", "timed out", "time out", "超時", "超时")
    return any(keyword in message for keyword in timeout_keywords)


def _unique_tokens(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    tokens: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        token = value.strip()
        if not token or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def _metadata_tokens(metadata: Mapping[str, Any], key: str) -> list[str]:
    raw = metadata.get(key)
    if not isinstance(raw, list):
        return []
    return _unique_tokens([item for item in raw if isinstance(item, str)])


def _collect_review_queue_metadata(
    *,
    items: Sequence[NormalizedItem],
    groups: Sequence[GroupResult],
    audit_events: Sequence[AuditEvent],
    fallback_reason: str | None,
) -> dict[str, Any]:
    needs_review = bool(fallback_reason) or any(item.needs_review for item in items) or any(group.needs_review for group in groups)
    reasons: list[str] = []
    if fallback_reason:
        reasons.append(f"fallback:{fallback_reason}")
    tags: list[str] = []

    for item in items:
        if item.needs_review:
            reasons.extend(_metadata_tokens(item.metadata, "review_reasons"))
            tags.extend(_metadata_tokens(item.metadata, "review_tags"))

    for group in groups:
        if group.needs_review:
            reasons.extend(_metadata_tokens(group.metadata, "review_reasons"))
            tags.extend(_metadata_tokens(group.metadata, "review_tags"))

    for event in audit_events:
        tags.append(event.event_type)
        event_tags = _metadata_tokens(event.metadata, "tags")
        tags.extend(event_tags)
        mapped_reason = _AUDIT_REASON_MAP.get(event.event_type)
        if mapped_reason:
            reasons.append(mapped_reason)
            needs_review = True
        if any(tag in {"policy_violation", "review_queue"} for tag in event_tags):
            needs_review = True

    return {
        "needs_review": needs_review,
        "reasons": sorted(_unique_tokens(reasons)),
        "audit_tags": sorted(_unique_tokens(tags)),
    }


def _extract_mod_tokens(raw_mods: Any) -> list[str]:
    if not isinstance(raw_mods, list):
        return []
    tokens: list[str] = []
    for item in raw_mods:
        token: str | None = None
        if isinstance(item, str):
            token = item.strip()
        elif isinstance(item, Mapping):
            for key in ("mod", "mod_raw", "mod_name", "name"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    token = value.strip()
                    break
        if token:
            tokens.append(token)
    return tokens


def _rule_mods_from_line(line_text: str, allowed_mods: Sequence[str]) -> list[str]:
    mods: list[str] = []
    for mod in allowed_mods:
        if mod and mod not in mods and mod in line_text:
            mods.append(mod)
    return mods


def _resolve_reference_indices(line_positions: list[int], current_pos: int, text: str) -> list[int]:
    previous = line_positions[:current_pos]
    matched = _REF_RE.search(text)
    if matched:
        count_token = matched.group(2)
        count = _REF_COUNT_MAP.get(count_token)
        if count and previous:
            return previous[-count:]
    if ("全部" in text or "都" in text) and any(keyword in text for keyword in ("一起", "同袋", "同包", "合併", "合并")):
        return line_positions[: current_pos + 1]
    if any(keyword in text for keyword in ("一起", "同袋", "同包", "合併", "合并", "裝一起", "装一起")) and previous:
        return [previous[-1], line_positions[current_pos]]
    return []


def _build_step1_group_hints(order_raw: OrderRawParsed) -> list[dict[str, Any]]:
    line_positions = [line.line_index for line in order_raw.lines]
    hints: list[dict[str, Any]] = []
    for pos, line in enumerate(order_raw.lines):
        text = " ".join(part for part in (line.note_raw, line.raw_line) if part).strip()
        if not text:
            continue
        if not any(keyword in text for keyword in _GROUP_KEYWORDS):
            continue
        refs = _resolve_reference_indices(line_positions=line_positions, current_pos=pos, text=text)
        hints.append(
            {
                "trigger_line_index": line.line_index,
                "candidate_group_note": line.note_raw or line.raw_line,
                "referenced_line_indices": refs,
            }
        )
    return hints


def _build_rule_groups(
    hints: Sequence[Mapping[str, Any]],
    *,
    mark_review: bool,
    source: str,
) -> list[GroupResult]:
    groups: list[GroupResult] = []
    seen: set[tuple[int, ...]] = set()
    for hint in hints:
        indices = hint.get("referenced_line_indices")
        if not isinstance(indices, list):
            continue
        normalized = sorted({int(idx) for idx in indices if isinstance(idx, int)})
        key = tuple(normalized)
        if len(normalized) < 2 or key in seen:
            continue
        seen.add(key)
        metadata: dict[str, Any] = {"source": source}
        if mark_review:
            metadata["review_reasons"] = ["rule_group_backstop"]
            metadata["review_tags"] = ["rule_group_backstop"]
        groups.append(
            GroupResult(
                group_id=f"G{len(groups) + 1}",
                type="pack_together",
                label="rule_group_note",
                line_indices=normalized,
                confidence_group=0.35,
                needs_review=mark_review,
                metadata=metadata,
            )
        )
    return groups


def _build_candidate_context(
    order_raw: OrderRawParsed,
    candidates: CandidatesByLine,
    hints: Sequence[Mapping[str, Any]],
) -> tuple[dict[int, dict[str, CandidateItem]], list[dict[str, Any]]]:
    hint_by_line: dict[int, str] = {}
    for hint in hints:
        line_index = hint.get("trigger_line_index")
        note = hint.get("candidate_group_note")
        if isinstance(line_index, int) and isinstance(note, str):
            hint_by_line[line_index] = note

    item_lookup: dict[int, dict[str, CandidateItem]] = {}
    payload: list[dict[str, Any]] = []
    for line in order_raw.lines:
        line_candidates = candidates.get(line.line_index, [])
        lookup_for_line: dict[str, CandidateItem] = {}
        candidate_payload: list[dict[str, str | None]] = []
        for slot, candidate in enumerate(line_candidates):
            item_id = _build_item_id(candidate, slot=slot)
            if item_id in lookup_for_line:
                item_id = f"{item_id}#{slot + 1}"
            lookup_for_line[item_id] = candidate
            candidate_payload.append(
                {
                    "item_id": item_id,
                    "candidate_name": candidate.candidate_name,
                    "candidate_code": candidate.candidate_code,
                }
            )
        item_lookup[line.line_index] = lookup_for_line
        payload.append(
            {
                "line_index": line.line_index,
                "raw_line": line.raw_line,
                "name_raw": line.name_raw,
                "qty": line.qty,
                "note_raw": line.note_raw,
                "candidate_group_note": hint_by_line.get(line.line_index),
                "candidates": candidate_payload,
            }
        )
    return item_lookup, payload


def _render_prompt(
    *,
    template: str,
    allowed_mods: Sequence[str],
    line_payload: Sequence[Mapping[str, Any]],
    step1_hints: Sequence[Mapping[str, Any]],
) -> str:
    prompt = template
    prompt = prompt.replace("{{ALLOWED_MODS_JSON}}", json.dumps(list(allowed_mods), ensure_ascii=False, indent=2))
    prompt = prompt.replace("{{ORDER_LINES_JSON}}", json.dumps(list(line_payload), ensure_ascii=False, indent=2))
    prompt = prompt.replace("{{STEP1_HINTS_JSON}}", json.dumps(list(step1_hints), ensure_ascii=False, indent=2))
    return prompt


def _audit(
    event_type: str,
    message: str,
    line_index: int | None = None,
    metadata: dict[str, Any] | None = None,
    tags: Sequence[str] | None = None,
) -> AuditEvent:
    payload = dict(metadata or {})
    inherited_tags = payload.get("tags")
    merged_tags: list[str] = [event_type]
    if isinstance(inherited_tags, list):
        merged_tags.extend([tag for tag in inherited_tags if isinstance(tag, str)])
    if tags:
        merged_tags.extend([tag for tag in tags if isinstance(tag, str)])
    payload["tags"] = _unique_tokens(merged_tags)
    return AuditEvent(
        event_type=event_type,
        message=message,
        line_index=line_index,
        metadata=payload,
    )


def _build_fallback_items(
    order_raw: OrderRawParsed,
    candidates: CandidatesByLine,
    allowed_mods: Sequence[str],
    *,
    force_review: bool,
    fallback_reason: str | None,
    audit_events: list[AuditEvent],
) -> list[NormalizedItem]:
    items: list[NormalizedItem] = []
    for line in order_raw.lines:
        line_candidates = candidates.get(line.line_index, [])
        selected = line_candidates[0] if line_candidates else None
        review_reasons: list[str] = []
        review_tags: list[str] = []
        if force_review:
            review_reasons.append("llm_fallback")
            review_tags.append("llm_fallback")
            if fallback_reason:
                review_reasons.append(f"fallback:{fallback_reason}")
                review_tags.append(fallback_reason)
        if selected is None:
            audit_events.append(
                _audit(
                    "missing_candidates",
                    "No candidates found; fallback to raw line",
                    line_index=line.line_index,
                )
            )
            review_reasons.append("missing_candidates")
            review_tags.append("missing_candidates")
        line_text = " ".join(part for part in (line.raw_line, line.note_raw) if part)
        mod_tokens = _rule_mods_from_line(line_text=line_text, allowed_mods=allowed_mods)
        mods = [
            Mod(mod_raw=token, mod_name=token, confidence=0.35, needs_review=force_review)
            for token in mod_tokens
        ]
        items.append(
            NormalizedItem(
                line_index=line.line_index,
                raw_line=line.raw_line,
                name_raw=line.name_raw,
                qty=line.qty,
                name_normalized=selected.candidate_name if selected else line.name_raw,
                item_code=selected.candidate_code if selected else None,
                note_raw=line.note_raw,
                mods=mods,
                confidence_item=0.0,
                confidence_mods=0.0,
                needs_review=True if force_review else line.needs_review,
                metadata={
                    "selection_source": "fallback_first_candidate",
                    "review_reasons": _unique_tokens(review_reasons),
                    "review_tags": _unique_tokens(review_tags),
                },
            )
        )
    return items


def _sanitize_llm_items(
    order_raw: OrderRawParsed,
    candidates: CandidatesByLine,
    allowed_mods: Sequence[str],
    item_lookup: Mapping[int, Mapping[str, CandidateItem]],
    llm_items: Any,
    *,
    audit_events: list[AuditEvent],
) -> list[NormalizedItem]:
    reference_set = {mod for mod in allowed_mods}
    by_line: dict[int, Mapping[str, Any]] = {}
    if llm_items is not None and not isinstance(llm_items, list):
        audit_events.append(
            _audit(
                "invalid_items_payload",
                "LLM items payload is not a list",
                tags=["policy_violation", "review_queue"],
            )
        )
    if isinstance(llm_items, list):
        for raw in llm_items:
            if not isinstance(raw, Mapping):
                continue
            line_index = raw.get("line_index")
            if isinstance(line_index, int):
                by_line[line_index] = raw

    items: list[NormalizedItem] = []
    for line in order_raw.lines:
        line_output = by_line.get(line.line_index, {})
        line_reasons: list[str] = []
        line_tags: list[str] = []
        missing_line_output = line.line_index not in by_line
        if missing_line_output:
            audit_events.append(
                _audit(
                    "missing_line_item_decision",
                    "LLM did not provide item decision for this line",
                    line_index=line.line_index,
                    tags=["review_queue"],
                )
            )
            line_reasons.append("missing_line_item_decision")
            line_tags.append("missing_line_item_decision")
        line_candidates = candidates.get(line.line_index, [])
        first_candidate = line_candidates[0] if line_candidates else None
        line_lookup = item_lookup.get(line.line_index, {})
        selected_id = line_output.get("item_id")
        missing_item_id = not isinstance(selected_id, str) or not selected_id.strip()
        if missing_item_id:
            audit_events.append(
                _audit(
                    "missing_item_id",
                    "LLM response missing item_id; fallback to first candidate",
                    line_index=line.line_index,
                    tags=["review_queue"],
                )
            )
            line_reasons.append("item_id_missing")
            line_tags.append("item_id_missing")
            selected_id = None
        selected_candidate = line_lookup.get(selected_id) if isinstance(selected_id, str) else None
        invalid_item_id = False
        if selected_candidate is None:
            selected_candidate = first_candidate
            if selected_id is not None:
                invalid_item_id = True
                audit_events.append(
                    _audit(
                        "item_id_out_of_candidates",
                        "LLM selected item_id not in candidates for this line",
                        line_index=line.line_index,
                        metadata={"item_id": str(selected_id)},
                        tags=["policy_violation", "review_queue"],
                    )
                )
                line_reasons.append("item_id_out_of_scope")
                line_tags.append("item_id_out_of_scope")
        if selected_candidate is None:
            line_reasons.append("missing_candidates")
            line_tags.append("missing_candidates")

        line_text = " ".join(part for part in (line.raw_line, line.note_raw) if part)
        raw_mods = line_output.get("mods")
        invalid_mods_payload = raw_mods is not None and not isinstance(raw_mods, list)
        if invalid_mods_payload:
            audit_events.append(
                _audit(
                    "invalid_mods_payload",
                    "LLM mods payload is not a list; fallback to rule mods",
                    line_index=line.line_index,
                    tags=["policy_violation", "review_queue"],
                )
            )
            line_reasons.append("mods_payload_invalid")
            line_tags.append("mods_payload_invalid")
        requested_mods = _extract_mod_tokens(raw_mods)
        if not requested_mods:
            requested_mods = _rule_mods_from_line(line_text=line_text, allowed_mods=allowed_mods)
        filtered = _unique_tokens(requested_mods)
        beyond_reference = [token for token in filtered if token not in reference_set]
        if beyond_reference:
            audit_events.append(
                _audit(
                    "mods_beyond_reference",
                    "LLM returned mods beyond reference list (accepted)",
                    line_index=line.line_index,
                    metadata={"beyond_reference_mods": beyond_reference},
                )
            )
        confidence_mods = _safe_confidence(line_output.get("confidence_mods"), default=0.65)
        mods = [
            Mod(
                mod_raw=token,
                mod_name=token,
                confidence=confidence_mods,
                needs_review=False,
            )
            for token in filtered
        ]
        line_needs_review = (
            line.needs_review
            or invalid_item_id
            or _safe_bool(line_output.get("needs_review"), default=False)
            or selected_candidate is None
            or missing_line_output
            or missing_item_id
            or invalid_mods_payload
        )
        if line.needs_review:
            line_reasons.append("raw_line_needs_review")
            line_tags.append("raw_line_needs_review")
        if _safe_bool(line_output.get("needs_review"), default=False):
            line_reasons.append("llm_flagged_review")
            line_tags.append("llm_flagged_review")
        items.append(
            NormalizedItem(
                line_index=line.line_index,
                raw_line=line.raw_line,
                name_raw=line.name_raw,
                qty=line.qty,
                name_normalized=selected_candidate.candidate_name if selected_candidate else line.name_raw,
                item_code=selected_candidate.candidate_code if selected_candidate else None,
                note_raw=line.note_raw,
                mods=mods,
                confidence_item=_safe_confidence(line_output.get("confidence_item"), default=0.65),
                confidence_mods=confidence_mods,
                needs_review=line_needs_review,
                metadata={
                    "selected_item_id": selected_id if isinstance(selected_id, str) else None,
                    "selection_source": "llm",
                    "invalid_item_id": invalid_item_id,
                    "review_reasons": _unique_tokens(line_reasons),
                    "review_tags": _unique_tokens(line_tags),
                },
            )
        )
    return items


def _sanitize_llm_groups(
    raw_groups: Any,
    *,
    valid_line_indices: set[int],
    audit_events: list[AuditEvent],
) -> list[GroupResult]:
    if raw_groups is None:
        return []
    if not isinstance(raw_groups, list):
        audit_events.append(
            _audit(
                "invalid_groups_payload",
                "LLM groups payload is not a list",
                tags=["policy_violation", "review_queue"],
            )
        )
        return []
    groups: list[GroupResult] = []
    seen: set[tuple[str, tuple[int, ...]]] = set()
    for raw in raw_groups:
        if not isinstance(raw, Mapping):
            audit_events.append(
                _audit(
                    "invalid_group_entry",
                    "LLM group entry is not an object",
                    tags=["policy_violation", "review_queue"],
                )
            )
            continue
        raw_indices = raw.get("line_indices")
        if not isinstance(raw_indices, list):
            audit_events.append(
                _audit(
                    "invalid_group_line_indices_payload",
                    "LLM group line_indices must be a list",
                    tags=["policy_violation", "review_queue"],
                )
            )
            continue
        invalid_indices = [idx for idx in raw_indices if not isinstance(idx, int) or idx not in valid_line_indices]
        if invalid_indices:
            audit_events.append(
                _audit(
                    "group_line_indices_out_of_scope",
                    "LLM group contains out-of-scope line indices",
                    metadata={"invalid_line_indices": invalid_indices},
                    tags=["policy_violation", "review_queue"],
                )
            )
        indices = sorted({idx for idx in raw_indices if isinstance(idx, int) and idx in valid_line_indices})
        if len(indices) < 2:
            audit_events.append(
                _audit(
                    "group_line_indices_insufficient",
                    "LLM group must reference at least two valid line indices",
                    metadata={"line_indices": indices},
                    tags=["policy_violation", "review_queue"],
                )
            )
            continue
        group_type = raw.get("type")
        needs_review = _safe_bool(raw.get("needs_review"), default=False)
        review_reasons: list[str] = []
        review_tags: list[str] = []
        if invalid_indices:
            needs_review = True
            review_reasons.append("group_line_indices_out_of_scope")
            review_tags.append("group_line_indices_out_of_scope")
        if group_type not in _VALID_GROUP_TYPES:
            audit_events.append(
                _audit(
                    "group_type_out_of_allowed",
                    "LLM group type is outside allowed set",
                    metadata={"group_type": group_type},
                    tags=["policy_violation", "review_queue"],
                )
            )
            group_type = "other"
            needs_review = True
            review_reasons.append("group_type_out_of_scope")
            review_tags.append("group_type_out_of_scope")
        if _safe_bool(raw.get("needs_review"), default=False):
            review_reasons.append("llm_flagged_review")
            review_tags.append("llm_flagged_review")
        key = (str(group_type), tuple(indices))
        if key in seen:
            audit_events.append(
                _audit(
                    "duplicate_group",
                    "Duplicate group by type and line indices was dropped",
                    metadata={"group_type": group_type, "line_indices": indices},
                    tags=["review_queue"],
                )
            )
            continue
        seen.add(key)
        metadata = {
            "source": "llm",
            "review_reasons": _unique_tokens(review_reasons),
            "review_tags": _unique_tokens(review_tags),
        }
        groups.append(
            GroupResult(
                group_id=str(raw.get("group_id") or f"G{len(groups) + 1}"),
                type=str(group_type),
                label=str(raw.get("label") or "llm_group"),
                line_indices=indices,
                confidence_group=_safe_confidence(raw.get("confidence_group"), default=0.7),
                needs_review=needs_review,
                metadata=metadata,
            )
        )
    if raw_groups and not groups:
        audit_events.append(_audit("invalid_groups", "LLM returned groups but none were valid", tags=["review_queue"]))
    return groups


def llm_normalize_and_group(
    order_raw: OrderRawParsed,
    candidates: CandidatesByLine,
    allowed_mods: AllowedMods,
    *,
    llm_client: Any | None = None,
    timeout_s: float = 15.0,
    prompt_path: str | Path | None = None,
) -> StructuredResult:
    normalized_allowed_mods = [mod.strip() for mod in allowed_mods if isinstance(mod, str) and mod.strip()]
    step1_hints = _build_step1_group_hints(order_raw)
    item_lookup, line_payload = _build_candidate_context(order_raw=order_raw, candidates=candidates, hints=step1_hints)
    audit_events: list[AuditEvent] = []

    parsed_response: Mapping[str, Any] | None = None
    fallback_reason: str | None = None
    llm_attempts = 0
    if llm_client is None:
        fallback_reason = "llm_client_missing"
        audit_events.append(
            _audit(
                "llm_client_missing",
                "No LLM client provided; fallback applied",
                tags=["review_queue"],
            )
        )
    else:
        try:
            template = _load_prompt_template(prompt_path=prompt_path)
            prompt = _render_prompt(
                template=template,
                allowed_mods=normalized_allowed_mods,
                line_payload=line_payload,
                step1_hints=step1_hints,
            )
        except Exception as exc:
            fallback_reason = "prompt_load_error"
            audit_events.append(
                _audit(
                    "prompt_load_error",
                    "Prompt template could not be loaded",
                    metadata={"error": str(exc)},
                )
            )
            prompt = ""
        if fallback_reason is None:
            for attempt in range(2):
                llm_attempts = attempt + 1
                try:
                    raw = _invoke_llm(llm_client=llm_client, prompt=prompt, timeout_s=timeout_s)
                except TimeoutError as exc:
                    fallback_reason = "llm_timeout"
                    audit_events.append(
                        _audit(
                            "llm_timeout",
                            "LLM request timed out",
                            metadata={"error": str(exc), "error_type": exc.__class__.__name__},
                        )
                    )
                    break
                except Exception as exc:
                    if _is_timeout_like_error(exc):
                        fallback_reason = "llm_timeout"
                        audit_events.append(
                            _audit(
                                "llm_timeout",
                                "LLM request timed out",
                                metadata={"error": str(exc), "error_type": exc.__class__.__name__},
                            )
                        )
                    else:
                        fallback_reason = "llm_api_error"
                        audit_events.append(
                            _audit(
                                "llm_api_error",
                                "LLM call failed",
                                metadata={"error": str(exc), "error_type": exc.__class__.__name__},
                            )
                        )
                    break
                try:
                    parsed_response = _extract_json_payload(raw)
                    break
                except Exception as exc:
                    if attempt == 0:
                        audit_events.append(
                            _audit(
                                "llm_json_parse_retry",
                                "First LLM JSON parse failed; retry once",
                                metadata={"error": str(exc)},
                            )
                        )
                        continue
                    fallback_reason = "llm_json_parse_error"
                    audit_events.append(
                        _audit(
                            "llm_json_parse_error",
                            "Failed to parse LLM JSON after one retry",
                            metadata={"error": str(exc)},
                        )
                    )

    if parsed_response is None:
        items = _build_fallback_items(
            order_raw=order_raw,
            candidates=candidates,
            allowed_mods=normalized_allowed_mods,
            force_review=True,
            fallback_reason=fallback_reason,
            audit_events=audit_events,
        )
        groups = _build_rule_groups(step1_hints, mark_review=True, source="fallback_rule")
    else:
        items = _sanitize_llm_items(
            order_raw=order_raw,
            candidates=candidates,
            allowed_mods=normalized_allowed_mods,
            item_lookup=item_lookup,
            llm_items=parsed_response.get("items"),
            audit_events=audit_events,
        )
        groups = _sanitize_llm_groups(
            raw_groups=parsed_response.get("groups"),
            valid_line_indices={line.line_index for line in order_raw.lines},
            audit_events=audit_events,
        )
        if step1_hints:
            rule_backstop = _build_rule_groups(step1_hints, mark_review=True, source="rule_backstop")
            known = {(group.type, tuple(group.line_indices)) for group in groups}
            for group in rule_backstop:
                key = (group.type, tuple(group.line_indices))
                if key not in known:
                    groups.append(group)
                    known.add(key)

    metadata = {
        "llm_attempts": llm_attempts,
        "fallback_reason": fallback_reason,
        "step1_hint_count": len(step1_hints),
        "review_queue": _collect_review_queue_metadata(
            items=items,
            groups=groups,
            audit_events=audit_events,
            fallback_reason=fallback_reason,
        ),
    }
    return {
        "items": items,
        "groups": groups,
        "audit_events": audit_events,
        "metadata": metadata,
        "version": CONTRACT_VERSION,
    }


__all__ = ["llm_normalize_and_group"]
