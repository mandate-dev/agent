// ============================================================
// MANDATE — LangChain / LangGraph Native Integration
// Three integration patterns for every use case:
//
//  1. MandateCallbackHandler  — zero-config, plug into callbacks[]
//  2. createMandateTool()     — wrap individual tools
//  3. getBeforeToolCallHook() — manual interception (legacy)
//
// Works without @langchain/core as a hard dependency.
// LangChain types are matched via structural typing.
// ============================================================

import type {
  AgentIntent,
  MandateConfig,
  EvaluationResult,
} from '../types';
import type { JSPolicyEvaluator } from '../evaluator/js-evaluator';
import type { AuditBuffer } from '../buffer';
import type { DegradationManager } from '../degradation';

// ============================================================
// LANGCHAIN TYPE SHAPES — matched structurally, no import needed
// ============================================================

interface LangChainToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

// Shape of a LangChain StructuredTool / DynamicStructuredTool
interface LangChainTool {
  name: string;
  description: string;
  invoke(input: Record<string, unknown> | string): Promise<string>;
  schema?: unknown;
}

// Shape of LangChain's callback handler methods
interface LangChainCallbackMethods {
  handleToolStart?(
    tool: { name: string },
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ): Promise<void> | void;
  handleToolEnd?(
    output: string,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> | void;
  handleToolError?(
    err: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> | void;
}

// ============================================================
// MANDATE CALLBACK HANDLER
// Zero-config integration. Pass to any LangChain agent:
//
//   const handler = agent.langchain.createCallbackHandler();
//   await agentExecutor.invoke(input, { callbacks: [handler] });
//
// DENY decisions throw MandateViolationError which LangChain
// catches as a tool error — agent sees the block, not a crash.
// ============================================================

export class MandateViolationError extends Error {
  public readonly toolName: string;
  public readonly decision: string;
  public readonly reason: string;

  constructor(toolName: string, decision: string, reason: string) {
    super(`[Mandate] ${decision}: ${reason} (tool: ${toolName})`);
    this.name = 'MandateViolationError';
    this.toolName = toolName;
    this.decision = decision;
    this.reason = reason;
  }
}

export class MandateCallbackHandler implements LangChainCallbackMethods {
  private evaluator: JSPolicyEvaluator;
  private buffer: AuditBuffer;
  private degradation: DegradationManager;
  private config: MandateConfig;
  private sessionId: string;
  private stepCounter: number = 0;

  // Track pending evaluations by runId for handleToolEnd correlation
  private pendingRuns = new Map<string, { intent: AgentIntent; result: EvaluationResult }>();

  constructor(
    config: MandateConfig,
    evaluator: JSPolicyEvaluator,
    buffer: AuditBuffer,
    degradation: DegradationManager
  ) {
    this.config = config;
    this.evaluator = evaluator;
    this.buffer = buffer;
    this.degradation = degradation;
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Called by LangChain before any tool executes
  async handleToolStart(
    tool: { name: string },
    input: string,
    runId: string
  ): Promise<void> {
    const step = this.stepCounter++;

    // Parse LangChain's JSON-serialized tool input
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
      if (typeof parsed === 'object' && parsed !== null) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      args = { raw: input };
    }

    const intent: AgentIntent = {
      toolName: tool.name,
      args,
      context: {
        agentId: this.config.agentId,
        sessionId: this.sessionId,
        environment: this.config.environment,
        stepInChain: step,
        framework: 'langchain',
        timestamp: Date.now(),
      },
    };

    const result = this.evaluator.evaluate(intent);
    this.logToBuffer(intent, result);
    this.pendingRuns.set(runId, { intent, result });

    if (result.decision === 'DENY' || result.decision === 'ESCALATE') {
      this.config.onViolation?.(intent, result);
      // Throw — LangChain catches this as a tool error
      // The agent sees: "Tool raised an error: [Mandate] DENY: ..."
      throw new MandateViolationError(tool.name, result.decision, result.reason);
    }

    if (result.decision === 'THROTTLE') {
      await this.delay(2000);
      this.config.onAlert?.(intent, result.anomalyScore ?? 0);
    }
  }

  // Called by LangChain after a tool completes successfully
  handleToolEnd(output: string, runId: string): void {
    this.pendingRuns.delete(runId);
  }

  // Called by LangChain when a tool errors (including our throw above)
  handleToolError(err: unknown, runId: string): void {
    this.pendingRuns.delete(runId);
    // If it's not our error, let it propagate naturally
    if (!(err instanceof MandateViolationError)) {
      return;
    }
  }

  private logToBuffer(intent: AgentIntent, result: EvaluationResult): void {
    if (this.config.auditLevel === 'off') return;
    this.buffer.append({
      timestamp: Date.now(),
      source: 'REALTIME',
      agentId: this.config.agentId,
      orgId: this.config.orgId,
      policyHash: this.config.policy.policyHash,
      degradationTier: this.degradation.getCurrentTier(),
      toolName: intent.toolName,
      toolArgs: this.config.auditLevel === 'full' ? intent.args : {},
      intentContext: intent.context,
      anomalyScore: result.anomalyScore ?? 0,
      policyDecision: result.decision,
      responseLevel: 1,
      evalLatencyMs: result.latencyMs,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// CREATE MANDATE TOOL
// Wraps any LangChain StructuredTool / DynamicStructuredTool.
// Policy is enforced before the tool's invoke() runs.
//
// Usage:
//   const safeTool = createMandateTool(myTool, mandateAgent.langchain);
//   const safeTools = tools.map(t => createMandateTool(t, mandateAgent.langchain));
//   const executor = await AgentExecutor.fromAgentAndTools({ tools: safeTools });
// ============================================================

export function createMandateTool(
  tool: LangChainTool,
  hook: MandateLangChainHook
): LangChainTool {
  return {
    name: tool.name,
    description: tool.description,
    schema: tool.schema,

    async invoke(input: Record<string, unknown> | string): Promise<string> {
      const args: Record<string, unknown> =
        typeof input === 'string'
          ? (() => {
              try { return JSON.parse(input) as Record<string, unknown>; }
              catch { return { raw: input }; }
            })()
          : input;

      const { allowed, result } = await hook.interceptToolCall({
        name: tool.name,
        args,
      });

      if (!allowed) {
        throw new MandateViolationError(
          tool.name,
          result.decision,
          result.reason
        );
      }

      return tool.invoke(input);
    },
  };
}

// ============================================================
// MANDATE LANGCHAIN HOOK
// The main hook class, accessed via agent.langchain
// ============================================================

export class MandateLangChainHook {
  private evaluator: JSPolicyEvaluator;
  private buffer: AuditBuffer;
  private degradation: DegradationManager;
  private config: MandateConfig;
  private sessionId: string;
  private stepCounter: number = 0;

  constructor(
    config: MandateConfig,
    evaluator: JSPolicyEvaluator,
    buffer: AuditBuffer,
    degradation: DegradationManager
  ) {
    this.config = config;
    this.evaluator = evaluator;
    this.buffer = buffer;
    this.degradation = degradation;
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // ── Pattern 1: Zero-config callback handler ──────────────
  // const handler = mandateAgent.langchain.createCallbackHandler();
  // await executor.invoke(input, { callbacks: [handler] });
  createCallbackHandler(): MandateCallbackHandler {
    return new MandateCallbackHandler(
      this.config,
      this.evaluator,
      this.buffer,
      this.degradation
    );
  }

  // ── Pattern 2: Wrap individual tools ────────────────────
  // const safeTools = tools.map(t => mandateAgent.langchain.wrapTool(t));
  wrapTool(tool: LangChainTool): LangChainTool {
    return createMandateTool(tool, this);
  }

  // ── Pattern 3: Wrap entire tools array ──────────────────
  // const safeTools = mandateAgent.langchain.wrapTools(tools);
  wrapTools(tools: LangChainTool[]): LangChainTool[] {
    return tools.map((t) => this.wrapTool(t));
  }

  // ── Pattern 4: Manual before_tool_call callback ──────────
  // agent.beforeToolCall = mandateAgent.langchain.getBeforeToolCallHook();
  getBeforeToolCallHook(): (
    toolCall: LangChainToolCall
  ) => Promise<LangChainToolCall | null> {
    return async (
      toolCall: LangChainToolCall
    ): Promise<LangChainToolCall | null> => {
      const { allowed } = await this.interceptToolCall(toolCall);
      return allowed ? toolCall : null;
    };
  }

  // ── Core: direct interception ────────────────────────────
  async interceptToolCall(
    toolCall: LangChainToolCall
  ): Promise<{ allowed: boolean; result: EvaluationResult }> {
    const step = this.stepCounter++;
    const intent = this.buildIntent(toolCall, step);
    const result = this.evaluator.evaluate(intent);

    this.logToBuffer(intent, result);

    if (result.decision === 'DENY' || result.decision === 'ESCALATE') {
      this.config.onViolation?.(intent, result);
      return { allowed: false, result };
    }

    if (result.decision === 'THROTTLE') {
      await this.delay(2000);
      this.config.onAlert?.(intent, result.anomalyScore ?? 0);
    }

    return { allowed: true, result };
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private buildIntent(
    toolCall: LangChainToolCall,
    step: number
  ): AgentIntent {
    return {
      toolName: toolCall.name,
      args: toolCall.args,
      context: {
        agentId: this.config.agentId,
        sessionId: this.sessionId,
        environment: this.config.environment,
        stepInChain: step,
        framework: 'langchain',
        timestamp: Date.now(),
      },
    };
  }

  private logToBuffer(intent: AgentIntent, result: EvaluationResult): void {
    if (this.config.auditLevel === 'off') return;
    this.buffer.append({
      timestamp: Date.now(),
      source: 'REALTIME',
      agentId: this.config.agentId,
      orgId: this.config.orgId,
      policyHash: this.config.policy.policyHash,
      degradationTier: this.degradation.getCurrentTier(),
      toolName: intent.toolName,
      toolArgs: this.config.auditLevel === 'full' ? intent.args : {},
      intentContext: intent.context,
      anomalyScore: result.anomalyScore ?? 0,
      policyDecision: result.decision,
      responseLevel: 1,
      evalLatencyMs: result.latencyMs,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}