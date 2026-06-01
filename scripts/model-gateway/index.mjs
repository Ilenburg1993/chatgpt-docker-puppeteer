import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_GATEWAY_SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(MODEL_GATEWAY_SCRIPT_DIR, '../..');

export const MODEL_GATEWAY_SCRIPT_PATHS = Object.freeze({
    autoStatus: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-auto-status.mjs'),
    canonicalCommands: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-canonical-commands.mjs'),
    catalogIntegrity: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-catalog-integrity.mjs'),
    effectiveSelection: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-effective-selection.mjs'),
    livePlan: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-live-plan.mjs'),
    liveReadiness: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-live-readiness.mjs'),
    llmBLiveTest: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-terminal-llm-b-live-test.mjs'),
    metadataBuild: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-metadata-build.mjs'),
    ops: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-ops.mjs'),
    redactionAudit: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-redaction-audit.mjs'),
    refresh: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-refresh.mjs'),
    refreshLog: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-refresh-log.mjs'),
    runtimeHealthDiff: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-runtime-health-diff.mjs'),
    runtimeHealthMirror: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-runtime-health-mirror.mjs'),
    runtimeSelector: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-runtime-selector.mjs'),
    selectionAudit: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-selection-audit.mjs'),
    selectionTraceDiff: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-selection-trace-diff.mjs'),
    sqliteDiagnostics: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-sqlite-diagnostics.mjs'),
    sqliteRetention: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'model-gateway-sqlite-retention.mjs'),
});

export const COPILOT_TERMINAL_LLM_B_LIVE_TEST_PATH = MODEL_GATEWAY_SCRIPT_PATHS.llmBLiveTest;

/**
 * @param {keyof typeof MODEL_GATEWAY_SCRIPT_PATHS} scriptId
 * @returns {string}
 */
export function modelGatewayScriptPath(scriptId) {
    return MODEL_GATEWAY_SCRIPT_PATHS[scriptId];
}
