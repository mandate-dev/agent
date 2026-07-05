// ============================================================
// MANDATE POLICY EVALUATOR
// Deterministic JavaScript evaluator — API-identical to the
// future WASM evaluator. When the Rust/WASM compiler is ready,
// this module is replaced with zero changes to the SDK interface.
// Target: sub-millisecond evaluation on structured tool-call intent
// ============================================================

import type {
    AgentIntent,
    EvaluationResult,
    MandatePolicy,
    PolicyRule,
    PolicyCondition,
    PolicyDecision,
  } from '../types';
  
  export class JSPolicyEvaluator {
    private policy: MandatePolicy;
  
    constructor(policy: MandatePolicy) {
      this.policy = policy;
    }
  
    evaluate(intent: AgentIntent): EvaluationResult {
      const start = performance.now();
  
      // DENY rules evaluated first — deny always wins over allow
      for (const rule of this.policy.deny) {
        if (this.matchesRule(intent, rule)) {
          return this.result('DENY', `Denied by rule: ${rule.tool}`, start, `deny:${rule.tool}`);
        }
      }
  
      // ALLOW rules evaluated second
      for (const rule of this.policy.allow) {
        if (this.matchesRule(intent, rule)) {
          return this.result('ALLOW', `Allowed by rule: ${rule.tool}`, start, `allow:${rule.tool}`);
        }
      }
  
      // Default deny — no allow rule matched
      return this.result('DENY', 'No allow rule matched — default deny', start);
    }
  
    updatePolicy(policy: MandatePolicy): void {
      this.policy = policy;
    }
  
    getPolicyHash(): string {
      return this.policy.policyHash;
    }
  
    // ============================================================
    // PRIVATE — Rule matching
    // ============================================================
  
    private matchesRule(intent: AgentIntent, rule: PolicyRule): boolean {
      if (!this.matchesToolPattern(intent.toolName, rule.tool)) {
        return false;
      }
  
      if (!rule.conditions || rule.conditions.length === 0) {
        return true;
      }
  
      // All conditions must pass — AND logic
      return rule.conditions.every((condition) =>
        this.evaluateCondition(intent, condition)
      );
    }
  
    private matchesToolPattern(toolName: string, pattern: string): boolean {
      if (pattern === '*') return true;
      if (pattern === toolName) return true;
  
      // Prefix wildcard: "read_*" matches "read_invoices"
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return toolName.startsWith(prefix);
      }
  
      // Suffix wildcard: "*_payment" matches "process_payment"
      if (pattern.startsWith('*')) {
        const suffix = pattern.slice(1);
        return toolName.endsWith(suffix);
      }
  
      return false;
    }
  
    private evaluateCondition(
      intent: AgentIntent,
      condition: PolicyCondition
    ): boolean {
      const value = this.resolveField(intent, condition.field);
  
      switch (condition.operator) {
        case 'eq':
          return value === condition.value;
        case 'neq':
          return value !== condition.value;
        case 'lt':
          return typeof value === 'number' &&
            typeof condition.value === 'number' &&
            value < condition.value;
        case 'lte':
          return typeof value === 'number' &&
            typeof condition.value === 'number' &&
            value <= condition.value;
        case 'gt':
          return typeof value === 'number' &&
            typeof condition.value === 'number' &&
            value > condition.value;
        case 'gte':
          return typeof value === 'number' &&
            typeof condition.value === 'number' &&
            value >= condition.value;
        case 'in':
          return Array.isArray(condition.value) &&
            condition.value.includes(value);
        case 'nin':
          return Array.isArray(condition.value) &&
            !condition.value.includes(value);
        case 'startsWith':
          return typeof value === 'string' &&
            typeof condition.value === 'string' &&
            value.startsWith(condition.value);
        case 'endsWith':
          return typeof value === 'string' &&
            typeof condition.value === 'string' &&
            value.endsWith(condition.value);
        case 'contains':
          return typeof value === 'string' &&
            typeof condition.value === 'string' &&
            value.includes(condition.value);
        default:
          return false;
      }
    }
  
    // Resolves dot-notation field paths against the intent object
    // "intent.args.amount" → intent.args.amount value
    private resolveField(intent: AgentIntent, field: string): unknown {
      const root: Record<string, unknown> = {
        intent: {
          toolName: intent.toolName,
          args: intent.args,
          context: intent.context,
        },
      };
  
      const parts = field.split('.');
      let current: unknown = root;
  
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = (current as Record<string, unknown>)[part];
      }
  
      return current;
    }
  
    private result(
        decision: PolicyDecision,
        reason: string,
        startTime: number,
        ruleMatched?: string
      ): EvaluationResult {
        const base: EvaluationResult = {
          decision,
          reason,
          latencyMs: performance.now() - startTime,
          anomalyScore: 0,
        };
    
        if (ruleMatched !== undefined) {
          base.ruleMatched = ruleMatched;
        }
    
        return base;
      }
    }