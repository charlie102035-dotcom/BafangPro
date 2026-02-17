from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Mapping, NotRequired, Protocol, Sequence, TypeAlias, TypedDict


CONTRACT_VERSION = "1.0.0"
API_CONTRACT_VERSION = "1.1.0"


JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | list["JSONValue"] | dict[str, "JSONValue"]
Metadata: TypeAlias = dict[str, JSONValue]


class GroupType(str, Enum):
    PACK_TOGETHER = "pack_together"
    SEPARATE = "separate"
    OTHER = "other"


GroupTypeLiteral: TypeAlias = Literal["pack_together", "separate", "other"]


@dataclass(slots=True)
class RawLine:
    line_index: int
    raw_line: str
    name_raw: str
    qty: int
    note_raw: str | None = None
    needs_review: bool = False
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class Mod:
    mod_raw: str
    mod_name: str | None = None
    mod_value: str | None = None
    confidence: float | None = None
    needs_review: bool = False
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class CandidateItem:
    line_index: int
    raw_line: str
    name_raw: str
    qty: int
    candidate_name: str
    candidate_code: str | None = None
    note_raw: str | None = None
    mods: list[Mod] = field(default_factory=list)
    group_id: str | None = None
    confidence_item: float | None = None
    confidence_mods: float | None = None
    needs_review: bool = False
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class AuditEvent:
    event_type: str
    message: str
    line_index: int | None = None
    item_index: int | None = None
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class OrderRawParsed:
    source_text: str
    lines: list[RawLine]
    order_id: str | None = None
    parse_warnings: list[str] = field(default_factory=list)
    needs_review: bool = False
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class NormalizedItem:
    line_index: int
    raw_line: str
    name_raw: str
    qty: int
    name_normalized: str
    item_code: str | None = None
    note_raw: str | None = None
    mods: list[Mod] = field(default_factory=list)
    group_id: str | None = None
    confidence_item: float | None = None
    confidence_mods: float | None = None
    needs_review: bool = False
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class GroupResult:
    group_id: str
    type: GroupTypeLiteral
    label: str
    line_indices: list[int]
    confidence_group: float | None = None
    needs_review: bool = False
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


@dataclass(slots=True)
class OrderNormalized:
    source_text: str
    items: list[NormalizedItem]
    groups: list[GroupResult]
    order_id: str | None = None
    lines: list[RawLine] = field(default_factory=list)
    audit_events: list[AuditEvent] = field(default_factory=list)
    overall_needs_review: bool = False
    order_confidence: float | None = None
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


CandidatesByLine: TypeAlias = dict[int, list[CandidateItem]]


class MenuCatalogEntry(TypedDict, total=False):
    item_id: str
    id: str
    canonical_name: str
    name: str
    aliases: list[str]


MenuCatalogMapPayload: TypeAlias = str | Sequence[str] | Mapping[str, str | Sequence[str]]
MenuCatalog: TypeAlias = Mapping[str, MenuCatalogMapPayload] | Sequence[MenuCatalogEntry]
AllowedMods: TypeAlias = Sequence[str]
ReviewQueueStatusLiteral: TypeAlias = Literal[
    "pending_review",
    "in_review",
    "approved",
    "rejected",
    "dispatch_ready",
    "dispatched",
    "dispatch_failed",
]
ReviewDecisionLiteral: TypeAlias = Literal["approve", "reject", "request_changes"]
DispatchStatusLiteral: TypeAlias = Literal["queued", "sent", "failed", "skipped"]


class AuditTrace(TypedDict, total=False):
    audit_trace_id: str
    parent_trace_id: str | None
    correlation_id: str | None
    source: str
    created_at: str
    metadata: Metadata


class ReviewSummary(TypedDict):
    overall_needs_review: bool
    needs_review_item_line_indices: list[int]
    needs_review_group_ids: list[str]


class IngestRequest(TypedDict):
    source_text: str
    api_version: str
    order_id: NotRequired[str | None]
    audit_trace_id: NotRequired[str]
    metadata: NotRequired[Metadata]
    text: NotRequired[str]


class OrderNormalizedPayload(TypedDict):
    order: OrderNormalized
    review_summary: ReviewSummary
    review_queue_status: ReviewQueueStatusLiteral
    audit_trace_id: str
    metadata: Metadata
    version: str


class IngestResponse(TypedDict):
    accepted: bool
    version: str
    api_version: str
    order_payload: OrderNormalizedPayload
    status: NotRequired[str]
    trace_id: NotRequired[str]


