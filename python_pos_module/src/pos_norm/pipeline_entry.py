from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any, Mapping, Sequence

from .candidates import generate_candidates
from .contracts import (
    CONTRACT_VERSION,
    AllowedMods,
    AuditEvent,
    CandidateItem,
    CandidatesByLine,
    MenuCatalog,
    NormalizedItem,
    OrderNormalized,
    OrderRawParsed,
    RawLine,
    StructuredResult,
)
from .llm_pipeline import llm_normalize_and_group
from .llm_client import build_llm_client_from_env
from .merge_validate import merge_and_validate
from .parser import parse_receipt_text


def _jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_jsonable(item) for item in value]
    return value


def _fallback_raw_lines(text: str) -> list[RawLine]:
    lines: list[RawLine] = []
    for index, raw in enumerate(text.splitlines()):
        if not raw.strip():
            continue
        lines.append(
            RawLine(
                line_index=index,
                raw_line=raw,
                name_raw=raw.strip(),
                qty=1,
                note_raw=None,
                needs_review=True,
                metadata={"fallback_reason": "parser_exception"},
            )
        )
    if lines:
        return lines
    return [
        RawLine(
            line_index=0,
            raw_line=text,
            name_raw=text.strip() or "UNKNOWN_LINE",
            qty=1,
            note_raw=None,
            needs_review=True,
            metadata={"fallback_reason": "parser_exception_empty"},
        )
    ]


def _fallback_order_raw(receipt_text: str, order_id: str | None, error: str) -> OrderRawParsed:
    return OrderRawParsed(
        source_text=receipt_text,
        lines=_fallback_raw_lines(receipt_text),
        order_id=order_id,
        parse_warnings=[f"pipeline parser fallback: {error}"],
        needs_review=True,
        metadata={"parse_errors": [error], "fallback_reason": "parser_exception"},
        version=CONTRACT_VERSION,
    )


def _fallback_candidates(order_raw: OrderRawParsed, error: str) -> CandidatesByLine:
    by_line: CandidatesByLine = {}
    for line in order_raw.lines:
        by_line[line.line_index] = [
            CandidateItem(
                line_index=line.line_index,
                raw_line=line.raw_line,
                name_raw=line.name_raw,
                qty=line.qty if isinstance(line.qty, int) and line.qty > 0 else 1,
                candidate_name=line.name_raw or "UNKNOWN_ITEM",
                candidate_code=None,
                note_raw=line.note_raw,
                confidence_item=0.0,
                needs_review=True,
                metadata={"fallback_reason": "candidates_exception", "error": error},
            )
        ]
    return by_line


def _fallback_structured(order_raw: OrderRawParsed, candidates: CandidatesByLine, error: str) -> StructuredResult:
    items: list[NormalizedItem] = []
    for line in order_raw.lines:
        line_candidates = candidates.get(line.line_index, [])
        top = line_candidates[0] if line_candidates else None
        items.append(
            NormalizedItem(
                line_index=line.line_index,
                raw_line=line.raw_line,
                name_raw=line.name_raw,
                qty=line.qty if isinstance(line.qty, int) and line.qty > 0 else 1,
                name_normalized=top.candidate_name if top else (line.name_raw or "UNKNOWN_ITEM"),
                item_code=top.candidate_code if top else None,
                note_raw=line.note_raw,
                mods=[],
                confidence_item=0.0,
                confidence_mods=0.0,
                needs_review=True,
                metadata={"fallback_reason": "structured_exception", "error": error},
            )
        )
    return {
        "items": items,
        "groups": [],
        "audit_events": [
            AuditEvent(
                event_type="pipeline_structured_fallback",
                message="Structured stage failed, fallback generated",
                metadata={"error": error},
            )
        ],
        "metadata": {"fallback_reason": "structured_exception", "error": error},
        "version": CONTRACT_VERSION,
    }


