from __future__ import annotations

import json
import os
import socket
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

try:
    import certifi
except Exception:  # pragma: no cover - optional dependency
    certifi = None


def _as_text(value: Any, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    text = value.strip()
    return text or fallback


def _as_float(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if parsed <= 0:
        return fallback
    return parsed


def _as_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    if parsed <= 0:
        return fallback
    return parsed


def _as_bool(value: Any, fallback: bool | None = None) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on", "y"}:
            return True
        if normalized in {"0", "false", "no", "off", "n"}:
            return False
    return fallback


def _is_timeout_exception(exc: Exception) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    if isinstance(exc, socket.timeout):
        return True
    message = str(exc).lower()
    return "timeout" in message or "timed out" in message or "time out" in message


def _build_ssl_context() -> ssl.SSLContext:
    # Prefer certifi CA bundle on macOS/local Python builds where system CA may be missing.
    if certifi is not None:
        cafile = certifi.where()
        if isinstance(cafile, str) and cafile.strip():
            return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()


@dataclass(slots=True)
class OpenAIChatJsonClient:
    api_key: str
    model: str
    base_url: str = "https://api.openai.com/v1"
    temperature: float = 0.0
    max_tokens: int = 900

    def complete(self, prompt: str, timeout_s: float | None = None) -> str:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "response_format": {"type": "json_object"},
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        endpoint = f"{self.base_url.rstrip('/')}/chat/completions"
        request = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        timeout_value = _as_float(timeout_s, 15.0) if timeout_s is not None else 15.0
        ssl_context = _build_ssl_context()

        try:
            with urllib.request.urlopen(request, timeout=timeout_value, context=ssl_context) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            try:
                error_payload = json.loads(exc.read().decode("utf-8"))
            except Exception:  # pragma: no cover - best-effort diagnostics
                error_payload = None
            message = "openai chat completion failed"
            if isinstance(error_payload, Mapping):
                error_obj = error_payload.get("error")
                if isinstance(error_obj, Mapping):
                    detail = _as_text(error_obj.get("message"))
                    if detail:
                        message = detail
            raise RuntimeError(f"OpenAI HTTP {exc.code}: {message}") from exc
        except urllib.error.URLError as exc:
            reason = exc.reason if hasattr(exc, "reason") else exc
            if isinstance(reason, Exception) and _is_timeout_exception(reason):
                raise TimeoutError("OpenAI request timeout") from exc
            if _is_timeout_exception(exc):
                raise TimeoutError("OpenAI request timeout") from exc
            raise RuntimeError(f"OpenAI request failed: {exc}") from exc
        except Exception as exc:
            if _is_timeout_exception(exc):
                raise TimeoutError("OpenAI request timeout") from exc
            raise RuntimeError(f"OpenAI request failed: {exc}") from exc

        parsed = json.loads(raw)
        if not isinstance(parsed, Mapping):
            raise RuntimeError("OpenAI response must be a JSON object")
        choices = parsed.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError("OpenAI response missing choices")
        first = choices[0]
        if not isinstance(first, Mapping):
            raise RuntimeError("OpenAI response choice format invalid")
        message_obj = first.get("message")
        if not isinstance(message_obj, Mapping):
            raise RuntimeError("OpenAI response missing message")
        content = message_obj.get("content")
        if isinstance(content, str):
            text = content.strip()
            if text:
                return text
        if isinstance(content, list):
            chunks: list[str] = []
            for part in content:
                if isinstance(part, Mapping):
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        chunks.append(text.strip())
            if chunks:
                return "\n".join(chunks)
        raise RuntimeError("OpenAI response missing content text")


def build_llm_client_from_env(
    env: Mapping[str, str] | None = None,
) -> tuple[Any | None, dict[str, Any]]:
    env_map: Mapping[str, str] = env if env is not None else os.environ
    provider = _as_text(env_map.get("POS_LLM_PROVIDER"), "openai").lower()
    model = _as_text(env_map.get("POS_LLM_MODEL"), "gpt-4o-mini")
    base_url = _as_text(env_map.get("POS_LLM_BASE_URL"), "https://api.openai.com/v1")
    api_key = _as_text(env_map.get("POS_LLM_API_KEY")) or _as_text(env_map.get("OPENAI_API_KEY"))
    timeout_s = _as_float(env_map.get("POS_LLM_TIMEOUT_S"), 15.0)
    temperature = _as_float(env_map.get("POS_LLM_TEMPERATURE"), 0.0)
    max_tokens = _as_int(env_map.get("POS_LLM_MAX_TOKENS"), 900)
    enabled_flag = _as_bool(env_map.get("POS_LLM_ENABLED"), None)

    runtime = {
        "enabled": False,
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "timeout_s_default": timeout_s,
        "reason": "unknown",
    }

    if enabled_flag is False:
        runtime["reason"] = "env_disabled"
        return None, runtime

    if provider != "openai":
        runtime["reason"] = "unsupported_provider"
        return None, runtime

    if not api_key:
        runtime["reason"] = "missing_api_key"
        return None, runtime

    client = OpenAIChatJsonClient(
        api_key=api_key,
        model=model,
        base_url=base_url,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    runtime["enabled"] = True
    runtime["reason"] = "ready"
    return client, runtime


__all__ = ["OpenAIChatJsonClient", "build_llm_client_from_env"]
