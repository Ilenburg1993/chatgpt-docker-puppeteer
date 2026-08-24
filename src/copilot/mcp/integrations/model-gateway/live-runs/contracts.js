// @ts-check
/** Fixed command identities for governed Model Gateway / LLM-B live operations. */

export const MODEL_GATEWAY_LIVE_RUNNER_SCRIPT =
    'scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs';
export const MODEL_GATEWAY_LIVE_READINESS_SCRIPT = 'scripts/model-gateway/commands/model-gateway-live-readiness.mjs';
export const MODEL_GATEWAY_LIVE_RUNS_SCRIPT = 'scripts/model-gateway/commands/model-gateway-live-runs.mjs';

export const MODEL_GATEWAY_LIVE_COMMANDS = Object.freeze({
    readiness: MODEL_GATEWAY_LIVE_READINESS_SCRIPT,
    runs: MODEL_GATEWAY_LIVE_RUNS_SCRIPT,
    'live-runner': MODEL_GATEWAY_LIVE_RUNNER_SCRIPT,
});

/** @typedef {keyof typeof MODEL_GATEWAY_LIVE_COMMANDS} ModelGatewayLiveCommand */
