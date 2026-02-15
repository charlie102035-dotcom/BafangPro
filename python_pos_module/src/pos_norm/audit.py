from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask_value(value: Any, *, mask_text: str = "***") -> Any:
    sensitive_keys = {
        "password",
        "token",
        "api_key",
        "authorization",
        "cookie",
        "phone",
        "mobile",
        "email",
    }

    if isinstance(value, Mapping):
        masked: dict[str, Any] = {}
        for key, inner in value.items():
            key_l = str(key).lower()
            if key_l in sensitive_keys or "token" in key_l or "secret" in key_l:
                masked[str(key)] = mask_text
            else:
                masked[str(key)] = _mask_value(inner, mask_text=mask_text)
        return masked

    if isinstance(value, list):
        return [_mask_value(item, mask_text=mask_text) for item in value]

    if isinstance(value, str):
        if "@" in value and "." in value:
            return mask_text
        if len(value) >= 16 and any(ch.isdigit() for ch in value) and any(ch.isalpha() for ch in value):
            return mask_text
        return value

    return value


@dataclass(slots=True)
class AuditEventRecord:
    order_id: str
    event_type: str
    timestamp: str = field(default_factory=_utc_now_iso)
    raw_text: str | None = None
    parse_result: Any | None = None
    candidates: Any | None = None
    llm_request: Any | None = None
    llm_response: Any | None = None
    fallback_reason: str | None = None
    final_output: Any | None = None
    human_correction: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "order_id": self.order_id,
            "event_type": self.event_type,
            "timestamp": self.timestamp,
            "raw_text": self.raw_text,
            "parse_result": self.parse_result,
            "candidates": self.candidates,
            "llm_request": self.llm_request,
            "llm_response": self.llm_response,
            "fallback_reason": self.fallback_reason,
            "final_output": self.final_output,
            "human_correction": self.human_correction,
            "metadata": self.metadata,
        }


