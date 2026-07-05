# ============================================================
# MANDATE — AutoGen Native Integration
# Supports AutoGen 0.4 (autogen-agentchat) and AutoGen 0.2
#
# Three integration patterns:
#   1. wrap_tool(func)   — wrap a single tool function
#   2. wrap_tools(funcs) — wrap a list of tool functions
#   3. intercept(...)    — direct manual interception
#
# Works without autogen installed (zero hard dependencies)
# ============================================================

import asyncio
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from ..types import AgentIntent, EvaluationResult, IntentContext, MandateConfig
from ..evaluator import PolicyEvaluator
from ..buffer import AuditBuffer, AuditEvent


class MandateViolationError(Exception):
    """Raised when Mandate blocks a tool call. AutoGen catches this as a tool error."""

    def __init__(self, tool_name: str, decision: str, reason: str):
        super().__init__(f"[Mandate] {decision}: {reason} (tool: {tool_name})")
        self.tool_name = tool_name
        self.decision = decision
        self.reason = reason


class MandateAutoGenHook:
    def __init__(
        self,
        config: MandateConfig,
        evaluator: PolicyEvaluator,
        buffer: AuditBuffer,
    ):
        self.config = config
        self._evaluator = evaluator
        self._buffer = buffer
        self._session_id = f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:7]}"
        self._step_counter = 0

    # ── Pattern 1: Wrap a single tool function ────────────────
    # Usage:
    #   @mandate_agent.autogen.wrap_tool
    #   async def search_web(query: str) -> str: ...
    #
    #   # or:
    #   safe_fn = mandate_agent.autogen.wrap_tool(my_function)
    def wrap_tool(self, func: Callable, name: Optional[str] = None) -> Callable:
        tool_name = name or func.__name__

        if asyncio.iscoroutinefunction(func):
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                result = await self.intercept(tool_name, kwargs if kwargs else {"args": list(args)})
                if not result["allowed"]:
                    raise MandateViolationError(
                        tool_name,
                        result["result"].decision,
                        result["result"].reason,
                    )
                return await func(*args, **kwargs)

            async_wrapper.__name__ = func.__name__
            async_wrapper.__doc__ = func.__doc__
            async_wrapper.__annotations__ = getattr(func, "__annotations__", {})
            return async_wrapper

        else:
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        import concurrent.futures
                        future = asyncio.run_coroutine_threadsafe(
                            self.intercept(tool_name, kwargs if kwargs else {"args": list(args)}),
                            loop,
                        )
                        result = future.result(timeout=5)
                    else:
                        result = loop.run_until_complete(
                            self.intercept(tool_name, kwargs if kwargs else {"args": list(args)})
                        )
                except RuntimeError:
                    result = asyncio.run(
                        self.intercept(tool_name, kwargs if kwargs else {"args": list(args)})
                    )

                if not result["allowed"]:
                    raise MandateViolationError(
                        tool_name,
                        result["result"].decision,
                        result["result"].reason,
                    )
                return func(*args, **kwargs)

            sync_wrapper.__name__ = func.__name__
            sync_wrapper.__doc__ = func.__doc__
            sync_wrapper.__annotations__ = getattr(func, "__annotations__", {})
            return sync_wrapper

    # ── Pattern 2: Wrap a list of tool functions ─────────────
    # Usage:
    #   safe_tools = mandate_agent.autogen.wrap_tools([search, read, write])
    def wrap_tools(self, tools: List[Callable]) -> List[Callable]:
        return [self.wrap_tool(t) for t in tools]

    # ── Pattern 3: Direct interception ───────────────────────
    # Usage:
    #   result = await mandate_agent.autogen.intercept("search_web", {"query": "..."})
    #   if not result["allowed"]:
    #       raise MandateViolationError(...)
    async def intercept(
        self,
        tool_name: str,
        args: Dict[str, Any],
    ) -> Dict[str, Any]:
        step = self._step_counter
        self._step_counter += 1

        intent = AgentIntent(
            tool_name=tool_name,
            args=args,
            context=IntentContext(
                agent_id=self.config.agent_id,
                session_id=self._session_id,
                environment=self.config.environment,
                step_in_chain=step,
                framework="autogen",
                timestamp=int(time.time() * 1000),
            ),
        )

        eval_result = self._evaluator.evaluate(intent)
        self._log_to_buffer(intent, eval_result)

        if eval_result.decision in ("DENY", "ESCALATE"):
            if self.config.on_violation:
                self.config.on_violation(intent, eval_result)
            return {"allowed": False, "result": eval_result}

        if eval_result.decision == "THROTTLE":
            await asyncio.sleep(2.0)
            if self.config.on_alert:
                self.config.on_alert(intent, eval_result.anomaly_score or 0.0)

        return {"allowed": True, "result": eval_result}

    def _log_to_buffer(self, intent: AgentIntent, result: EvaluationResult) -> None:
        if self.config.audit_level == "off":
            return
        event = AuditEvent(
            event_id=str(uuid.uuid4()),
            prev_hash="",
            event_hash="",
            timestamp=int(time.time() * 1000),
            source="REALTIME",
            agent_id=self.config.agent_id,
            org_id=self.config.org_id,
            policy_hash=self.config.policy.policy_hash,
            degradation_tier="NOMINAL",
            tool_name=intent.tool_name,
            tool_args=intent.args if self.config.audit_level == "full" else {},
            intent_context=intent.context,
            anomaly_score=result.anomaly_score or 0.0,
            policy_decision=result.decision,
            response_level=1,
            eval_latency_ms=result.latency_ms,
        )
        self._buffer.append(event)