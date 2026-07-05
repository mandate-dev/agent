// ============================================================
// MANDATE EVALUATOR — Rust → WASM
// Deterministic policy evaluation compiled to WebAssembly.
// This is the tamper-proof enforcement core.
//
// Called from the TypeScript SDK via wasm-bindgen.
// Input: policy JSON + intent JSON
// Output: evaluation result JSON
// ============================================================

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
struct PolicyCondition {
    field: String,
    operator: String,
    value: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct PolicyRule {
    tool: String,
    #[serde(default)]
    conditions: Vec<PolicyCondition>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct MandatePolicy {
    agent_id: String,
    version: String,
    policy_hash: String,
    allow: Vec<PolicyRule>,
    deny: Vec<PolicyRule>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IntentContext {
    agent_id: String,
    session_id: String,
    environment: String,
    step_in_chain: u32,
    framework: String,
    timestamp: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AgentIntent {
    tool_name: String,
    args: serde_json::Value,
    context: IntentContext,
}

#[derive(Serialize, Deserialize, Debug)]
struct EvaluationResult {
    decision: String,
    reason: String,
    latency_ms: f64,
    rule_matched: Option<String>,
    anomaly_score: f64,
}

// ── Public WASM API ────────────────────────────────────────

/// Evaluate a tool call intent against a policy.
/// Called from TypeScript: evaluate(policyJson, intentJson) → resultJson
#[wasm_bindgen]
pub fn evaluate(policy_json: &str, intent_json: &str) -> String {
    let result = evaluate_internal(policy_json, intent_json);
    serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"decision":"DENY","reason":"Evaluator serialization error","latency_ms":0,"anomaly_score":0}"#
            .to_string()
    })
}

/// Returns the evaluator version — used by SDK to confirm WASM is loaded
#[wasm_bindgen]
pub fn version() -> String {
    "mandate-evaluator/0.1.0/wasm".to_string()
}

// ── Core Logic ─────────────────────────────────────────────

fn evaluate_internal(policy_json: &str, intent_json: &str) -> EvaluationResult {
    let policy: MandatePolicy = match serde_json::from_str(policy_json) {
        Ok(p) => p,
        Err(e) => {
            return EvaluationResult {
                decision: "DENY".to_string(),
                reason: format!("Invalid policy JSON: {}", e),
                latency_ms: 0.0,
                rule_matched: None,
                anomaly_score: 0.0,
            }
        }
    };

    let intent: AgentIntent = match serde_json::from_str(intent_json) {
        Ok(i) => i,
        Err(e) => {
            return EvaluationResult {
                decision: "DENY".to_string(),
                reason: format!("Invalid intent JSON: {}", e),
                latency_ms: 0.0,
                rule_matched: None,
                anomaly_score: 0.0,
            }
        }
    };

    // Deny rules checked first — safety before capability
    for rule in &policy.deny {
        if matches_rule(&intent, rule) {
            return EvaluationResult {
                decision: "DENY".to_string(),
                reason: format!(
                    "Tool '{}' matched deny rule '{}'",
                    intent.tool_name, rule.tool
                ),
                latency_ms: 0.0,
                rule_matched: Some(rule.tool.clone()),
                anomaly_score: 0.0,
            };
        }
    }

    // Allow rules checked next
    for rule in &policy.allow {
        if matches_rule(&intent, rule) {
            return EvaluationResult {
                decision: "ALLOW".to_string(),
                reason: format!(
                    "Tool '{}' matched allow rule '{}'",
                    intent.tool_name, rule.tool
                ),
                latency_ms: 0.0,
                rule_matched: Some(rule.tool.clone()),
                anomaly_score: 0.0,
            };
        }
    }

    // Default deny — no allow rule matched
    EvaluationResult {
        decision: "DENY".to_string(),
        reason: format!(
            "Tool '{}' did not match any allow rule (default deny)",
            intent.tool_name
        ),
        latency_ms: 0.0,
        rule_matched: None,
        anomaly_score: 0.0,
    }
}

// ── Rule Matching ──────────────────────────────────────────

fn matches_rule(intent: &AgentIntent, rule: &PolicyRule) -> bool {
    if !wildcard_match(&intent.tool_name, &rule.tool) {
        return false;
    }
    for condition in &rule.conditions {
        if !evaluate_condition(&intent.args, condition) {
            return false;
        }
    }
    true
}

/// Wildcard matching: "read_*", "*", "delete_records"
fn wildcard_match(text: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern == text {
        return true;
    }
    if pattern.ends_with('*') && !pattern.starts_with('*') {
        let prefix = &pattern[..pattern.len() - 1];
        return text.starts_with(prefix);
    }
    if pattern.starts_with('*') && !pattern.ends_with('*') {
        let suffix = &pattern[1..];
        return text.ends_with(suffix);
    }
    false
}

fn evaluate_condition(args: &serde_json::Value, condition: &PolicyCondition) -> bool {
    let field_path = condition.field.replace("intent.args.", "");
    let value = match resolve_field(args, &field_path) {
        Some(v) => v,
        None => return false,
    };

    match condition.operator.as_str() {
        "eq" => value == &condition.value,
        "neq" => value != &condition.value,
        "lt" => compare_numbers(value, &condition.value, |a, b| a < b),
        "lte" => compare_numbers(value, &condition.value, |a, b| a <= b),
        "gt" => compare_numbers(value, &condition.value, |a, b| a > b),
        "gte" => compare_numbers(value, &condition.value, |a, b| a >= b),
        "in" => condition
            .value
            .as_array()
            .map(|arr| arr.contains(value))
            .unwrap_or(false),
        "nin" => condition
            .value
            .as_array()
            .map(|arr| !arr.contains(value))
            .unwrap_or(true),
        "startsWith" => {
            let s = value.as_str().unwrap_or("");
            let prefix = condition.value.as_str().unwrap_or("");
            s.starts_with(prefix)
        }
        "endsWith" => {
            let s = value.as_str().unwrap_or("");
            let suffix = condition.value.as_str().unwrap_or("");
            s.ends_with(suffix)
        }
        "contains" => {
            let s = value.as_str().unwrap_or("");
            let needle = condition.value.as_str().unwrap_or("");
            s.contains(needle)
        }
        _ => false,
    }
}

fn resolve_field<'a>(args: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut current = args;
    for part in parts {
        current = current.get(part)?;
    }
    Some(current)
}