class AuditLogger:
    def __init__(self, path: str | Path = "./audit.log.jsonl") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write_event(self, event: Mapping[str, Any] | AuditEventRecord, *, mask_sensitive: bool = True) -> dict[str, Any]:
        payload = self._to_event_payload(event)
        if mask_sensitive:
            payload = self._mask_llm_fields(payload)

        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        return payload

    def list_events(self, order_id: str) -> list[dict[str, Any]]:
        return [event for event in self._read_all() if event.get("order_id") == order_id]

    def list_by_type(self, event_type: str) -> list[dict[str, Any]]:
        return [event for event in self._read_all() if event.get("event_type") == event_type]

    def get_order_trace(self, order_id: str) -> dict[str, Any]:
        events = self.list_events(order_id)
        trace: dict[str, Any] = {
            "order_id": order_id,
            "raw_text": None,
            "parse_result": None,
            "candidates": None,
            "llm_request": None,
            "llm_response": None,
            "fallback_reason": None,
            "merge_result": None,
            "final_output": None,
            "manual_corrections": [],
            "events": events,
        }

        for event in events:
            raw_text = event.get("raw_text")
            if isinstance(raw_text, str) and raw_text.strip():
                trace["raw_text"] = raw_text

            for field in ("parse_result", "candidates", "llm_request", "llm_response", "merge_result", "final_output"):
                value = event.get(field)
                if value is not None:
                    trace[field] = value

            fallback_reason = event.get("fallback_reason")
            if isinstance(fallback_reason, str) and fallback_reason.strip():
                trace["fallback_reason"] = fallback_reason

            correction = event.get("human_correction")
            if isinstance(correction, Mapping):
                trace["manual_corrections"].append(dict(correction))

        return trace

    def list_review_queue(self, *, limit: int = 100, unresolved_only: bool = True) -> list[dict[str, Any]]:
        by_order: dict[str, list[dict[str, Any]]] = {}
        for event in self._read_all():
            order_id = event.get("order_id")
            if isinstance(order_id, str) and order_id:
                by_order.setdefault(order_id, []).append(event)

        queue: list[dict[str, Any]] = []
        for order_id, events in by_order.items():
            latest_manual_fix_index = -1
            for index, event in enumerate(events):
                correction = event.get("human_correction")
                if event.get("event_type") != "manual_correction":
                    continue
                if isinstance(correction, Mapping) and correction.get("after") is not None:
                    latest_manual_fix_index = index

            pending_events: list[dict[str, Any]] = []
            for index, event in enumerate(events):
                if not self._event_needs_review(event):
                    continue
                if unresolved_only and index <= latest_manual_fix_index:
                    continue
                pending_events.append(event)

            if not pending_events:
                continue

            latest_event = events[-1]
            latest_manual_fix = events[latest_manual_fix_index] if latest_manual_fix_index >= 0 else None
            raw_preview = None
            for event in reversed(events):
                value = event.get("raw_text")
                if isinstance(value, str) and value.strip():
                    raw_preview = value
                    break

            queue.append(
                {
                    "order_id": order_id,
                    "latest_event_type": latest_event.get("event_type"),
                    "latest_timestamp": latest_event.get("timestamp"),
                    "pending_event_types": list(dict.fromkeys(event.get("event_type") for event in pending_events if event.get("event_type"))),
                    "pending_count": len(pending_events),
                    "has_manual_correction": latest_manual_fix_index >= 0,
                    "latest_manual_correction": latest_manual_fix.get("human_correction") if latest_manual_fix else None,
                    "raw_preview": raw_preview,
                }
            )

        queue.sort(key=lambda event: str(event.get("latest_timestamp", "")), reverse=True)
        safe_limit = max(0, int(limit))
        return queue[:safe_limit]

    def _to_event_payload(self, event: Mapping[str, Any] | AuditEventRecord) -> dict[str, Any]:
        if isinstance(event, AuditEventRecord):
            payload = event.as_dict()
        else:
            payload = dict(event)

        order_id = payload.get("order_id")
        event_type = payload.get("event_type")
        if not isinstance(order_id, str) or not order_id.strip():
            raise ValueError("audit event missing required field: order_id")
        if not isinstance(event_type, str) or not event_type.strip():
            raise ValueError("audit event missing required field: event_type")

        payload.setdefault("timestamp", _utc_now_iso())
        payload.setdefault("raw_text", None)
        payload.setdefault("parse_result", None)
        payload.setdefault("candidates", None)
        payload.setdefault("llm_request", None)
        payload.setdefault("llm_response", None)
        payload.setdefault("fallback_reason", None)
        payload.setdefault("merge_result", None)
        payload.setdefault("final_output", None)
        payload.setdefault("human_correction", None)
        payload.setdefault("metadata", {})
        payload.setdefault("needs_review", False)

        payload["human_correction"] = self._normalize_human_correction(payload)

        return payload

    def _event_needs_review(self, event: Mapping[str, Any]) -> bool:
        if event.get("needs_review") is True:
            return True

        metadata = event.get("metadata")
        if isinstance(metadata, Mapping) and metadata.get("needs_review") is True:
            return True

        fallback_reason = event.get("fallback_reason")
        if isinstance(fallback_reason, str) and fallback_reason.strip():
            return True

        for field in ("merge_result", "final_output"):
            value = event.get(field)
            if isinstance(value, Mapping):
                if value.get("overall_needs_review") is True or value.get("needs_review") is True:
                    return True

        return False

    def _normalize_human_correction(self, payload: Mapping[str, Any]) -> dict[str, Any] | None:
        correction = payload.get("human_correction")
        legacy_before = payload.get("before")
        legacy_after = payload.get("after")
        legacy_operator = payload.get("operator")
        legacy_timestamp = payload.get("correction_timestamp")

        if correction is None and any(value is not None for value in (legacy_before, legacy_after, legacy_operator, legacy_timestamp)):
            correction = {
                "before": legacy_before,
                "after": legacy_after,
                "operator": legacy_operator,
                "timestamp": legacy_timestamp,
            }

        if correction is None:
            return None
        if not isinstance(correction, Mapping):
            raise ValueError("human_correction must be an object")

        correction_payload = dict(correction)
        if correction_payload.get("before") is None:
            correction_payload["before"] = legacy_before
        if correction_payload.get("after") is None:
            correction_payload["after"] = legacy_after

        operator_value = correction_payload.get("operator")
        if not isinstance(operator_value, str) or not operator_value.strip():
            correction_payload["operator"] = "unknown"
        else:
            correction_payload["operator"] = operator_value.strip()

        timestamp_value = correction_payload.get("timestamp")
        if not isinstance(timestamp_value, str) or not timestamp_value.strip():
            correction_payload["timestamp"] = _utc_now_iso()

        return correction_payload

    def _mask_llm_fields(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        masked = dict(payload)
        masked["llm_request"] = _mask_value(masked.get("llm_request"))
        masked["llm_response"] = _mask_value(masked.get("llm_response"))
        return masked

    def _read_all(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []

        events: list[dict[str, Any]] = []
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    events.append(parsed)
        return events


def write_event(
    event: Mapping[str, Any] | AuditEventRecord,
    *,
    path: str | Path = "./audit.log.jsonl",
    mask_sensitive: bool = True,
) -> dict[str, Any]:
    return AuditLogger(path).write_event(event, mask_sensitive=mask_sensitive)


def list_events(order_id: str, *, path: str | Path = "./audit.log.jsonl") -> list[dict[str, Any]]:
    return AuditLogger(path).list_events(order_id)


def list_by_type(event_type: str, *, path: str | Path = "./audit.log.jsonl") -> list[dict[str, Any]]:
    return AuditLogger(path).list_by_type(event_type)


def get_order_trace(order_id: str, *, path: str | Path = "./audit.log.jsonl") -> dict[str, Any]:
    return AuditLogger(path).get_order_trace(order_id)


def list_review_queue(
    *,
    path: str | Path = "./audit.log.jsonl",
    limit: int = 100,
    unresolved_only: bool = True,
) -> list[dict[str, Any]]:
    return AuditLogger(path).list_review_queue(limit=limit, unresolved_only=unresolved_only)


__all__ = [
    "AuditEventRecord",
    "AuditLogger",
    "get_order_trace",
    "list_by_type",
    "list_events",
    "list_review_queue",
    "write_event",
]
