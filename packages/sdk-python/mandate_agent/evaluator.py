# ============================================================
# MANDATE AGENT — Policy Evaluator
# Python port of the TypeScript js-evaluator.ts
# Deterministic rule evaluation — no LLM in the path
# ============================================================

import fnmatch
import time
from typing import Any, Dict, Optional

from .types import (
    AgentIntent,
    EvaluationResult,
    MandatePolicy,
    PolicyRule,
    PolicyCondition,
)


class PolicyEvaluator:
    def __init__(self, policy: MandatePolicy):
        self.policy = policy

    def evaluate(self, intent: AgentIntent) -> EvaluationResult:
        start = time.perf_counter()

        # Deny rules checked first
        for rule in self.policy.deny:
            if self._matches_rule(intent, rule):
                latency = (time.perf_counter() - start) * 1000
                return EvaluationResult(
                    decision="DENY",
                    reason=f"Tool '{intent.tool_name}' matched deny rule '{rule.tool}'",
                    latency_ms=round(latency, 4),
                    rule_matched=rule.tool,
                    anomaly_score=0.0,
                )

        # Allow rules checked next
        for rule in self.policy.allow:
            if self._matches_rule(intent, rule):
                latency = (time.perf_counter() - start) * 1000
                return EvaluationResult(
                    decision="ALLOW",
                    reason=f"Tool '{intent.tool_name}' matched allow rule '{rule.tool}'",
                    latency_ms=round(latency, 4),
                    rule_matched=rule.tool,
                    anomaly_score=0.0,
                )

        # No allow rule matched — default deny
        latency = (time.perf_counter() - start) * 1000
        return EvaluationResult(
            decision="DENY",
            reason=f"Tool '{intent.tool_name}' did not match any allow rule (default deny)",
            latency_ms=round(latency, 4),
            rule_matched=None,
            anomaly_score=0.0,
        )

    def update_policy(self, policy: MandatePolicy) -> None:
        self.policy = policy

    def _matches_rule(self, intent: AgentIntent, rule: PolicyRule) -> bool:
        if not fnmatch.fnmatch(intent.tool_name, rule.tool):
            return False
        for condition in rule.conditions:
            if not self._evaluate_condition(intent.args, condition):
                return False
        return True

    def _evaluate_condition(
        self, args: Dict[str, Any], condition: PolicyCondition
    ) -> bool:
        value = self._resolve_field(args, condition.field)
        if value is None:
            return False

        op = condition.operator
        cv = condition.value

        try:
            if op == "eq":
                return value == cv
            elif op == "neq":
                return value != cv
            elif op == "lt":
                return float(value) < float(cv)
            elif op == "lte":
                return float(value) <= float(cv)
            elif op == "gt":
                return float(value) > float(cv)
            elif op == "gte":
                return float(value) >= float(cv)
            elif op == "in":
                return value in cv
            elif op == "nin":
                return value not in cv
            elif op == "startsWith":
                return str(value).startswith(str(cv))
            elif op == "endsWith":
                return str(value).endswith(str(cv))
            elif op == "contains":
                return str(cv) in str(value)
        except (TypeError, ValueError):
            return False

        return False

    def _resolve_field(self, args: Dict[str, Any], field_path: str) -> Any:
        # Support "intent.args.amount" or just "amount"
        path = field_path.replace("intent.args.", "")
        parts = path.split(".")
        current: Any = args
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        return current