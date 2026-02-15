from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Mapping, MutableMapping, Protocol


ITEM_MAPPING_CACHE = "item_mapping_cache"
NOTE_MODS_CACHE = "note_mods_cache"
GROUP_PATTERN_CACHE = "group_pattern_cache"

CACHE_NAMESPACES = {
    ITEM_MAPPING_CACHE,
    NOTE_MODS_CACHE,
    GROUP_PATTERN_CACHE,
}

_NAMESPACE_KEY_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    ITEM_MAPPING_CACHE: ("name_raw", "menu_catalog_version"),
    NOTE_MODS_CACHE: ("note_raw", "allowed_mods_version"),
    GROUP_PATTERN_CACHE: ("group_pattern", "menu_catalog_version", "allowed_mods_version"),
}


def _is_missing_required(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


@dataclass(slots=True)
class CacheEntry:
    value: Any
    confidence: float
    meta: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    expires_at: float | None = None

    def is_expired(self, now: float | None = None) -> bool:
        if self.expires_at is None:
            return False
        ts = now if now is not None else time.time()
        return ts >= self.expires_at


class CacheBackend(Protocol):
    def get(self, namespace: str, key: str) -> CacheEntry | None: ...

    def set(self, namespace: str, key: str, entry: CacheEntry) -> None: ...

    def delete(self, namespace: str, key: str) -> None: ...


class MemoryCacheBackend:
    def __init__(self) -> None:
        self._store: MutableMapping[str, MutableMapping[str, CacheEntry]] = {}

    def get(self, namespace: str, key: str) -> CacheEntry | None:
        return self._store.get(namespace, {}).get(key)

    def set(self, namespace: str, key: str, entry: CacheEntry) -> None:
        bucket = self._store.setdefault(namespace, {})
        bucket[key] = entry

    def delete(self, namespace: str, key: str) -> None:
        bucket = self._store.get(namespace)
        if not bucket:
            return
        bucket.pop(key, None)


class POSNormCache:
    def __init__(
        self,
        *,
        backend: CacheBackend | None = None,
        namespace_ttls: Mapping[str, int] | None = None,
    ) -> None:
        self._backend = backend or MemoryCacheBackend()
        self._namespace_ttls = {
            ITEM_MAPPING_CACHE: 3600,
            NOTE_MODS_CACHE: 3600,
            GROUP_PATTERN_CACHE: 1800,
        }
        if namespace_ttls:
            unknown_namespaces = sorted({*namespace_ttls.keys()} - CACHE_NAMESPACES)
            if unknown_namespaces:
                joined = ", ".join(unknown_namespaces)
                raise ValueError(f"Unsupported TTL namespace(s): {joined}")
            self._namespace_ttls.update(namespace_ttls)

    def get(self, namespace: str, key_payload: Mapping[str, Any]) -> CacheEntry | None:
        key = self._make_key(namespace, key_payload)
        entry = self._backend.get(namespace, key)
        if entry is None:
            return None
        if entry.is_expired():
            self._backend.delete(namespace, key)
            return None
        return entry

    def set(
        self,
        namespace: str,
        key_payload: Mapping[str, Any],
        value: Any,
        confidence: float,
        meta: Mapping[str, Any] | None = None,
    ) -> CacheEntry:
        key = self._make_key(namespace, key_payload)
        ttl_s = self._namespace_ttls.get(namespace)
        now = time.time()
        expires_at = None
        if ttl_s is not None and ttl_s > 0:
            expires_at = now + float(ttl_s)

        entry = CacheEntry(
            value=value,
            confidence=max(0.0, min(1.0, float(confidence))),
            meta=dict(meta or {}),
            created_at=now,
            expires_at=expires_at,
        )
        self._backend.set(namespace, key, entry)
        return entry

    def invalidate(self, namespace: str, key_payload: Mapping[str, Any]) -> None:
        key = self._make_key(namespace, key_payload)
        self._backend.delete(namespace, key)

    def _make_key(self, namespace: str, key_payload: Mapping[str, Any]) -> str:
        if namespace not in CACHE_NAMESPACES:
            raise ValueError(f"Unsupported namespace: {namespace}")

        required_fields = _NAMESPACE_KEY_REQUIREMENTS[namespace]
        missing = [field for field in required_fields if _is_missing_required(key_payload.get(field))]
        if missing:
            raise ValueError(f"Missing key fields for {namespace}: {', '.join(missing)}")

        normalized_payload = self._normalize_payload(key_payload)
        canonical = json.dumps(normalized_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return f"{namespace}:{digest}"

    def _normalize_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        normalized: dict[str, Any] = {}
        for key in sorted(payload.keys()):
            normalized[key] = self._normalize_value(payload[key])
        return normalized

    def _normalize_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, Mapping):
            nested: dict[str, Any] = {}
            for key in sorted(value.keys()):
                nested[str(key)] = self._normalize_value(value[key])
            return nested
        if isinstance(value, list):
            return [self._normalize_value(v) for v in value]
        if isinstance(value, tuple):
            return [self._normalize_value(v) for v in value]
        if isinstance(value, (set, frozenset)):
            normalized = [self._normalize_value(v) for v in value]
            return sorted(normalized, key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True))
        return value


_default_cache = POSNormCache()


def get(namespace: str, key_payload: Mapping[str, Any]) -> CacheEntry | None:
    return _default_cache.get(namespace, key_payload)


def set(
    namespace: str,
    key_payload: Mapping[str, Any],
    value: Any,
    confidence: float,
    meta: Mapping[str, Any] | None = None,
) -> CacheEntry:
    return _default_cache.set(namespace, key_payload, value, confidence, meta)


def invalidate(namespace: str, key_payload: Mapping[str, Any]) -> None:
    _default_cache.invalidate(namespace, key_payload)


__all__ = [
    "CACHE_NAMESPACES",
    "GROUP_PATTERN_CACHE",
    "ITEM_MAPPING_CACHE",
    "NOTE_MODS_CACHE",
    "CacheBackend",
    "CacheEntry",
    "MemoryCacheBackend",
    "POSNormCache",
    "get",
    "invalidate",
    "set",
]
