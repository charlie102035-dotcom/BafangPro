from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _read_source_text(args: argparse.Namespace) -> str:
    if args.source_text:
        return str(args.source_text)
    if args.from_file:
        payload = Path(args.from_file).read_text(encoding="utf-8")
        if not payload.strip():
            raise ValueError("input file is empty")
        return payload

    print("Paste dirty POS text, then type __END__ on a new line.", flush=True)
    lines: list[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == "__END__":
            break
        lines.append(line)
    text = "\n".join(lines).strip()
    if not text:
        raise ValueError("no source text provided")
    return text


def _parse_metadata_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("--metadata-json must be a JSON object")
    return value


def _post_json(url: str, payload: dict[str, Any], timeout_s: float) -> tuple[int, dict[str, Any]]:
    request = Request(
        url=url,
        method="POST",
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    )
    try:
        with urlopen(request, timeout=timeout_s) as response:
            raw = response.read().decode("utf-8")
            status_code = int(response.status)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error: {exc}") from exc

    parsed = json.loads(raw) if raw.strip() else {}
    if not isinstance(parsed, dict):
        raise RuntimeError("API response is not a JSON object")
    return status_code, parsed


def _print_summary(response: dict[str, Any]) -> None:
    order_payload = response.get("order_payload")
    order_payload = order_payload if isinstance(order_payload, dict) else {}
    order = order_payload.get("order")
    order = order if isinstance(order, dict) else {}
    metadata = order.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    python_error = metadata.get("python_error")
    python_error = python_error if isinstance(python_error, dict) else {}

    print("\n=== Ingest Result ===")
    print(f"accepted: {response.get('accepted')}")
    print(f"status: {response.get('status')}")
    print(f"order_id: {order.get('order_id')}")
    print(f"trace_id: {response.get('trace_id')}")
    print(f"overall_needs_review: {order.get('overall_needs_review')}")
    print(f"items: {len(order.get('items') or [])}")
    print(f"groups: {len(order.get('groups') or [])}")
    print(f"ingest_engine: {metadata.get('ingest_engine')}")
    fallback_reason = metadata.get("fallback_reason") or python_error.get("code")
    if fallback_reason:
        print(f"fallback_reason: {fallback_reason}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Send dirty POS text to store-scoped ingest API.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8787", help="API base url")
    parser.add_argument("--store-id", default="store-songren", help="store id, e.g. store-songren")
    parser.add_argument("--source-text", default=None, help="source text inline")
    parser.add_argument("--from-file", default=None, help="read source text from file")
    parser.add_argument("--metadata-json", default=None, help="extra metadata JSON object")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout seconds")
    parser.add_argument(
        "--simulate-timeout",
        action="store_true",
        help="ask backend to simulate llm timeout",
    )
    parser.add_argument(
        "--raw-response",
        action="store_true",
        help="print full response JSON",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        source_text = _read_source_text(args)
        extra_metadata = _parse_metadata_json(args.metadata_json)
    except Exception as exc:
        print(f"[input-error] {exc}", file=sys.stderr)
        return 2

    endpoint = f"/api/orders/stores/{args.store_id.strip()}/ingest-pos-text"
    url = f"{args.base_url.rstrip('/')}{endpoint}"
    metadata: dict[str, Any] = {
        "source": "local_dirty_sender",
        "sent_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    metadata.update(extra_metadata)
    payload: dict[str, Any] = {
        "api_version": "1.1.0",
        "source_text": source_text,
        "metadata": metadata,
    }
    if args.simulate_timeout:
        payload["simulate"] = {"llm_timeout": True}

    print(f"POST {url}", flush=True)
    try:
        status_code, response = _post_json(url=url, payload=payload, timeout_s=max(1.0, float(args.timeout)))
    except Exception as exc:
        print(f"[request-error] {exc}", file=sys.stderr)
        return 1

    print(f"http_status: {status_code}")
    _print_summary(response)
    if args.raw_response:
        print("\n=== Raw JSON ===")
        print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

