from __future__ import annotations

from typing import Any, Mapping, Sequence

from .contracts import (
    CONTRACT_VERSION,
    AllowedMods,
    AuditEvent,
    CandidateItem,
    CandidatesByLine,
    GroupResult,
    MenuCatalog,
    Mod,
    NormalizedItem,
    OrderNormalized,
    OrderRawParsed,
    RawLine,
    StructuredResult,
)

_DEFAULT_THRESHOLD = 0.85
_VALID_GROUP_TYPES = {"pack_together", "separate", "other"}
_ROUTE_AUTO_DISPATCH = "auto-dispatch"
_ROUTE_REVIEW_QUEUE = "review-queue"


def _read(source: Any, key: str, default: Any = None) -> Any:
    if isinstance(source, Mapping):
        return source.get(key, default)
    return getattr(source, key, default)


def _as_dict(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    return {str(k): v for k, v in value.items()}


def _copy_raw_line(line: RawLine) -> RawLine:
    return RawLine(
        line_index=line.line_index,
        raw_line=line.raw_line,
        name_raw=line.name_raw,
        qty=line.qty,
        note_raw=line.note_raw,
        needs_review=line.needs_review,
        metadata=dict(line.metadata),
        version=line.version,
    )


def _copy_audit_events(raw_events: Any) -> list[AuditEvent]:
    if not isinstance(raw_events, list):
        return []
    events: list[AuditEvent] = []
    for raw in raw_events:
        event_type = _read(raw, "event_type", "")
        message = _read(raw, "message", "")
        if not isinstance(event_type, str) or not event_type.strip():
            event_type = "merge_validate_info"
        if not isinstance(message, str) or not message.strip():
            message = "merge_validate_event"
        line_index = _read(raw, "line_index", None)
        item_index = _read(raw, "item_index", None)
        events.append(
            AuditEvent(
                event_type=event_type,
                message=message,
                line_index=line_index if isinstance(line_index, int) else None,
                item_index=item_index if isinstance(item_index, int) else None,
                metadata=_as_dict(_read(raw, "metadata", {})),
                version=str(_read(raw, "version", CONTRACT_VERSION)),
            )
        )
    return events


def _audit(
    event_type: str,
    message: str,
    *,
    line_index: int | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> AuditEvent:
    return AuditEvent(
        event_type=event_type,
        message=message,
        line_index=line_index,
        metadata=dict(metadata or {}),
    )


def _normalize_threshold(value: float | int | None) -> float:
    if value is None:
        return _DEFAULT_THRESHOLD
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return _DEFAULT_THRESHOLD
    if parsed < 0:
        return 0.0
    if parsed > 1:
        return 1.0
    return parsed


def _normalize_confidence(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    if parsed <= 1:
        return parsed
    if parsed <= 100:
        return parsed / 100.0
    return None


def _catalog_ids(menu_catalog: MenuCatalog | None, candidates: CandidatesByLine) -> set[str]:
    ids: set[str] = set()
    if isinstance(menu_catalog, Mapping):
        return {str(item_id).strip() for item_id in menu_catalog.keys() if str(item_id).strip()}

    if isinstance(menu_catalog, Sequence) and not isinstance(menu_catalog, (str, bytes, bytearray)):
        for entry in menu_catalog:
            if not isinstance(entry, Mapping):
                continue
            raw_item_id = entry.get("item_id")
            if raw_item_id is None:
                raw_item_id = entry.get("item_code")
            if raw_item_id is None:
                continue
            item_id = str(raw_item_id).strip()
            if item_id:
                ids.add(item_id)
        if ids:
            return ids

    for line_candidates in candidates.values():
        for candidate in line_candidates:
            if candidate.candidate_code:
                ids.add(str(candidate.candidate_code))
    return ids


def _find_candidate_by_code(
    line_candidates: Sequence[CandidateItem],
    item_code: str | None,
) -> CandidateItem | None:
    if not item_code:
        return None
    for candidate in line_candidates:
        if candidate.candidate_code == item_code:
            return candidate
    return None


def _normalize_mod(raw_mod: Any, default_confidence: float | None) -> Mod | None:
    if isinstance(raw_mod, str):
        token = raw_mod.strip()
        if not token:
            return None
        return Mod(mod_raw=token, mod_name=token, confidence=default_confidence)

    token = _read(raw_mod, "mod_raw", None)
    if not isinstance(token, str) or not token.strip():
        token = _read(raw_mod, "mod_name", None)
    if not isinstance(token, str) or not token.strip():
        token = _read(raw_mod, "mod_value", None)
    if not isinstance(token, str) or not token.strip():
        return None

    confidence = _normalize_confidence(_read(raw_mod, "confidence", None))
    if confidence is None:
        confidence = default_confidence
    return Mod(
        mod_raw=token.strip(),
        mod_name=_read(raw_mod, "mod_name", None),
        mod_value=_read(raw_mod, "mod_value", None),
        confidence=confidence,
        needs_review=bool(_read(raw_mod, "needs_review", False)),
        metadata=_as_dict(_read(raw_mod, "metadata", {})),
        version=str(_read(raw_mod, "version", CONTRACT_VERSION)),
    )


def _collect_llm_items(
    raw_items: Any,
    *,
    valid_line_indices: set[int],
    audit_events: list[AuditEvent],
) -> dict[int, Any]:
    if not isinstance(raw_items, list):
        return {}
    by_line: dict[int, Any] = {}
    for raw in raw_items:
        line_index = _read(raw, "line_index", None)
        if not isinstance(line_index, int) or line_index not in valid_line_indices:
            audit_events.append(
                _audit(
                    "item_invalid_line_index",
                    "LLM item line_index not found in parser lines",
                    line_index=line_index if isinstance(line_index, int) else None,
                )
            )
            continue
        if line_index in by_line:
            audit_events.append(
                _audit(
                    "item_duplicate_line_index",
                    "Duplicate LLM item for the same line_index; first one is kept",
                    line_index=line_index,
                )
            )
            continue
        by_line[line_index] = raw
    return by_line


def _merge_one_item(
    line: RawLine,
    llm_item: Any | None,
    line_candidates: Sequence[CandidateItem],
    *,
    valid_catalog_ids: set[str],
    allowed_mods_set: set[str] | None,
    item_threshold: float,
    mods_threshold: float,
    audit_events: list[AuditEvent],
) -> NormalizedItem:
    needs_review = bool(line.needs_review)
    source_metadata = _as_dict(_read(llm_item, "metadata", {})) if llm_item is not None else {}
    primary_candidate = line_candidates[0] if line_candidates else None

    qty = line.qty
    if llm_item is not None:
        llm_qty = _read(llm_item, "qty", None)
        if isinstance(llm_qty, int) and not isinstance(llm_qty, bool):
            if llm_qty > 0:
                qty = llm_qty
            else:
                needs_review = True
                audit_events.append(
                    _audit(
                        "qty_invalid",
                        "LLM qty must be positive integer; raw qty is kept",
                        line_index=line.line_index,
                        metadata={"qty": llm_qty},
                    )
                )
        elif llm_qty is not None:
            needs_review = True
            audit_events.append(
                _audit(
                    "qty_invalid",
                    "LLM qty is not an integer; raw qty is kept",
                    line_index=line.line_index,
                    metadata={"qty": llm_qty},
                )
            )
    if not isinstance(qty, int) or isinstance(qty, bool) or qty <= 0:
        needs_review = True
        audit_events.append(
            _audit(
                "qty_invalid",
                "Final qty must be positive integer",
                line_index=line.line_index,
                metadata={"qty": qty},
            )
        )

    confidence_item = _normalize_confidence(_read(llm_item, "confidence_item", None)) if llm_item is not None else None
    confidence_mods = _normalize_confidence(_read(llm_item, "confidence_mods", None)) if llm_item is not None else None

    if confidence_item is None or confidence_item < item_threshold:
        needs_review = True
    if confidence_mods is None or confidence_mods < mods_threshold:
        needs_review = True

    item_code_raw = _read(llm_item, "item_code", None) if llm_item is not None else None
    if not isinstance(item_code_raw, str) or not item_code_raw.strip():
        item_code_raw = _read(llm_item, "item_id", None) if llm_item is not None else None
    item_code = item_code_raw.strip() if isinstance(item_code_raw, str) and item_code_raw.strip() else None
    item_code_is_valid = item_code is not None and item_code in valid_catalog_ids
    if item_code is not None and not item_code_is_valid:
        needs_review = True
        audit_events.append(
            _audit(
                "item_code_not_in_catalog",
                "LLM item_code not found in menu_catalog; fallback is applied",
                line_index=line.line_index,
                metadata={"item_code": item_code},
            )
        )
        item_code = None

    fallback_reason: str | None = None
    selected_candidate = _find_candidate_by_code(line_candidates, item_code) if item_code else None
    if item_code is not None and selected_candidate is None:
        needs_review = True
        fallback_reason = fallback_reason or "item_code_not_in_line_candidates"
        audit_events.append(
            _audit(
                "item_code_not_in_line_candidates",
                "LLM item_code is not in this line's candidates; fallback is applied when possible",
                line_index=line.line_index,
                metadata={"item_code": item_code},
            )
        )
        item_code = None
    if item_code is None and primary_candidate is not None:
        if primary_candidate.candidate_code and primary_candidate.candidate_code in valid_catalog_ids:
            item_code = primary_candidate.candidate_code
            selected_candidate = primary_candidate
            needs_review = True
            fallback_reason = fallback_reason or "candidate_fallback"
            audit_events.append(
                _audit(
                    "item_fallback_to_candidate",
                    "LLM item_code missing/invalid; using top candidate",
                    line_index=line.line_index,
                    metadata={"item_code": item_code},
                )
            )

    name_normalized_raw = _read(llm_item, "name_normalized", None) if llm_item is not None else None
    name_normalized = name_normalized_raw if isinstance(name_normalized_raw, str) and name_normalized_raw.strip() else None
    if name_normalized is None and selected_candidate is not None:
        name_normalized = selected_candidate.candidate_name
        if llm_item is not None:
            needs_review = True
            fallback_reason = fallback_reason or "name_from_candidate"
    if name_normalized is None:
        name_normalized = line.name_raw
        needs_review = True
        fallback_reason = fallback_reason or "name_from_raw"

    raw_mods = _read(llm_item, "mods", []) if llm_item is not None else []
    if not isinstance(raw_mods, list):
        raw_mods = []
        needs_review = True
        audit_events.append(
            _audit(
                "mods_invalid_shape",
                "LLM mods must be a list",
                line_index=line.line_index,
            )
        )
    mods: list[Mod] = []
    for raw_mod in raw_mods:
        normalized_mod = _normalize_mod(raw_mod, default_confidence=confidence_mods)
        if normalized_mod is None:
            needs_review = True
            continue
        mod_conf = normalized_mod.confidence
        mod_conf_low = mod_conf is None or mod_conf < mods_threshold
        mods.append(
            Mod(
                mod_raw=normalized_mod.mod_raw,
                mod_name=normalized_mod.mod_name,
                mod_value=normalized_mod.mod_value,
                confidence=mod_conf,
                needs_review=normalized_mod.needs_review or mod_conf_low,
                metadata=dict(normalized_mod.metadata),
                version=normalized_mod.version,
            )
        )

    llm_item_needs_review = bool(_read(llm_item, "needs_review", False)) if llm_item is not None else True
    if llm_item is None:
        needs_review = True
        fallback_reason = fallback_reason or "llm_item_missing"
        audit_events.append(
            _audit(
                "llm_item_missing",
                "No LLM item for parser line; using fallback fields",
                line_index=line.line_index,
            )
        )
    if llm_item_needs_review:
        needs_review = True

    item_metadata = dict(source_metadata)
    item_metadata.update(
        {
            "merge_source": "llm" if llm_item is not None else "fallback",
            "fallback_reason": fallback_reason,
            "catalog_valid": item_code in valid_catalog_ids if item_code else False,
        }
    )
    return NormalizedItem(
        line_index=line.line_index,
        raw_line=line.raw_line,
        name_raw=line.name_raw,
        qty=qty,
        name_normalized=name_normalized,
        item_code=item_code,
        note_raw=line.note_raw,
        mods=mods,
        group_id=_read(llm_item, "group_id", None) if llm_item is not None else None,
        confidence_item=confidence_item,
        confidence_mods=confidence_mods,
        needs_review=needs_review,
        metadata=item_metadata,
        version=str(_read(llm_item, "version", CONTRACT_VERSION)) if llm_item is not None else CONTRACT_VERSION,
    )


def _merge_groups(
    raw_groups: Any,
    *,
    valid_line_indices: set[int],
    group_threshold: float,
    audit_events: list[AuditEvent],
) -> list[GroupResult]:
    if not isinstance(raw_groups, list):
        return []

    merged: list[GroupResult] = []
    occupied: dict[int, str] = {}

    for idx, raw in enumerate(raw_groups):
        group_id_raw = _read(raw, "group_id", None)
        group_id = group_id_raw if isinstance(group_id_raw, str) and group_id_raw.strip() else f"G{idx + 1}"
        group_type_raw = _read(raw, "type", "other")
        group_type = group_type_raw if isinstance(group_type_raw, str) and group_type_raw in _VALID_GROUP_TYPES else "other"
        label_raw = _read(raw, "label", None)
        label = label_raw if isinstance(label_raw, str) and label_raw.strip() else "group"

        raw_indices_value = _read(raw, "line_indices", [])
        invalid_indices_shape = not isinstance(raw_indices_value, list)
        raw_indices = raw_indices_value if isinstance(raw_indices_value, list) else []
        seen_local: set[int] = set()
        cleaned: list[int] = []
        out_of_range_found = False
        duplicated_found = False
        for line_index in raw_indices:
            if not isinstance(line_index, int):
                out_of_range_found = True
                continue
            if line_index not in valid_line_indices:
                out_of_range_found = True
                continue
            if line_index in seen_local:
                duplicated_found = True
                continue
            seen_local.add(line_index)
            cleaned.append(line_index)

        conflict_found = False
        final_indices: list[int] = []
        for line_index in cleaned:
            if line_index in occupied:
                conflict_found = True
                continue
            occupied[line_index] = group_id
            final_indices.append(line_index)

        confidence_group = _normalize_confidence(_read(raw, "confidence_group", None))
        low_confidence = confidence_group is None or confidence_group < group_threshold
        too_few_lines = len(final_indices) < 2
        needs_review = (
            bool(_read(raw, "needs_review", False))
            or invalid_indices_shape
            or out_of_range_found
            or duplicated_found
            or conflict_found
            or too_few_lines
            or low_confidence
            or group_type != group_type_raw
        )

        if invalid_indices_shape:
            audit_events.append(
                _audit(
                    "group_line_indices_invalid_shape",
                    "Group line_indices must be a list of line index integers",
                    metadata={"group_id": group_id, "line_indices": raw_indices_value},
                )
            )
        if out_of_range_found:
            audit_events.append(
                _audit(
                    "group_line_index_out_of_range",
                    "Group contains line_indices outside parser lines",
                    metadata={"group_id": group_id, "line_indices": raw_indices},
                )
            )
        if duplicated_found:
            audit_events.append(
                _audit(
                    "group_line_index_duplicated",
                    "Group line_indices contain duplicates",
                    metadata={"group_id": group_id},
                )
            )
        if conflict_found:
            audit_events.append(
                _audit(
                    "group_line_conflict",
                    "Group conflicts with previous group; conflicting lines removed (first group wins)",
                    metadata={"group_id": group_id},
                )
            )
        if too_few_lines:
            audit_events.append(
                _audit(
                    "group_too_few_lines",
                    "Group must contain at least 2 valid line_indices",
                    metadata={"group_id": group_id, "line_indices": final_indices},
                )
            )

        merged.append(
            GroupResult(
                group_id=group_id,
                type=group_type,
                label=label,
                line_indices=final_indices,
                confidence_group=confidence_group,
                needs_review=needs_review,
                metadata={
                    "source": "llm",
                    "group_membership_rule": "single_group_per_line_first_wins",
                    **_as_dict(_read(raw, "metadata", {})),
                },
                version=str(_read(raw, "version", CONTRACT_VERSION)),
            )
        )

    return merged


def _build_dispatch_decision(
    *,
    order_raw: OrderRawParsed,
    items: Sequence[NormalizedItem],
    groups: Sequence[GroupResult],
    overall_needs_review: bool,
) -> dict[str, Any]:
    reasons: list[str] = []
    if order_raw.needs_review:
        reasons.append("order_raw_needs_review")
    if any(item.needs_review for item in items):
        reasons.append("item_needs_review")
    if any(group.needs_review for group in groups):
        reasons.append("group_needs_review")
    if any(item.item_code is None for item in items):
        reasons.append("missing_item_code")
    if any(not isinstance(item.qty, int) or item.qty <= 0 for item in items):
        reasons.append("invalid_qty")

    should_review = overall_needs_review or bool(reasons)
    route = _ROUTE_REVIEW_QUEUE if should_review else _ROUTE_AUTO_DISPATCH
    return {
        "route": route,
        "should_auto_dispatch": not should_review,
        "reasons": reasons,
    }


def merge_and_validate(
    order_raw: OrderRawParsed,
    candidates: CandidatesByLine,
    structured_result: StructuredResult,
    *,
    menu_catalog: MenuCatalog | None = None,
    allowed_mods: AllowedMods | None = None,
    item_threshold: float = _DEFAULT_THRESHOLD,
    mods_threshold: float = _DEFAULT_THRESHOLD,
    group_threshold: float = _DEFAULT_THRESHOLD,
) -> OrderNormalized:
    normalized_item_threshold = _normalize_threshold(item_threshold)
    normalized_mods_threshold = _normalize_threshold(mods_threshold)
    normalized_group_threshold = _normalize_threshold(group_threshold)

    copied_lines = [_copy_raw_line(line) for line in order_raw.lines]
    valid_line_indices = {line.line_index for line in copied_lines}
    valid_catalog_ids = _catalog_ids(menu_catalog, candidates)
    allowed_mods_set = (
        {mod.strip() for mod in allowed_mods if isinstance(mod, str) and mod.strip()}
        if allowed_mods is not None
        else None
    )

    structured_map = structured_result if isinstance(structured_result, Mapping) else {}
    audit_events = _copy_audit_events(structured_map.get("audit_events"))
    llm_items_by_line = _collect_llm_items(
        structured_map.get("items"),
        valid_line_indices=valid_line_indices,
        audit_events=audit_events,
    )

    items: list[NormalizedItem] = []
    for line in copied_lines:
        item = _merge_one_item(
            line=line,
            llm_item=llm_items_by_line.get(line.line_index),
            line_candidates=candidates.get(line.line_index, []),
            valid_catalog_ids=valid_catalog_ids,
            allowed_mods_set=allowed_mods_set,
            item_threshold=normalized_item_threshold,
            mods_threshold=normalized_mods_threshold,
            audit_events=audit_events,
        )
        items.append(item)

    groups = _merge_groups(
        structured_map.get("groups"),
        valid_line_indices=valid_line_indices,
        group_threshold=normalized_group_threshold,
        audit_events=audit_events,
    )

    overall_needs_review = order_raw.needs_review or any(item.needs_review for item in items) or any(
        group.needs_review for group in groups
    )
    dispatch_decision = _build_dispatch_decision(
        order_raw=order_raw,
        items=items,
        groups=groups,
        overall_needs_review=overall_needs_review,
    )

    merged_metadata = dict(order_raw.metadata)
    merged_metadata.update(
        {
            "structured_result_metadata": _as_dict(structured_map.get("metadata", {})),
            "thresholds": {
                "item_threshold": normalized_item_threshold,
                "mods_threshold": normalized_mods_threshold,
                "group_threshold": normalized_group_threshold,
            },
            "validation_rules": {
                "group_membership_rule": "single_group_per_line_first_wins",
                "mods_filter_mode": "open",
            },
            "dispatch_decision": dispatch_decision,
        }
    )

    confidence_values: list[float] = []
    for item in items:
        if item.confidence_item is not None:
            confidence_values.append(item.confidence_item)
        if item.confidence_mods is not None:
            confidence_values.append(item.confidence_mods)
    for group in groups:
        if group.confidence_group is not None:
            confidence_values.append(group.confidence_group)
    order_confidence = min(confidence_values) if confidence_values else None

    return OrderNormalized(
        source_text=order_raw.source_text,
        items=items,
        groups=groups,
        order_id=order_raw.order_id,
        lines=copied_lines,
        audit_events=audit_events,
        overall_needs_review=overall_needs_review,
        order_confidence=order_confidence,
        metadata=merged_metadata,
        version=CONTRACT_VERSION,
    )


__all__ = ["merge_and_validate"]
