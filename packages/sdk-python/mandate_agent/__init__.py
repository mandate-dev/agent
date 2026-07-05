# ============================================================
# mandatedev-agent — Trust Engine for the Agent Economy
# Python SDK — AutoGen, OpenAI, Anthropic, LangChain
# ============================================================

from .agent import MandateAgent, create_mandate_agent
from .types import (
    MandateConfig,
    MandatePolicy,
    PolicyRule,
    PolicyCondition,
    AnomalyThresholds,
    LocalAutonomyConfig,
    AgentIntent,
    IntentContext,
    EvaluationResult,
)
from .hooks.autogen import MandateAutoGenHook, MandateViolationError

__version__ = "0.1.0"
__all__ = [
    "MandateAgent",
    "create_mandate_agent",
    "MandateConfig",
    "MandatePolicy",
    "PolicyRule",
    "PolicyCondition",
    "AnomalyThresholds",
    "LocalAutonomyConfig",
    "AgentIntent",
    "IntentContext",
    "EvaluationResult",
    "MandateAutoGenHook",
    "MandateViolationError",
]