class StructuredResult(TypedDict):
    items: list[NormalizedItem]
    groups: list[GroupResult]
    audit_events: list[AuditEvent]
    metadata: Metadata
    version: str


class ReviewRequest(TypedDict):
    order_id: str
    api_version: str
    audit_trace_id: str
    review_queue_status: ReviewQueueStatusLiteral
    decision: ReviewDecisionLiteral
    reviewer_id: str
    note: NotRequired[str | None]
    patched_order: NotRequired[OrderNormalized]
    metadata: NotRequired[Metadata]


class ReviewResponse(TypedDict):
    order_payload: OrderNormalizedPayload
    decision: ReviewDecisionLiteral
    review_queue_status: ReviewQueueStatusLiteral
    audit_trace_id: str
    api_version: str
    metadata: Metadata
    version: str
    status: NotRequired[str]


class ReviewListItem(TypedDict):
    order_id: str
    audit_trace_id: str
    review_queue_status: ReviewQueueStatusLiteral
    overall_needs_review: bool
    needs_review_item_count: int
    needs_review_group_count: int
    created_at: str
    updated_at: str
    metadata: Metadata
    version: str


class ReviewListResponse(TypedDict):
    api_version: str
    version: str
    items: list[ReviewListItem]
    total: int
    page: NotRequired[int]
    page_size: NotRequired[int]
    next_cursor: NotRequired[str | None]


class DispatchRequest(TypedDict):
    order_payload: OrderNormalizedPayload
    api_version: str
    dispatch_target: str
    dry_run: NotRequired[bool]
    metadata: NotRequired[Metadata]


class DispatchResponse(TypedDict):
    order_id: str | None
    audit_trace_id: str
    api_version: str
    dispatch_status: DispatchStatusLiteral
    review_queue_status: ReviewQueueStatusLiteral
    metadata: Metadata
    version: str
    status: NotRequired[str]


@dataclass(slots=True)
class PipelineInternalPayload:
    audit_trace_id: str
    review_queue_status: ReviewQueueStatusLiteral
    order_raw: OrderRawParsed
    candidates: CandidatesByLine
    structured_result: StructuredResult
    order_normalized: OrderNormalized
    review_summary: ReviewSummary
    metadata: Metadata = field(default_factory=dict)
    version: str = CONTRACT_VERSION


class ParseReceiptText(Protocol):
    def __call__(self, text: str) -> OrderRawParsed: ...


class GenerateCandidates(Protocol):
    def __call__(self, lines: Sequence[RawLine], menu_catalog: MenuCatalog) -> CandidatesByLine: ...


class LLMNormalizeAndGroup(Protocol):
    def __call__(
        self,
        order_raw: OrderRawParsed,
        candidates: CandidatesByLine,
        allowed_mods: AllowedMods,
    ) -> StructuredResult: ...


class MergeAndValidate(Protocol):
    def __call__(
        self,
        order_raw: OrderRawParsed,
        candidates: CandidatesByLine,
        structured_result: StructuredResult,
    ) -> OrderNormalized: ...


parse_receipt_text: ParseReceiptText = ...
generate_candidates: GenerateCandidates = ...
llm_normalize_and_group: LLMNormalizeAndGroup = ...
merge_and_validate: MergeAndValidate = ...


__all__ = [
    "AuditTrace",
    "API_CONTRACT_VERSION",
    "CONTRACT_VERSION",
    "DispatchRequest",
    "DispatchResponse",
    "DispatchStatusLiteral",
    "IngestRequest",
    "IngestResponse",
    "AllowedMods",
    "AuditEvent",
    "CandidateItem",
    "CandidatesByLine",
    "GenerateCandidates",
    "GroupResult",
    "GroupType",
    "GroupTypeLiteral",
    "JSONValue",
    "LLMNormalizeAndGroup",
    "MenuCatalogEntry",
    "MenuCatalogMapPayload",
    "MenuCatalog",
    "OrderNormalizedPayload",
    "MergeAndValidate",
    "Mod",
    "NormalizedItem",
    "OrderNormalized",
    "OrderRawParsed",
    "PipelineInternalPayload",
    "ParseReceiptText",
    "RawLine",
    "ReviewDecisionLiteral",
    "ReviewQueueStatusLiteral",
    "ReviewRequest",
    "ReviewResponse",
    "ReviewListItem",
    "ReviewListResponse",
    "ReviewSummary",
    "StructuredResult",
    "generate_candidates",
    "llm_normalize_and_group",
    "merge_and_validate",
    "parse_receipt_text",
]