fn compare_numbers(
    a: &serde_json::Value,
    b: &serde_json::Value,
    cmp: impl Fn(f64, f64) -> bool,
) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(a), Some(b)) => cmp(a, b),
        _ => false,
    }
}

// ── Tests ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_policy(allow: &[&str], deny: &[&str]) -> String {
        let allow_rules: Vec<String> = allow
            .iter()
            .map(|t| format!(r#"{{"tool":"{}"}}"#, t))
            .collect();
        let deny_rules: Vec<String> = deny
            .iter()
            .map(|t| format!(r#"{{"tool":"{}"}}"#, t))
            .collect();
        format!(
            r#"{{"agent_id":"test","version":"1.0","policy_hash":"abc","allow":[{}],"deny":[{}]}}"#,
            allow_rules.join(","),
            deny_rules.join(",")
        )
    }

    fn make_intent(tool: &str) -> String {
        format!(
            r#"{{"tool_name":"{}","args":{{}},"context":{{"agent_id":"test","session_id":"s1","environment":"production","step_in_chain":0,"framework":"openai","timestamp":1700000000000}}}}"#,
            tool
        )
    }

    #[test]
    fn test_deny_wildcard() {
        let policy = make_policy(&["read_*"], &["delete_*"]);
        let intent = make_intent("delete_records");
        let result: EvaluationResult = serde_json::from_str(&evaluate(&policy, &intent)).unwrap();
        assert_eq!(result.decision, "DENY");
        assert!(result.rule_matched.as_deref() == Some("delete_*"));
    }

    #[test]
    fn test_allow_wildcard() {
        let policy = make_policy(&["read_*"], &["delete_*"]);
        let intent = make_intent("read_document");
        let result: EvaluationResult = serde_json::from_str(&evaluate(&policy, &intent)).unwrap();
        assert_eq!(result.decision, "ALLOW");
    }

    #[test]
    fn test_default_deny() {
        let policy = make_policy(&["read_*"], &["delete_*"]);
        let intent = make_intent("send_email");
        let result: EvaluationResult = serde_json::from_str(&evaluate(&policy, &intent)).unwrap();
        assert_eq!(result.decision, "DENY");
        assert!(result.rule_matched.is_none());
    }

    #[test]
    fn test_deny_takes_priority_over_allow() {
        // A tool matching both deny and allow — deny wins
        let policy = make_policy(&["*"], &["delete_*"]);
        let intent = make_intent("delete_everything");
        let result: EvaluationResult = serde_json::from_str(&evaluate(&policy, &intent)).unwrap();
        assert_eq!(result.decision, "DENY");
    }

    #[test]
    fn test_amount_condition_allow() {
        let policy = r#"{
            "agent_id":"test","version":"1.0","policy_hash":"abc",
            "allow":[{"tool":"process_payment","conditions":[{"field":"amount","operator":"lte","value":10000}]}],
            "deny":[]
        }"#;
        let intent = r#"{
            "tool_name":"process_payment","args":{"amount":5000},
            "context":{"agent_id":"test","session_id":"s1","environment":"production","step_in_chain":0,"framework":"openai","timestamp":1700000000000}
        }"#;
        let result: EvaluationResult = serde_json::from_str(&evaluate(policy, intent)).unwrap();
        assert_eq!(result.decision, "ALLOW");
    }

    #[test]
    fn test_amount_condition_deny() {
        let policy = r#"{
            "agent_id":"test","version":"1.0","policy_hash":"abc",
            "allow":[{"tool":"process_payment","conditions":[{"field":"amount","operator":"lte","value":10000}]}],
            "deny":[]
        }"#;
        let intent = r#"{
            "tool_name":"process_payment","args":{"amount":50000},
            "context":{"agent_id":"test","session_id":"s1","environment":"production","step_in_chain":0,"framework":"openai","timestamp":1700000000000}
        }"#;
        let result: EvaluationResult = serde_json::from_str(&evaluate(policy, intent)).unwrap();
        assert_eq!(result.decision, "DENY");
    }

    #[test]
    fn test_version() {
        assert!(version().contains("wasm"));
    }
}