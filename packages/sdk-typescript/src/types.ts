// ============================================================
// MANDATE CORE TYPES
// Every component in the SDK depends on these definitions
// ============================================================

// The framework the agent is built on
export type AgentFramework =
  | 'openai-assistants'
  | 'langchain'
  | 'autogen'
  | 'crewai'
  | 'anthropic'
  | 'custom';

// Environment the agent runs in
export type AgentEnvironment = 'production' | 'staging' | 'development';

// Risk level assigned to this agent
export type AgentRiskTier = 'LOW' | 'STANDARD' | 'HIGH' | 'CRITICAL';

// Degradation tiers — V3 five-tier state machine
export type DegradationTier =
  | 'NOMINAL'     // Full real-time enforcement, live audit streaming
  | 'DEGRADED'    // Local cache active, audit buffered, agent at full capacity
  | 'ISOLATED'    // Control plane unreachable, local enforcement only
  | 'GRACE_STD'   // 30min grace elapsed, standard risk agent continues
  | 'GRACE_HIGH'; // 30min grace elapsed, high risk agent → PAUSE

// Policy decision returned by the evaluator
export type PolicyDecision = 'ALLOW' | 'DENY' | 'ESCALATE' | 'THROTTLE';

// Kill switch response levels
export type ResponseLevel = 1 | 2 | 3 | 4 | 5;
// 1=ALERT 2=THROTTLE 3=PAUSE 4=SCOPED_KILL 5=FULL_KILL

// ============================================================
// INTENT — what Mandate intercepts from agent frameworks
// ============================================================

export interface IntentContext {
  agentId: string;
  sessionId: string;
  environment: AgentEnvironment;
  stepInChain: number;
  framework: AgentFramework;
  timestamp: number;
}

export interface AgentIntent {
  toolName: string;
  args: Record<string, unknown>;
  context: IntentContext;
}

// ============================================================
// EVALUATION RESULT
// ============================================================

export interface EvaluationResult {
  decision: PolicyDecision;
  reason: string;
  latencyMs: number;
  ruleMatched?: string;
  anomalyScore?: number;
  responseLevel?: ResponseLevel;
}

// ============================================================
// POLICY — JSON representation (MPL compiles to this format)
// ============================================================

export type ConditionOperator =
  | 'eq' | 'neq'
  | 'lt' | 'lte'
  | 'gt' | 'gte'
  | 'in' | 'nin'
  | 'startsWith'
  | 'endsWith'
  | 'contains';

export interface PolicyCondition {
  field: string;       // dot-notation: "intent.args.amount"
  operator: ConditionOperator;
  value: unknown;
}

export interface PolicyRule {
  tool: string;        // supports wildcards: "read_*", "*", "process_payment"
  conditions?: PolicyCondition[];
}

export interface PolicyIdentity {
  org: string;
  env: AgentEnvironment;
  framework?: string;
}

export interface AnomalyThresholds {
  alert: number;       // default 0.60 — fires ALERT
  throttle: number;    // default 0.80 — fires THROTTLE
}

export interface LocalAutonomyConfig {
  gracePeriodMs: number;       // default 1800000 (30 minutes)
  postGrace: 'PAUSE' | 'STOP';
}

export interface MandatePolicy {
  agentId: string;
  version: string;
  policyHash: string;
  identity: PolicyIdentity;
  allow: PolicyRule[];
  deny: PolicyRule[];
  anomalyThresholds: AnomalyThresholds;
  localAutonomy: LocalAutonomyConfig;
}

// ============================================================
// AUDIT EVENT — written to the hash-chain buffer
// ============================================================

export interface AuditEvent {
  eventId: string;
  prevHash: string;
  eventHash: string;
  timestamp: number;
  source: 'REALTIME' | 'BUFFER_SYNC';
  agentId: string;
  orgId: string;
  policyHash: string;
  degradationTier: DegradationTier;
  toolName: string;
  toolArgs: Record<string, unknown>;
  intentContext: IntentContext;
  anomalyScore: number;
  blastRadiusEst?: string;
  policyDecision: PolicyDecision;
  responseLevel: ResponseLevel;
  evalLatencyMs: number;
  tokensUsed?: number;
  costUsd?: number;
}

// ============================================================
// MANDATE CONFIGURATION
// ============================================================

export interface MandateConfig {
  agentId: string;
  orgId: string;
  apiKey?: string;
  controlPlaneUrl?: string;
  policy: MandatePolicy;
  framework: AgentFramework;
  environment: AgentEnvironment;
  auditLevel: 'full' | 'minimal' | 'off';
  riskTier?: AgentRiskTier;
  onViolation?: (intent: AgentIntent, result: EvaluationResult) => void;
  onAlert?: (intent: AgentIntent, score: number) => void;
  onDegradation?: (from: DegradationTier, to: DegradationTier) => void;
}