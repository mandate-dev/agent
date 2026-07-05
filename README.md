# Mandate Agent SDK

**Policy enforcement and kill switch for AI agents.**

Your AI agents are making decisions you cannot stop. Mandate intercepts every tool call before it executes, enforces your policy in real time, and gives you a kill switch for the entire fleet.

For CTOs running AI agents who need more than 20% autonomy — without losing control.

---

## Install

```bash
# TypeScript / JavaScript
npm install @mandatedev/agent

# Python
pip install mandatedev-agent
```

---

## What it does

1. **Intercepts** every tool call your agent makes — before execution
2. **Evaluates** the call against your policy in 0.4ms (compiled Rust/WASM, no LLM in the path)
3. **Allows, denies, or escalates** based on your rules
4. **Seals** every decision to a cryptographic hash chain — EU AI Act Article 12 compliant
5. **Reports** everything live to your War Room dashboard

---

## Quickstart — TypeScript (OpenAI)

```typescript
import { createMandateAgent } from '@mandatedev/agent';

const agent = createMandateAgent({
  agentId: 'procurement-agent-v1',
  orgId: 'your-org-id',
  apiKey: process.env.MANDATE_API_KEY,
  controlPlaneUrl: process.env.MANDATE_URL,
  framework: 'openai-assistants',
  environment: 'production',
  auditLevel: 'full',
  policy: {
    agentId: 'procurement-agent-v1',
    version: '1.0.0',
    policyHash: 'sha256-abc123',
    allow: [
      { tool: 'read_*' },
      {
        tool: 'process_payment',
        conditions: [
          { field: 'amount', operator: 'lte', value: 10000 },
          { field: 'currency', operator: 'eq', value: 'USD' },
        ],
      },
    ],
    deny: [
      { tool: 'delete_*' },
      { tool: 'db_query' },
    ],
  },
});

// Intercept tool calls before execution
const { allowed, blocked } = await agent.openai.interceptToolCalls(response.tool_calls);

// Execute only what was allowed
for (const toolCall of allowed) {
  // run tool
}
```

---

## Quickstart — TypeScript (LangChain)

```typescript
import { createMandateAgent } from '@mandatedev/agent';

const mandateAgent = createMandateAgent({ /* config */ });

// Pattern 1 — Zero config callback handler
const handler = mandateAgent.langchain.createCallbackHandler();
await agentExecutor.invoke(input, { callbacks: [handler] });

// Pattern 2 — Wrap all tools at once
const safeTools = mandateAgent.langchain.wrapTools(tools);

// Pattern 3 — Wrap individual tools
const safeTool = mandateAgent.langchain.wrapTool(myTool);
```

---

## Quickstart — TypeScript (Anthropic)

```typescript
import { createMandateAgent } from '@mandatedev/agent';

const mandateAgent = createMandateAgent({ /* config */ });

const { allowed, blocked } = await mandateAgent.anthropic.interceptToolCalls(
  response.content.filter(b => b.type === 'tool_use')
);
```

---

## Quickstart — Python (AutoGen)

```python
from mandate_agent import create_mandate_agent, MandateConfig, MandatePolicy, PolicyRule

agent = create_mandate_agent(MandateConfig(
    agent_id="procurement-agent-v1",
    org_id="your-org-id",
    api_key="mdt_...",
    control_plane_url="https://your-control-plane",
    framework="autogen",
    environment="production",
    audit_level="full",
    policy=MandatePolicy(
        agent_id="procurement-agent-v1",
        version="1.0.0",
        policy_hash="sha256-abc123",
        allow=[
            PolicyRule(tool="read_*"),
            PolicyRule(tool="search_web"),
        ],
        deny=[
            PolicyRule(tool="delete_*"),
            PolicyRule(tool="db_query"),
        ],
    )
))

# Wrap your AutoGen tools
safe_tools = agent.autogen.wrap_tools([search_web, read_file])

# Or use as decorator
@agent.autogen.wrap_tool
async def search_web(query: str) -> str:
    ...
```

---

## Policy Language

```typescript
policy: {
  allow: [
    { tool: 'read_*' },
    {
      tool: 'process_payment',
      conditions: [
        { field: 'amount', operator: 'lte', value: 10000 },
        { field: 'currency', operator: 'eq', value: 'USD' },
        { field: 'vendor_id', operator: 'in', value: approvedVendors },
      ],
    },
  ],
  deny: [
    { tool: 'delete_*' },
    { tool: 'db_query' },
  ],
}
```

**Supported operators:** `eq` `neq` `lt` `lte` `gt` `gte` `in` `nin` `startsWith` `endsWith` `contains`

---

## Framework Support

| Framework | Language | Hook | Status |
|-----------|----------|------|--------|
| OpenAI Assistants | TypeScript | `agent.openai.interceptToolCalls()` | ✅ Full |
| LangChain / LangGraph | TypeScript | `agent.langchain.wrapTools()` | ✅ Full |
| Anthropic Tool Use | TypeScript | `agent.anthropic.interceptToolCalls()` | ✅ Full |
| AutoGen 0.4+ | Python | `agent.autogen.wrap_tools()` | ✅ Full |
| Custom frameworks | Any | `agent.evaluate(intent)` | ✅ Full |

---

## Cryptographic Audit Chain

```typescript
const { valid } = agent.verifyAuditChain();
const events = await agent.flushAuditBuffer();
```

Every decision sealed to SHA-256. EU AI Act Article 12 compliant.

---

## Degradation Model

| Tier | State | Agent Behavior |
|------|-------|----------------|
| NOMINAL | Connected | Full WASM enforcement |
| DEGRADED | Latency spike | Local cache, full enforcement |
| ISOLATED | No control plane | Local cache, full enforcement |
| GRACE_STD | 30min elapsed | Full capacity, alert sent |
| GRACE_HIGH | 30min elapsed, high risk | PAUSE |

---

## Get API Key

Sign up free at [getmandate.dev](https://getmandate.dev) — 3 agents, no credit card required.

---

## License

MIT — the SDK is free and open source forever.
The control plane, fleet management, and kill switch infrastructure are commercial products.

---

## Links

- **Website:** [getmandate.dev](https://getmandate.dev)
- **npm:** [@mandatedev/agent](https://www.npmjs.com/package/@mandatedev/agent)
- **PyPI:** [mandatedev-agent](https://pypi.org/project/mandatedev-agent/)
