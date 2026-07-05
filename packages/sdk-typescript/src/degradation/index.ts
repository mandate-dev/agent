// ============================================================
// MANDATE DEGRADATION STATE MACHINE
// V3 five-tier degradation — active-active design means this
// fires only in catastrophic multi-region failure scenarios.
// Local autonomy is the last line of defense, not the first.
// ============================================================

import type { DegradationTier, AgentRiskTier } from '../types';

interface DegradationOptions {
  gracePeriodMs?: number;
  riskTier?: AgentRiskTier;
  onTierChange?: (from: DegradationTier, to: DegradationTier) => void;
}

interface DegradationState {
  tier: DegradationTier;
  isolatedAt?: number;
  graceElapsedAt?: number;
  lastControlPlaneContact?: number;
}

export class DegradationManager {
  private state: DegradationState = { tier: 'NOMINAL' };
  private gracePeriodMs: number;
  private riskTier: AgentRiskTier;
  private onTierChange?: (from: DegradationTier, to: DegradationTier) => void;
  private graceTimer?: ReturnType<typeof setTimeout>;

  constructor(options: DegradationOptions = {}) {
    this.gracePeriodMs = options.gracePeriodMs ?? 30 * 60 * 1000;
    this.riskTier = options.riskTier ?? 'STANDARD';

    if (options.onTierChange !== undefined) {
      this.onTierChange = options.onTierChange;
    }
  }

  // Called when control plane responds slowly (>500ms)
  onControlPlaneLatency(latencyMs: number): void {
    if (latencyMs > 500 && this.state.tier === 'NOMINAL') {
      this.transition('DEGRADED');
    }
  }

  // Called when control plane becomes completely unreachable
  onControlPlaneUnreachable(): void {
    if (
      this.state.tier === 'NOMINAL' ||
      this.state.tier === 'DEGRADED'
    ) {
      this.transition('ISOLATED');
      this.startGraceTimer();
    }
  }

  // Called when control plane reconnects successfully
  onControlPlaneReconnected(): void {
    if (this.graceTimer !== undefined) {
        clearTimeout(this.graceTimer);
        delete this.graceTimer;
      }

    const previous = this.state.tier;
    this.state = {
      tier: 'NOMINAL',
      lastControlPlaneContact: Date.now(),
    };

    if (previous !== 'NOMINAL') {
      this.onTierChange?.(previous, 'NOMINAL');
    }
  }

  getCurrentTier(): DegradationTier {
    return this.state.tier;
  }

  // Returns true if agent is allowed to continue operating
  shouldContinue(): boolean {
    return this.state.tier !== 'GRACE_HIGH';
  }

  // Returns ms elapsed since isolation began
  getIsolationDurationMs(): number {
    if (this.state.isolatedAt === undefined) return 0;
    return Date.now() - this.state.isolatedAt;
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private startGraceTimer(): void {
    this.graceTimer = setTimeout(() => {
      const isHighRisk =
        this.riskTier === 'HIGH' || this.riskTier === 'CRITICAL';

      const nextTier: DegradationTier = isHighRisk
        ? 'GRACE_HIGH'
        : 'GRACE_STD';

      this.transition(nextTier);
    }, this.gracePeriodMs);
  }

  private transition(to: DegradationTier): void {
    const from = this.state.tier;

    this.state.tier = to;

    if (to === 'ISOLATED') {
      this.state.isolatedAt = Date.now();
    }

    if (to === 'GRACE_STD' || to === 'GRACE_HIGH') {
      this.state.graceElapsedAt = Date.now();
    }

    this.onTierChange?.(from, to);

    if (to === 'GRACE_HIGH') {
      console.error(
        '[Mandate] GRACE_HIGH: Agent paused. Human intervention required.'
      );
    }
  }
}