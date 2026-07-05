# @mandatedev/agent — Python SDK

Trust Engine for the Agent Economy. Policy enforcement for AI agents.

## Install

```bash
pip install mandatedev-agent
```

## AutoGen Integration

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
        allow=[PolicyRule(tool="read_*"), PolicyRule(tool="search_web")],
        deny=[PolicyRule(tool="delete_*"), PolicyRule(tool="db_query")],
    )
))

# Wrap your AutoGen tools
safe_tools = agent.autogen.wrap_tools([search_web, read_file])
```

## License

MIT