// @ts-check
/**
 * @module copilot/boot/surface-validation
 * @file Validação das superfícies mínimas que precisam estar carregadas antes do terminal abrir HTTP/REPL.
 */

/**
 * @typedef {'core' | 'sdk' | 'agent' | 'terminal' | 'phaseHandlers'} CopilotBootSurfaceGroupName
 *
 * @typedef {{
 *     name: CopilotBootSurfaceGroupName;
 *     expected: string[];
 *     available: string[];
 *     missing: string[];
 *     ok: boolean;
 * }} CopilotBootSurfaceGroupReport
 *
 *
 * @typedef {{
 *     ok: boolean;
 *     checkedAt: number;
 *     groups: CopilotBootSurfaceGroupReport[];
 *     missing: string[];
 * }} CopilotBootSurfaceValidationReport
 */

export const COPILOT_BOOT_REQUIRED_SURFACES = Object.freeze({
    core: Object.freeze([
        'runShutdown',
        'isShuttingDown',
        'getLastShutdownReport',
        'getShutdownLifecycleMetrics',
        'listShutdownHandlers',
        'registerTimer',
        'listActiveTimers',
        'activeTimerCount',
    ]),
    sdk: Object.freeze([
        'createCopilotClient',
        'checkAuthStatus',
        'createSession',
        'resumeSession',
        'sendSessionAndWait',
        'waitForEvent',
        'listAvailableModels',
        'getSessionCapabilities',
        'sessionUiConfirm',
        'shellExec',
        'modelSwitchTo',
        'SdkOperationError',
    ]),
    agent: Object.freeze([
        'AlwaysAliveAgent',
        'alwaysAliveAgent',
        'getAgent',
        'readAgentRuntimeStatusSnapshot',
        'readAgentRuntimeHealthSnapshot',
        'readAgentRuntimeSdkResourceSnapshot',
        'readAgentRuntimeCapabilities',
        'readRuntimeControlState',
        'readRuntimeInteractionState',
        'readRuntimePrBudgetSnapshot',
        'persistAgentRuntimePendingQuestionState',
        'classifyAgentError',
        'startRuntime',
        'startAgentDialogLoop',
        'sendAgentDialogTurn',
        'ALWAYS_ALIVE_AGENT',
    ]),
    terminal: Object.freeze([
        'createTerminalBootContext',
        'runTerminalInitPhase',
        'runTerminalAliasesPhase',
        'runTerminalRuntimeConfigPhase',
        'runTerminalPinnedContextPhase',
        'runTerminalConversationHubPhase',
        'runTerminalHttpServerPhase',
        'runTerminalRuntimeListenersPhase',
        'runTerminalReplPhase',
        'rollbackTerminalPinnedContextPhase',
        'rollbackTerminalHttpServerPhase',
        'rollbackTerminalRuntimeListenersPhase',
        'startTerminalServer',
    ]),
});

/**
 * Valida superfícies carregadas do SDK/agent/terminal e a cobertura dos phase handlers do boot plan.
 *
 * @param {{
 *     core: Record<string, unknown>;
 *     sdk: Record<string, unknown>;
 *     agent: Record<string, unknown>;
 *     terminal: Record<string, unknown>;
 *     plan?: { phases?: { id: string }[] } | null;
 *     phaseHandlers?: Record<string, unknown> | null;
 * }} input
 * @returns {CopilotBootSurfaceValidationReport}
 */
export function validateCopilotBootSurfaces(input) {
    const groups = [
        buildSurfaceGroupReport('core', input.core, COPILOT_BOOT_REQUIRED_SURFACES.core),
        buildSurfaceGroupReport('sdk', input.sdk, COPILOT_BOOT_REQUIRED_SURFACES.sdk),
        buildSurfaceGroupReport('agent', input.agent, COPILOT_BOOT_REQUIRED_SURFACES.agent),
        buildSurfaceGroupReport('terminal', input.terminal, COPILOT_BOOT_REQUIRED_SURFACES.terminal),
        buildPhaseHandlerGroupReport(input.plan, input.phaseHandlers),
    ];
    const missing = groups.flatMap((group) => group.missing.map((name) => `${group.name}.${name}`));
    return {
        ok: missing.length === 0,
        checkedAt: Date.now(),
        groups,
        missing,
    };
}

/**
 * Valida e lança erro com mensagem direta quando alguma superfície crítica não está carregada.
 *
 * @param {Parameters<typeof validateCopilotBootSurfaces>[0]} input
 * @returns {CopilotBootSurfaceValidationReport}
 */
export function assertCopilotBootSurfaces(input) {
    const report = validateCopilotBootSurfaces(input);
    if (!report.ok) {
        throw new Error(`[boot/surface-validation] superfícies incompletas: ${report.missing.join(', ')}`);
    }
    return report;
}

/**
 * @param {CopilotBootSurfaceGroupName} name
 * @param {Record<string, unknown>} surface
 * @param {readonly string[]} expected
 * @returns {CopilotBootSurfaceGroupReport}
 */
function buildSurfaceGroupReport(name, surface, expected) {
    const available = expected.filter((key) => surface[key] !== undefined);
    const missing = expected.filter((key) => surface[key] === undefined);
    return {
        name,
        expected: [...expected],
        available,
        missing,
        ok: missing.length === 0,
    };
}

/**
 * @param {{ phases?: { id: string }[] } | null | undefined} plan
 * @param {Record<string, unknown> | null | undefined} phaseHandlers
 * @returns {CopilotBootSurfaceGroupReport}
 */
function buildPhaseHandlerGroupReport(plan, phaseHandlers) {
    const expected = (plan?.phases ?? []).map((phase) => phase.id);
    const available = expected.filter((phaseId) => phaseHandlers?.[phaseId] !== undefined);
    const missing = expected.filter((phaseId) => phaseHandlers?.[phaseId] === undefined);
    return {
        name: 'phaseHandlers',
        expected,
        available,
        missing,
        ok: missing.length === 0,
    };
}
