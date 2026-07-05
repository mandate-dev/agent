// Type declarations for the compiled WASM evaluator.
// This placeholder is overwritten by the real wasm-pack output via CI.
// Enables TypeScript type checking before first WASM build.

/** Evaluate a tool call intent against a policy. Returns JSON string. */
export function evaluate(policy_json: string, intent_json: string): string;

/** Returns the evaluator version string — confirms WASM is loaded. */
export function version(): string;

export default function init(): Promise<unknown>;