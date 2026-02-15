from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.contracts import (  # noqa: E402
    API_CONTRACT_VERSION,
    CONTRACT_VERSION,
    AuditEvent,
    GroupResult,
    Mod,
    NormalizedItem,
    OrderNormalized,
    RawLine,
)


SCHEMA_PATH = PROJECT_ROOT.parent / "server" / "services" / "pos_pipeline" / "schema.mjs"


def _node_validate(fn_name: str, payload: dict) -> dict:
    script = f"""
import * as schema from {json.dumps(str(SCHEMA_PATH))};
const payload = JSON.parse(process.env.PAYLOAD_JSON || "{{}}")
const fn = schema[{json.dumps(fn_name)}];
if (typeof fn !== 'function') {{
  console.error(JSON.stringify({{ ok: false, errors: ['missing validator'] }}));
  process.exit(0);
}}
console.log(JSON.stringify(fn(payload)));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "PAYLOAD_JSON": json.dumps(payload, ensure_ascii=False)},
    )
    return json.loads(result.stdout.strip())


def _build_order() -> OrderNormalized:
    return OrderNormalized(
        source_text="招牌鍋貼 x2\\n酸辣湯 x1",
        items=[
            NormalizedItem(
                line_index=0,
                raw_line="招牌鍋貼 x2",
                name_raw="招牌鍋貼",
                qty=2,
                name_normalized="招牌鍋貼",
                item_code="I001",
                note_raw=None,
                mods=[Mod(mod_raw="加辣", mod_name="加辣", confidence=0.9, needs_review=False)],
                group_id="G1",
                confidence_item=0.95,
                confidence_mods=0.9,
                needs_review=False,
                metadata={},
                version=CONTRACT_VERSION,
            ),
            NormalizedItem(
                line_index=1,
                raw_line="酸辣湯 x1",
                name_raw="酸辣湯",
                qty=1,
                name_normalized="酸辣湯",
                item_code="I007",
                note_raw=None,
                mods=[],
                group_id="G1",
                confidence_item=0.88,
                confidence_mods=0.88,
                needs_review=True,
                metadata={},
                version=CONTRACT_VERSION,
            ),
        ],
        groups=[
            GroupResult(
                group_id="G1",
                type="pack_together",
                label="同袋",
                line_indices=[0, 1],
                confidence_group=0.82,
                needs_review=True,
                metadata={},
                version=CONTRACT_VERSION,
            )
        ],
        order_id="ORD-1001",
        lines=[
            RawLine(line_index=0, raw_line="招牌鍋貼 x2", name_raw="招牌鍋貼", qty=2),
            RawLine(line_index=1, raw_line="酸辣湯 x1", name_raw="酸辣湯", qty=1),
        ],
        audit_events=[
            AuditEvent(event_type="normalized", message="ok", line_index=0, metadata={}, version=CONTRACT_VERSION)
        ],
        overall_needs_review=True,
        metadata={},
        version=CONTRACT_VERSION,
    )


def _build_order_payload() -> dict:
    order = _build_order()
    return {
        "order": asdict(order),
        "review_summary": {
            "overall_needs_review": True,
            "needs_review_item_line_indices": [1],
            "needs_review_group_ids": ["G1"],
        },
        "review_queue_status": "pending_review",
        "audit_trace_id": "trace-001",
        "metadata": {},
        "version": CONTRACT_VERSION,
    }


def test_ingest_request_response_contract_and_backward_compatible_fields() -> None:
    ingest_request = {
        "source_text": "招牌鍋貼 x2",
        "api_version": API_CONTRACT_VERSION,
        "order_id": "ORD-INGEST-1",
        "audit_trace_id": "trace-001",
        "metadata": {},
        "text": "招牌鍋貼 x2",
    }
    req_result = _node_validate("validateIngestRequest", ingest_request)
    assert req_result["ok"] is True, req_result

    ingest_response = {
        "accepted": True,
        "version": CONTRACT_VERSION,
        "api_version": API_CONTRACT_VERSION,
        "order_payload": _build_order_payload(),
        "status": "accepted",
        "trace_id": "legacy-trace",
    }
    resp_result = _node_validate("validateIngestResponse", ingest_response)
    assert resp_result["ok"] is True, resp_result


def test_review_list_response_contract() -> None:
    review_list_response = {
        "api_version": API_CONTRACT_VERSION,
        "version": CONTRACT_VERSION,
        "items": [
            {
                "order_id": "ORD-1001",
                "audit_trace_id": "trace-001",
                "review_queue_status": "pending_review",
                "overall_needs_review": True,
                "needs_review_item_count": 1,
                "needs_review_group_count": 1,
                "created_at": "2026-02-15T00:00:00Z",
                "updated_at": "2026-02-15T00:00:10Z",
                "metadata": {},
                "version": CONTRACT_VERSION,
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
        "next_cursor": None,
    }
    result = _node_validate("validateReviewListResponse", review_list_response)
    assert result["ok"] is True, result


def test_review_decision_request_response_contract() -> None:
    review_request = {
        "order_id": "ORD-1001",
        "api_version": API_CONTRACT_VERSION,
        "audit_trace_id": "trace-001",
        "review_queue_status": "in_review",
        "decision": "approve",
        "reviewer_id": "agent-a5",
        "note": "looks good",
        "metadata": {},
    }
    req_result = _node_validate("validateReviewRequest", review_request)
    assert req_result["ok"] is True, req_result

    review_response = {
        "order_payload": _build_order_payload(),
        "decision": "approve",
        "review_queue_status": "dispatch_ready",
        "audit_trace_id": "trace-001",
        "api_version": API_CONTRACT_VERSION,
        "metadata": {},
        "version": CONTRACT_VERSION,
        "status": "approved",
    }
    resp_result = _node_validate("validateReviewResponse", review_response)
    assert resp_result["ok"] is True, resp_result
