from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from pos_norm.llm_client import build_llm_client_from_env  # noqa: E402


def test_build_llm_client_from_env_returns_none_without_key() -> None:
    client, runtime = build_llm_client_from_env(
        {
            "POS_LLM_PROVIDER": "openai",
            "POS_LLM_MODEL": "gpt-4o-mini",
        }
    )
    assert client is None
    assert runtime["enabled"] is False
    assert runtime["reason"] == "missing_api_key"


def test_build_llm_client_from_env_can_be_disabled_even_with_key() -> None:
    client, runtime = build_llm_client_from_env(
        {
            "POS_LLM_PROVIDER": "openai",
            "POS_LLM_ENABLED": "0",
            "OPENAI_API_KEY": "sk-test",
        }
    )
    assert client is None
    assert runtime["enabled"] is False
    assert runtime["reason"] == "env_disabled"


def test_build_llm_client_from_env_builds_openai_client_with_key() -> None:
    client, runtime = build_llm_client_from_env(
        {
            "POS_LLM_PROVIDER": "openai",
            "POS_LLM_MODEL": "gpt-4o-mini",
            "POS_LLM_BASE_URL": "https://api.openai.com/v1",
            "OPENAI_API_KEY": "sk-test",
            "POS_LLM_TIMEOUT_S": "7.5",
        }
    )
    assert client is not None
    assert runtime["enabled"] is True
    assert runtime["reason"] == "ready"
    assert runtime["provider"] == "openai"
    assert runtime["model"] == "gpt-4o-mini"
    assert runtime["timeout_s_default"] == 7.5

