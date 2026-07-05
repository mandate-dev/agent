# ============================================================
# MANDATE AGENT — Main Agent Class (Python)
# Mirror of the TypeScript MandateAgent
# ============================================================

import asyncio
import json
import urllib.request
import urllib.error
from typing import List, Optional

from .types import MandateConfig, MandatePolicy, AgentIntent, EvaluationResult
from .evaluator import PolicyEvaluator
from .buffer import AuditBuffer, AuditEvent
from .hooks.autogen import MandateAutoGenHook


class MandateAgent:
    def __init__(self, config: MandateConfig):
        self.config = config
        self._evaluator = PolicyEvaluator(config.policy)
        self._buffer = AuditBuffer(
            max_size=10000,
            flush_callback=self._send_to_control_plane,
        )

        # Framework hooks
        self.autogen = MandateAutoGenHook(config, self._evaluator, self._buffer)

        print(
            f'[Mandate] Agent "{config.agent_id}" initialized | '
            f"env: {config.environment} | "
            f"framework: {config.framework} | "
            f"policy: {config.policy.policy_hash}"
        )

    def evaluate(self, intent: AgentIntent) -> EvaluationResult:
        return self._evaluator.evaluate(intent)

    async def flush_audit_buffer(self) -> List[AuditEvent]:
        return await self._buffer.flush()

    def get_buffer_size(self) -> int:
        return self._buffer.size()

    def update_policy(self, policy: MandatePolicy) -> None:
        self._evaluator.update_policy(policy)
        print(f"[Mandate] Policy updated: {policy.policy_hash}")

    async def _send_to_control_plane(self, events: List[AuditEvent]) -> None:
        if not self.config.control_plane_url or not self.config.api_key:
            return
        try:
            payload = json.dumps({"events": [e.to_dict() for e in events]}).encode("utf-8")
            req = urllib.request.Request(
                f"{self.config.control_plane_url}/v1/events",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.config.api_key}",
                },
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass


def create_mandate_agent(config: MandateConfig) -> MandateAgent:
    return MandateAgent(config)