// ============================================================
// @mandate/agent — Trust Engine for the Agent Economy
// The Mandate Agent SDK main entry point
// Every developer imports from here
// ============================================================

import { WasmPolicyEvaluator } from './evaluator/wasm-evaluator';
import { AuditBuffer } from './buffer';
import { DegradationManager } from './degradation';
import { MandateOpenAIHook } from './hooks/openai';
import { MandateLangChainHook } from './hooks/langchain';
import { MandateAnthropicHook } from './hooks/anthropic';

import type {
  MandateConfig,
  AgentIntent,
  EvaluationResult,
  AuditEvent,
  DegradationTier,
  MandatePolicy,
} from './types';

// Re-export types for developer use
export type {
  MandateConfig,
  MandatePolicy,
  AgentIntent,
  EvaluationResult,
  AuditEvent,
  DegradationTier,
  AgentFramework,
  AgentEnvironment,
  AgentRiskTier,
  PolicyDecision,
  PolicyRule,
  PolicyCondition,
  ResponseLevel,
} from './types';

// Re-export LangChain integration classes
export { MandateCallbackHandler, MandateViolationError, createMandateTool } from './hooks/langchain';

// ============================================================
// MANDATE AGENT — main class
// ============================================================

export class MandateAgent {
  private config: MandateConfig;
  private evaluator: WasmPolicyEvaluator;
  private buffer: AuditBuffer;
  private degradation: DegradationManager;

  public readonly openai: MandateOpenAIHook;
  public readonly langchain: MandateLangChainHook;
  public readonly anthropic: MandateAnthropicHook;

  constructor(config: MandateConfig) {
    this.config = config;

    this.evaluator = new WasmPolicyEvaluator(config.policy);

    this.buffer = new AuditBuffer({
      maxSize: 10000,
      flushCallback: async (events) => {
        await this.sendToControlPlane(events);
      },
    });

    this.degradation = new DegradationManager({
      gracePeriodMs: config.policy.localAutonomy.gracePeriodMs,
      riskTier: config.riskTier ?? 'STANDARD',
      onTierChange: (from, to) => {
        config.onDegradation?.(from, to);
        console.warn(`[Mandate] Degradation: ${from} → ${to}`);
      },
    });

    this.openai = new MandateOpenAIHook(
      config,
      this.evaluator,
      this.buffer,
      this.degradation
    );

    this.langchain = new MandateLangChainHook(
      config,
      this.evaluator,
      this.buffer,
      this.degradation
    );

    this.anthropic = new MandateAnthropicHook(
      config,
      this.evaluator,
      this.buffer,
      this.degradation
    );

    console.log(
      `[Mandate] Agent "${config.agentId}" initialized | ` +
      `env: ${config.environment} | ` +
      `framework: ${config.framework} | ` +
      `policy: ${config.policy.policyHash}`
    );
  }

  evaluate(intent: AgentIntent): EvaluationResult {
    return this.evaluator.evaluate(intent);
  }

  async flushAuditBuffer(): Promise<AuditEvent[]> {
    return this.buffer.flush();
  }

  verifyAuditChain(): { valid: boolean; corruptedAt?: number } {
    return this.buffer.verify();
  }

  getDegradationTier(): DegradationTier {
    return this.degradation.getCurrentTier();
  }

  getBufferSize(): number {
    return this.buffer.size();
  }

  updatePolicy(policy: MandatePolicy): void {
    this.evaluator.updatePolicy(policy);
    console.log(`[Mandate] Policy updated: ${policy.policyHash}`);
  }

  private async sendToControlPlane(events: AuditEvent[]): Promise<void> {
    if (!this.config.controlPlaneUrl || !this.config.apiKey) return;

    try {
      const response = await fetch(
        `${this.config.controlPlaneUrl}/v1/events`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({ events }),
        }
      );

      if (!response.ok) {
        throw new Error(`Control plane responded with ${response.status}`);
      }

      this.degradation.onControlPlaneReconnected();
    } catch {
      this.degradation.onControlPlaneUnreachable();
    }
  }
}

// ============================================================
// CONVENIENCE FACTORY
// ============================================================

export function createMandateAgent(config: MandateConfig): MandateAgent {
  return new MandateAgent(config);
}