def _fallback_merged(order_raw: OrderRawParsed, structured: StructuredResult, error: str) -> OrderNormalized:
    safe_items: list[NormalizedItem] = []
    for raw in structured.get("items", []):
        if isinstance(raw, NormalizedItem):
            item = raw
        else:
            line_index = int(raw.get("line_index", 0))
            fallback_line = next((line for line in order_raw.lines if line.line_index == line_index), None)
            safe_items.append(
                NormalizedItem(
                    line_index=line_index,
                    raw_line=str(raw.get("raw_line") or (fallback_line.raw_line if fallback_line else "")),
                    name_raw=str(raw.get("name_raw") or (fallback_line.name_raw if fallback_line else "UNKNOWN_ITEM")),
                    qty=int(raw.get("qty") or (fallback_line.qty if fallback_line else 1)),
                    name_normalized=str(
                        raw.get("name_normalized") or raw.get("name_raw") or (fallback_line.name_raw if fallback_line else "UNKNOWN_ITEM")
                    ),
                    item_code=raw.get("item_code") if isinstance(raw.get("item_code"), str) else None,
                    note_raw=raw.get("note_raw") if isinstance(raw.get("note_raw"), str) else None,
                    mods=[],
                    confidence_item=0.0,
                    confidence_mods=0.0,
                    needs_review=True,
                    metadata={"fallback_reason": "merge_exception", "error": error},
                )
            )
            continue
        item.needs_review = True
        item.metadata = dict(item.metadata)
        item.metadata["fallback_reason"] = "merge_exception"
        item.metadata["error"] = error
        safe_items.append(item)

    if not safe_items:
        for line in order_raw.lines:
            safe_items.append(
                NormalizedItem(
                    line_index=line.line_index,
                    raw_line=line.raw_line,
                    name_raw=line.name_raw,
                    qty=line.qty if isinstance(line.qty, int) and line.qty > 0 else 1,
                    name_normalized=line.name_raw or "UNKNOWN_ITEM",
                    item_code=None,
                    note_raw=line.note_raw,
                    mods=[],
                    confidence_item=0.0,
                    confidence_mods=0.0,
                    needs_review=True,
                    metadata={"fallback_reason": "merge_exception", "error": error},
                )
            )

    audit_events = list(structured.get("audit_events", []))
    audit_events.append(
        AuditEvent(
            event_type="pipeline_merge_fallback",
            message="Merge stage failed, fallback generated",
            metadata={"error": error},
        )
    )
    return OrderNormalized(
        source_text=order_raw.source_text,
        items=safe_items,
        groups=[],
        order_id=order_raw.order_id,
        lines=order_raw.lines,
        audit_events=audit_events,
        overall_needs_review=True,
        metadata={"fallback_reason": "merge_exception", "error": error},
        version=CONTRACT_VERSION,
    )


def ingest_receipt(
    receipt_text: str,
    order_id: str | None,
    menu_catalog: MenuCatalog,
    allowed_mods: AllowedMods,
    *,
    llm_client: Any | None = None,
    llm_timeout_s: float | None = None,
) -> dict[str, Any]:
    stage_errors: list[str] = []
    accepted = True

    runtime_llm_client = llm_client
    llm_runtime: dict[str, Any]
    if runtime_llm_client is None:
        runtime_llm_client, llm_runtime = build_llm_client_from_env()
    else:
        llm_runtime = {
            "enabled": True,
            "provider": "injected",
            "model": "injected",
            "base_url": "injected",
            "timeout_s_default": 15.0,
            "reason": "injected_client",
        }
    timeout_value = float(llm_timeout_s) if isinstance(llm_timeout_s, (int, float)) and llm_timeout_s > 0 else float(
        llm_runtime.get("timeout_s_default", 15.0)
    )

    try:
        order_raw = parse_receipt_text(receipt_text)
        order_raw.order_id = order_id
    except Exception as exc:  # pragma: no cover - defensive branch
        accepted = False
        error = f"parse:{exc.__class__.__name__}:{exc}"
        stage_errors.append(error)
        order_raw = _fallback_order_raw(receipt_text, order_id, error)

    try:
        candidates = generate_candidates(order_raw.lines, menu_catalog)
    except Exception as exc:  # pragma: no cover - defensive branch
        accepted = False
        error = f"candidates:{exc.__class__.__name__}:{exc}"
        stage_errors.append(error)
        candidates = _fallback_candidates(order_raw, error)

    try:
        structured = llm_normalize_and_group(
            order_raw,
            candidates,
            allowed_mods,
            llm_client=runtime_llm_client,
            timeout_s=timeout_value,
        )
        structured_metadata = dict(structured.get("metadata", {}))
        structured_metadata["llm_runtime"] = llm_runtime
        structured_metadata["llm_timeout_s"] = timeout_value
        structured["metadata"] = structured_metadata
    except Exception as exc:  # pragma: no cover - defensive branch
        accepted = False
        error = f"structured:{exc.__class__.__name__}:{exc}"
        stage_errors.append(error)
        structured = _fallback_structured(order_raw, candidates, error)
        structured_metadata = dict(structured.get("metadata", {}))
        structured_metadata["llm_runtime"] = llm_runtime
        structured_metadata["llm_timeout_s"] = timeout_value
        structured["metadata"] = structured_metadata

    try:
        merged = merge_and_validate(
            order_raw,
            candidates,
            structured,
            menu_catalog=menu_catalog,
            allowed_mods=allowed_mods,
        )
    except Exception as exc:  # pragma: no cover - defensive branch
        accepted = False
        error = f"merge:{exc.__class__.__name__}:{exc}"
        stage_errors.append(error)
        merged = _fallback_merged(order_raw, structured, error)

    if stage_errors:
        merged.overall_needs_review = True
        merged.metadata = dict(merged.metadata)
        merged.metadata["pipeline_errors"] = stage_errors

    merged.metadata = dict(merged.metadata)
    merged.metadata["llm_runtime"] = llm_runtime
    merged.metadata["llm_timeout_s"] = timeout_value

    response = {
        "accepted": accepted,
        "needs_review": bool(order_raw.needs_review or merged.overall_needs_review or bool(stage_errors)),
        "errors": stage_errors,
        "order_raw": order_raw,
        "candidates": candidates,
        "structured": structured,
        "merged": merged,
        "llm_runtime": llm_runtime,
        "version": CONTRACT_VERSION,
    }
    return _jsonable(response)


__all__ = ["ingest_receipt"]
