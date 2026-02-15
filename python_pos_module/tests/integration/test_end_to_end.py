from __future__ import annotations

import dataclasses
import json
import os
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))
REPO_ROOT = PROJECT_ROOT.parent

from pos_norm.candidates import generate_candidates  # noqa: E402
from pos_norm.merge_validate import merge_and_validate  # noqa: E402
from pos_norm.parser import parse_receipt_text  # noqa: E402


def _dispatch_route(order: object) -> dict[str, object]:
    dispatcher_path = REPO_ROOT / "server" / "services" / "order_dispatch" / "dispatcher.mjs"
    payload = dataclasses.asdict(order) if dataclasses.is_dataclass(order) else order
    script = """
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.env.DISPATCHER_PATH).href);
const payload = JSON.parse(process.env.ORDER_JSON);
const decision = mod.classifyOrderDispatch(payload);
process.stdout.write(JSON.stringify(decision));
""".strip()
    env = dict(os.environ)
    env["DISPATCHER_PATH"] = str(dispatcher_path)
    env["ORDER_JSON"] = json.dumps(payload, ensure_ascii=False)
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return json.loads(completed.stdout)


def test_end_to_end_with_list_catalog_and_llm_fallback_goes_review_queue() -> None:
    fixture_path = PROJECT_ROOT / "fixtures" / "menu_catalog.json"
    menu_catalog_list = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(menu_catalog_list, list)
    assert menu_catalog_list and isinstance(menu_catalog_list[0], dict)

    source_text = "\n".join(
        [
            "招牌鍋貼 x2",
            "酸辣湯 x1",
        ]
    )
    order_raw = parse_receipt_text(source_text)
    candidates = generate_candidates(order_raw.lines, menu_catalog_list, top_k=3)
    structured_result = {
        "items": [{"line_index": order_raw.lines[0].line_index}],
        "groups": [],
        "audit_events": [],
        "metadata": {"source": "integration_simulated_fallback"},
        "version": "1.0.0",
    }

    merged = merge_and_validate(
        order_raw,
        candidates,
        structured_result,  # type: ignore[arg-type]
        menu_catalog=menu_catalog_list,  # type: ignore[arg-type]
        allowed_mods=["加辣", "去冰"],
    )

    valid_ids = {str(row.get("item_id")) for row in menu_catalog_list if isinstance(row, dict)}
    assert merged.items
    assert merged.items[0].item_code is not None
    assert merged.items[0].item_code in valid_ids
    assert merged.overall_needs_review is True
    decision = _dispatch_route(merged)
    assert decision["route"] == "review-queue"
    assert decision["shouldAutoDispatch"] is False


def test_end_to_end_high_confidence_can_auto_dispatch() -> None:
    fixture_path = PROJECT_ROOT / "fixtures" / "menu_catalog.json"
    menu_catalog_list = json.loads(fixture_path.read_text(encoding="utf-8"))
    order_raw = parse_receipt_text("招牌鍋貼 x1\n酸辣湯 x1")
    candidates = generate_candidates(order_raw.lines, menu_catalog_list, top_k=3)

    structured_result = {
        "items": [
            {
                "line_index": line.line_index,
                "item_code": candidates[line.line_index][0].candidate_code,
                "name_normalized": candidates[line.line_index][0].candidate_name,
                "qty": line.qty,
                "mods": [],
                "confidence_item": 0.99,
                "confidence_mods": 0.99,
                "needs_review": False,
            }
            for line in order_raw.lines
        ],
        "groups": [],
        "audit_events": [],
        "metadata": {"source": "integration_high_confidence"},
        "version": "1.0.0",
    }
    merged = merge_and_validate(
        order_raw,
        candidates,
        structured_result,  # type: ignore[arg-type]
        menu_catalog=menu_catalog_list,  # type: ignore[arg-type]
        allowed_mods=["加辣", "去冰"],
    )

    decision = _dispatch_route(merged)
    assert merged.overall_needs_review is False
    assert decision["route"] == "auto-dispatch"
    assert decision["shouldAutoDispatch"] is True
