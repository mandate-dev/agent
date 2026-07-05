# ============================================================
# MANDATE AGENT — Core Types
# Python port of the TypeScript SDK types
# ============================================================

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Literal, Optional

PolicyDecision = Literal["ALLOW", "DENY", "ESCALATE", "THROTTLE"]
AgentFramework = Literal["autogen", "openai", "anthropic", "langchain", "custom"]
AgentEnvironment = Literal["production", "staging", "development"]
AgentRiskTier = Literal["LOW", "STANDARD", "HIGH", "CRITICAL"]
DegradationTier = Literal["NOMINAL", "DEGRADED", "ISOLATED", "GRACE_STD", "GRACE_HIGH"]


@dataclass
class PolicyCondition:
    field: str
    operator: str  # eq, neq, lt, lte, gt, gte, in, nin, startsWith, endsWith, contains
    value: Any


@dataclass
class PolicyRule:
    tool: str  # supports wildcards: "read_*", "*", "delete_records"
    conditions: List[PolicyCondition] = field(default_factory=list)


@dataclass
class AnomalyThresholds:
    alert: float = 0.60
    throttle: float = 0.80


@dataclass
class LocalAutonomyConfig:
    grace_period_ms: int = 1800000
    post_grace: Literal["PAUSE", "STOP"] = "PAUSE"


@dataclass
class MandatePolicy:
    agent_id: str
    version: str
    policy_hash: str
    allow: List[PolicyRule]
    deny: List[PolicyRule]
    anomaly_thresholds: AnomalyThresholds = field(default_factory=AnomalyThresholds)
    local_autonomy: LocalAutonomyConfig = field(default_factory=LocalAutonomyConfig)


@dataclass
class IntentContext:
    agent_id: str
    session_id: str
    environment: AgentEnvironment
    step_in_chain: int
    framework: AgentFramework
    timestamp: int


@dataclass
class AgentIntent:
    tool_name: str
    args: Dict[str, Any]
    context: IntentContext


@dataclass
class EvaluationResult:
    decision: PolicyDecision
    reason: str
    latency_ms: float
    rule_matched: Optional[str] = None
    anomaly_score: Optional[float] = None


@dataclass
class MandateConfig:
    agent_id: str
    org_id: str
    policy: MandatePolicy
    framework: AgentFramework
    environment: AgentEnvironment
    audit_level: Literal["full", "minimal", "off"] = "minimal"
    api_key: Optional[str] = None
    control_plane_url: Optional[str] = None
    risk_tier: AgentRiskTier = "STANDARD"
    on_violation: Optional[Callable[["AgentIntent", "EvaluationResult"], None]] = None
    on_alert: Optional[Callable[["AgentIntent", float], None]] = None