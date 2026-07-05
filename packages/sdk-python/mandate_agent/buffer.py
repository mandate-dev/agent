# ============================================================
# MANDATE AGENT — Audit Buffer
# Cryptographic hash chain on all audit events
# Buffers events and flushes to the control plane
# ============================================================

import asyncio
import hashlib
import uuid
import time
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Optional

from .types import DegradationTier, IntentContext, PolicyDecision


@dataclass
class AuditEvent:
    event_id: str
    prev_hash: str
    event_hash: str
    timestamp: int
    source: str
    agent_id: str
    org_id: str
    policy_hash: str
    degradation_tier: DegradationTier
    tool_name: str
    tool_args: Dict[str, Any]
    intent_context: IntentContext
    anomaly_score: float
    policy_decision: PolicyDecision
    response_level: int
    eval_latency_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "prev_hash": self.prev_hash,
            "event_hash": self.event_hash,
            "timestamp": self.timestamp,
            "source": self.source,
            "agent_id": self.agent_id,
            "org_id": self.org_id,
            "policy_hash": self.policy_hash,
            "degradation_tier": self.degradation_tier,
            "tool_name": self.tool_name,
            "tool_args": self.tool_args,
            "intent_context": {
                "agent_id": self.intent_context.agent_id,
                "session_id": self.intent_context.session_id,
                "environment": self.intent_context.environment,
                "step_in_chain": self.intent_context.step_in_chain,
                "framework": self.intent_context.framework,
                "timestamp": self.intent_context.timestamp,
            },
            "anomaly_score": self.anomaly_score,
            "policy_decision": self.policy_decision,
            "response_level": self.response_level,
            "eval_latency_ms": self.eval_latency_ms,
        }


class AuditBuffer:
    def __init__(
        self,
        max_size: int = 10000,
        flush_callback: Optional[Callable] = None,
    ):
        self._max_size = max_size
        self._events: List[AuditEvent] = []
        self._flush_callback = flush_callback
        self._last_hash = ""

    def append(self, event: AuditEvent) -> None:
        event.prev_hash = self._last_hash
        event.event_hash = self._compute_hash(event)
        self._last_hash = event.event_hash
        self._events.append(event)

        if len(self._events) >= self._max_size:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(self.flush())
            except RuntimeError:
                pass

    async def flush(self) -> List[AuditEvent]:
        events = self._events.copy()
        self._events.clear()
        if events and self._flush_callback:
            try:
                result = self._flush_callback(events)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass
        return events

    def size(self) -> int:
        return len(self._events)

    def _compute_hash(self, event: AuditEvent) -> str:
        data = (
            f"{event.event_id}|{event.timestamp}|{event.agent_id}|"
            f"{event.org_id}|{event.tool_name}|{event.policy_decision}|"
            f"{event.anomaly_score:.6f}|{event.prev_hash}"
        )
        return hashlib.sha256(data.encode()).hexdigest()