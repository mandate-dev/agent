// ============================================================
// MANDATE — WASM Policy Evaluator
// Extends JSPolicyEvaluator — drop-in replacement.
// When WASM loads: tamper-proof isolated sandbox evaluation.
// When WASM unavailable: falls back to JS silently.
// ============================================================

import { JSPolicyEvaluator } from './js-evaluator';
import type { MandatePolicy, AgentIntent, EvaluationResult } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wasmModule: any = null;
let _wasmLoaded = false;

function tryLoadWasm(): boolean {
  if (_wasmLoaded) return _wasmModule !== null;
  _wasmLoaded = true;
  try {
    // @ts-ignore — WASM module committed by CI
    _wasmModule = require('../wasm/mandate_evaluator');
    const ver: string = _wasmModule?.version?.() ?? 'unknown';
    console.log(`[Mandate] WASM evaluator active — ${ver}`);
    return true;
  } catch {
    _wasmModule = null;
    return false;
  }
}

export class WasmPolicyEvaluator extends JSPolicyEvaluator {
  private _policyJson: string;
  private _usingWasm: boolean;

  constructor(policy: MandatePolicy) {
    super(policy);
    this._policyJson = JSON.stringify(this._serializePolicy(policy));
    this._usingWasm = tryLoadWasm();
  }

  evaluate(intent: AgentIntent): EvaluationResult {
    const start = Date.now();

    if (this._usingWasm && _wasmModule) {
      try {
        const intentJson = JSON.stringify(this._serializeIntent(intent));
        const raw: string = _wasmModule.evaluate(this._policyJson, intentJson);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: any = JSON.parse(raw);
        return {
          decision: r.decision,
          reason: r.reason,
          latencyMs: Date.now() - start,
          ruleMatched: r.rule_matched ?? undefined,
          anomalyScore: r.anomaly_score ?? 0,
        };
      } catch {
        // WASM error — fall through to JS evaluator
      }
    }

    return super.evaluate(intent);
  }

  updatePolicy(policy: MandatePolicy): void {
    super.updatePolicy(policy);
    this._policyJson = JSON.stringify(this._serializePolicy(policy));
  }

  isWasmActive(): boolean {
    return this._usingWasm && _wasmModule !== null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _serializePolicy(policy: MandatePolicy): any {
    return {
      agent_id: policy.agentId,
      version: policy.version,
      policy_hash: policy.policyHash,
      allow: (policy.allow ?? []).map((r) => ({
        tool: r.tool,
        conditions: (r.conditions ?? []).map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value,
        })),
      })),
      deny: (policy.deny ?? []).map((r) => ({
        tool: r.tool,
        conditions: (r.conditions ?? []).map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value,
        })),
      })),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _serializeIntent(intent: AgentIntent): any {
    return {
      tool_name: intent.toolName,
      args: intent.args,
      context: {
        agent_id: intent.context.agentId,
        session_id: intent.context.sessionId,
        environment: intent.context.environment,
        step_in_chain: intent.context.stepInChain,
        framework: intent.context.framework,
        timestamp: intent.context.timestamp,
      },
    };
  }
}