# Mandate

**The Trust Engine for the Agent Economy**

> Move your AI agents from 20% to 70% autonomy — without trading control for chaos.

---

## The Problem

You built AI agents expecting 70% automation.  
You are running at 20% because you cannot trust your agents with real permissions.

One incident happened. Your team lobotomized the agents.  
Now they run as suggestion engines — requiring human approval for everything.  
You spent millions building autonomous systems that are no longer autonomous.

**The gap between 20% and 70% is not an intelligence problem. It is a trust infrastructure problem.**

---

## What Mandate Does

Three things. Non-negotiable on engineering quality.

**1. Hard-Scoped Permissions**  
The agent physically cannot touch anything outside its defined boundary.  
Not prompt-level guardrails. Not "please only do X."  
Infrastructure-level enforcement. Deterministic. Sub-millisecond.

**2. The Real Kill Switch**  
Cryptographic key revocation across every platform in under one second.  
Tested continuously. Graduated 5-level response. Never a false-positive fleet halt.

**3. Unified Execution Graph**  
One immutable, searchable, timestamped record of every decision, every tool call, every action.  
Replaces PagerDuty + LangSmith + OpenTelemetry + Jira + 4 other tools.

---

## Install

```bash
npm install @mandatedev/agent
```

---

## Quickstart — OpenAI

```typescript
import { createMandateAgent } from '@mandate/agent';

const agent = createMandateAgent({
  agentId: 'procurement-agent-v1',
  orgId: 'acme-corp',
  framework: 'openai-assistants',
  environment: 'production',
  auditLevel: 'full',
  policy: {
    agentId: 'procurement-agent-v1',
    version: '1.0.0',
    policyHash: 'sha256-abc123',
    identity: { org: 'acme-corp', env: 'production' },
    allow: [
      { tool: 'read_*' },
      {
        tool: 'process_payment',
        conditions: [
          { field: 'intent.args.amount', operator: 'lte', value: 10000 },
        ],
      },
    ],
    deny: [
      { tool: 'process_payment',
        conditions: [
          { field: 'intent.args.amount', operator: 'gt', value: 10000 },
        ],
      },
    ],
    anomalyThresholds: { alert: 0.6, throttle: 0.8 },
    localAutonomy: { gracePeriodMs: 1800000, postGrace: 'PAUSE' },
  },
  onViolation: (intent, result) => {
    console.error(`[BLOCKED] ${intent.toolName} — ${result.reason}`);
  },
});

// Intercept tool calls before execution
const { allowed, blocked } = await agent.openai.interceptToolCalls(
  response.tool_calls
);

// Execute only the allowed ones
for (const toolCall of allowed) {
  // run your tool
}
```

---

## Quickstart — LangChain

```typescript
const mandateHook = agent.langchain.getBeforeToolCallHook();

// Attach to your LangChain agent
yourLangChainAgent.beforeToolCall = mandateHook;
// Mandate now enforces policy on every tool call automatically
```

---

## Quickstart — Anthropic

```typescript
const { allowed, blocked } = await agent.anthropic.interceptToolUse(
  response.content.filter(b => b.type === 'tool_use')
);
```

---

## How It Works

Modern agent frameworks declare intent as structured data before any tool executes.  
Mandate intercepts that declaration and evaluates it against your policy in **0.3–0.8ms**.  
No LLM involved in enforcement. Deterministic. Hardware-agnostic.

Agent reasons → LLM produces tool call → MANDATE INTERCEPTS
→ WASM policy evaluation (0.3–0.8ms)
→ ALLOW / DENY / ESCALATE
→ Audit event sealed to hash chain
→ Tool executes (if allowed)

---

## Framework Support

| Framework | Hook | Enforcement |
|-----------|------|-------------|
| OpenAI Assistants API | `agent.openai.interceptToolCalls()` | Full |
| LangChain / LangGraph | `agent.langchain.getBeforeToolCallHook()` | Full |
| Anthropic Tool Use | `agent.anthropic.interceptToolUse()` | Full |
| AutoGen / AG2 | Coming Month 2 | Full |
| Custom frameworks | `agent.evaluate(intent)` | Full |

---

## Audit Chain

Every action is sealed to a cryptographic hash chain before any network transmission.  
The audit record exists regardless of Mandate's availability.

```typescript
// Verify chain integrity — any tampering is detectable
const { valid, corruptedAt } = agent.verifyAuditChain();

// Flush buffer to control plane
await agent.flushAuditBuffer();
```

---

## Degradation

Mandate never becomes a single point of failure.  
If the control plane is unreachable, agents continue on their last signed policy for 30 minutes.

| Tier | State | Agent Status |
|------|-------|-------------|
| NOMINAL | Full enforcement | Full capacity |
| DEGRADED | Local cache | Full capacity |
| ISOLATED | No control plane | Full capacity |
| GRACE_STD | 30min elapsed | Continues |
| GRACE_HIGH | 30min elapsed, high risk | PAUSE |

---

## License

MIT — the SDK is free and open source forever.  
The control plane, fleet management, and kill switch infrastructure are commercial products.

---

## Company

Mandate is building the trust infrastructure for the agent economy.  
[mandate.dev](https://mandate.dev) · [GitHub](https://github.com/Bieliliber/mandate)