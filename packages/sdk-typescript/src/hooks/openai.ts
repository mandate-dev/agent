// ============================================================
// MANDATE — OpenAI Assistants API + Function Calling Hook
// Intercepts function_call declarations before execution.
// Full semantic enforcement on structured tool-call intent.
// ============================================================

import type {
    AgentIntent,
    MandateConfig,
    EvaluationResult,
  } from '../types';
  import type { JSPolicyEvaluator } from '../evaluator/js-evaluator';
  import type { AuditBuffer } from '../buffer';
  import type { DegradationManager } from '../degradation';
  
  interface OpenAIFunctionCall {
    name: string;
    arguments: string;
  }
  
  interface OpenAIToolCall {
    id: string;
    type: 'function';
    function: OpenAIFunctionCall;
  }
  
  interface InterceptResult {
    allowed: OpenAIToolCall[];
    blocked: Array<{ toolCall: OpenAIToolCall; result: EvaluationResult }>;
  }
  
  export class MandateOpenAIHook {
    private evaluator: JSPolicyEvaluator;
    private buffer: AuditBuffer;
    private degradation: DegradationManager;
    private config: MandateConfig;
    private sessionId: string;
  
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
      this.sessionId = this.generateSessionId();
    }
  
    // Intercept OpenAI tool calls before execution
    async interceptToolCalls(
      toolCalls: OpenAIToolCall[],
      stepInChain: number = 0
    ): Promise<InterceptResult> {
      const allowed: OpenAIToolCall[] = [];
      const blocked: Array<{
        toolCall: OpenAIToolCall;
        result: EvaluationResult;
      }> = [];
  
      for (const toolCall of toolCalls) {
        const intent = this.buildIntent(toolCall, stepInChain);
        const result = this.evaluator.evaluate(intent);
  
        this.logToBuffer(intent, result);
  
        if (result.decision === 'ALLOW') {
          allowed.push(toolCall);
        } else if (result.decision === 'THROTTLE') {
          await this.delay(2000);
          this.config.onAlert?.(intent, result.anomalyScore ?? 0);
          allowed.push(toolCall);
        } else {
          blocked.push({ toolCall, result });
          this.config.onViolation?.(intent, result);
        }
      }
  
      return { allowed, blocked };
    }
  
    // ============================================================
    // PRIVATE
    // ============================================================
  
    private buildIntent(
      toolCall: OpenAIToolCall,
      stepInChain: number
    ): AgentIntent {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(toolCall.function.arguments);
        if (typeof parsed === 'object' && parsed !== null) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = { raw: toolCall.function.arguments };
      }
      return {
        toolName: toolCall.function.name,
        args,
        context: {
          agentId: this.config.agentId,
          sessionId: this.sessionId,
          environment: this.config.environment,
          stepInChain,
          framework: 'openai-assistants',
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
  
    private generateSessionId(): string {
      return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
  
    private delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  }