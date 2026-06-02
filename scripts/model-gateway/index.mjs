import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_GATEWAY_SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const MODEL_GATEWAY_COMMAND_SCRIPT_DIR = path.join(MODEL_GATEWAY_SCRIPT_DIR, 'commands');
export const REPO_ROOT = path.resolve(MODEL_GATEWAY_SCRIPT_DIR, '../..');

export const MODEL_GATEWAY_SCRIPT_PATHS = Object.freeze({
    runner: path.join(MODEL_GATEWAY_SCRIPT_DIR, 'run.mjs'),
    autoStatus: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-status.mjs'),
    autoReady: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-ready.mjs'),
    autoDoctor: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-doctor.mjs'),
    autoExplain: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-explain.mjs'),
    autoHandoffs: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-handoffs.mjs'),
    autoConfirmations: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-confirmations.mjs'),
    autoRecoveries: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-recoveries.mjs'),
    autoProofPlan: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-proof-plan.mjs'),
    autoStandby: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-standby.mjs'),
    autoScenarios: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-auto-scenarios.mjs'),
    canonicalCommands: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-canonical-commands.mjs'),
    catalogIntegrity: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-catalog-integrity.mjs'),
    effectiveSelection: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-effective-selection.mjs'),
    livePlan: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-live-plan.mjs'),
    liveReadiness: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-live-readiness.mjs'),
    liveRuns: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-live-runs.mjs'),
    llmBLiveTest: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-terminal-llm-b-live-test.mjs'),
    metadataBuild: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-metadata-build.mjs'),
    ops: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-ops.mjs'),
    operatorReady: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-operator-ready.mjs'),
    redactionAudit: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-redaction-audit.mjs'),
    refresh: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-refresh.mjs'),
    refreshLog: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-refresh-log.mjs'),
    runtimeHealthDiff: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-runtime-health-diff.mjs'),
    runtimeHealthClear: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-runtime-health-clear.mjs'),
    runtimeHealthMirror: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-runtime-health-mirror.mjs'),
    runtimeSelector: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-runtime-selector.mjs'),
    selectionAudit: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-selection-audit.mjs'),
    selectionTraceDiff: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-selection-trace-diff.mjs'),
    sqliteDiagnostics: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-sqlite-diagnostics.mjs'),
    sqliteRetention: path.join(MODEL_GATEWAY_COMMAND_SCRIPT_DIR, 'model-gateway-sqlite-retention.mjs'),
});

export const COPILOT_TERMINAL_LLM_B_LIVE_TEST_PATH = MODEL_GATEWAY_SCRIPT_PATHS.llmBLiveTest;

export const MODEL_GATEWAY_SCRIPT_MANIFEST = Object.freeze(
    Object.entries(MODEL_GATEWAY_SCRIPT_PATHS).map(([id, scriptPath]) =>
        Object.freeze({
            id,
            role: id === 'runner' ? 'runner' : 'command',
            scriptPath,
            runnerCommand: id === 'runner' ? 'node scripts/model-gateway/run.mjs --help' : `node scripts/model-gateway/run.mjs ${id}`,
        }),
    ),
);

/**
 * @param {keyof typeof MODEL_GATEWAY_SCRIPT_PATHS} scriptId
 * @returns {string}
 */
export function modelGatewayScriptPath(scriptId) {
    return MODEL_GATEWAY_SCRIPT_PATHS[scriptId];
}
