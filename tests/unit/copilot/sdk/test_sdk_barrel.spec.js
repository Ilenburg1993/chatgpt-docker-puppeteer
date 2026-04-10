// @ts-check
import { describe, expect, it, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────

vi.mock('@github/copilot-sdk', () => {
    const SYSTEM_PROMPT_SECTIONS = Object.freeze({
        identity: 'identity',
        tone: 'tone',
        tool_efficiency: 'tool_efficiency',
        environment_context: 'environment_context',
        code_change_rules: 'code_change_rules',
        guidelines: 'guidelines',
        safety: 'safety',
        instructions: 'instructions',
        docs: 'docs',
        context: 'context',
    });
    return {
        SYSTEM_PROMPT_SECTIONS,
        CopilotClient: vi.fn(),
        defineTool: vi.fn(),
        approveAll: vi.fn(),
    };
});

vi.mock('#copilot/core/errors', () => ({
    ConfigError: class ConfigError extends Error {
        /** @param {string} msg */
        constructor(msg) {
            super(msg);
            this.name = 'ConfigError';
        }
    },
    CopilotError: class CopilotError extends Error {
        /** @param {string} msg */
        constructor(msg) {
            super(msg);
            this.name = 'CopilotError';
        }
    },
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

// ═════════════════════════════════════════════════════════════════════════════
// F86 - Barrel completeness: all module groups
// ═════════════════════════════════════════════════════════════════════════════

describe('F86 - Barrel complete export coverage', () => {
    /** @type {Record<string, unknown>} */
    let barrel;

    it('barrel loads without error', async () => {
        barrel = await import('#copilot/sdk/index.js');
        expect(barrel).toBeDefined();
    });

    // ─── client.js ─────────────────────────────────────────────────────
    it('exports all client.js functions', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'getClient',
            'buildClientOptions',
            'createClientSession',
            'deleteClientSession',
            'disconnectClientSession',
            'forceStopClient',
            'getActiveSessionCount',
            'getAuthStatus',
            'getClientSession',
            'getClientState',
            'getClientStatus',
            'incrementSessionMessageCount',
            'listActiveClientSessions',
            'listAllClientSessions',
            'listAvailableModels',
            'pingClient',
            'resumeClientSession',
            'stopClient',
            '_injectClientForTest',
            '_resetClientState',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── session.js ────────────────────────────────────────────────────
    it('exports all session.js functions', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'createClientFromCliUrl',
            'createSession',
            'deleteSession',
            'disconnectSession',
            'listSessions',
            'resumeOrCreate',
            'resumeSession',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── constants.js (F1) ─────────────────────────────────────────────
    it('exports all constants.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'CONNECTION_STATES',
            'INFINITE_SESSION_DEFAULTS',
            'PERMISSION_RESULTS',
            'PROVIDER_TYPES',
            'REASONING_EFFORTS',
            'SECTION_ACTIONS',
            'SESSION_EVENTS',
            'SESSION_LIFECYCLE_EVENTS',
            'SESSION_MODES',
            'SYSTEM_PROMPT_SECTION_NAMES',
            'TOOL_RESULT_TYPES',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── tools.js + permissions.js (F2) ────────────────────────────────
    it('exports tools.js and permissions.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = ['createTool', 'createToolSync', 'defineTool', 'approveAll', 'createAllowlistPermissionHandler'];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── system-message.js (F3) ────────────────────────────────────────
    it('exports system-message.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'SYSTEM_PROMPT_SECTIONS',
            'appendSystemMessage',
            'appendToGuidelines',
            'customizeSystemMessage',
            'getSectionDescription',
            'getSectionNames',
            'replaceIdentity',
            'replaceSystemMessage',
            'sectionOverride',
            'supportsCustomizeMode',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── config.js (F4) ───────────────────────────────────────────────
    it('exports config.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'DEFAULT_DIAGNOSTIC_MODEL',
            'DEFAULT_EXCLUDED_TOOLS',
            'DEFAULT_INFINITE_SESSION',
            'DEFAULT_MODEL',
            'buildAlwaysAliveConfig',
            'buildDiagnosticConfig',
            'buildFullAccessConfig',
            'buildReadOnlyConfig',
            'buildSessionConfig',
            'getProjectDefaults',
            'mergeExcludedTools',
            'mergeTools',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── client-facade.js (F5) ─────────────────────────────────────────
    it('exports client-facade.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'ensureClient',
            'isClientReady',
            'quickDisconnect',
            'quickResume',
            'quickSession',
            'shutdownClient',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── session-lifecycle.js (F6) ─────────────────────────────────────
    it('exports session-lifecycle.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'abortSession',
            'disposeSession',
            'getSessionMessages',
            'getSessionWorkspacePath',
            'runSessionLifecycle',
            'setSessionModel',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── rpc.js (F7+F8) ───────────────────────────────────────────────
    it('exports rpc.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'commandsHandlePending',
            'compactionCompact',
            'createSessionRpcFacade',
            'modeGet',
            'modeSet',
            'modelGetCurrent',
            'modelSwitchTo',
            'permissionsHandlePending',
            'planDelete',
            'planRead',
            'planUpdate',
            'sessionLog',
            'shellExec',
            'shellKill',
            'toolsHandlePendingCall',
            'uiElicitation',
            'workspaceCreateFile',
            'workspaceListFiles',
            'workspaceReadFile',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── server-rpc.js + health.js (F9) ───────────────────────────────
    it('exports server-rpc.js and health.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'accountGetQuota',
            'createServerRpcFacade',
            'modelsList',
            'ping',
            'toolsList',
            'fullHealthCheck',
            'getQuota',
            'healthGetAuthStatus',
            'isServerReachable',
            'pingCheck',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── events.js (F10) ──────────────────────────────────────────────
    it('exports events.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'ALL_EVENT_TYPES',
            'createEventFilter',
            'getEventPayload',
            'getEventType',
            'isKnownEventType',
            'onAllSessionEvents',
            'onSessionEvent',
            'onSessionEvents',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── client-events.js (F11) ───────────────────────────────────────
    it('exports client-events.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'LIFECYCLE_EVENTS',
            'isLifecycleEventType',
            'onAllLifecycleEvents',
            'onLifecycleEvent',
            'onLifecycleEvents',
            'onSessionBackground',
            'onSessionCreated',
            'onSessionDeleted',
            'onSessionForeground',
            'onSessionUpdated',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── provider.js (F12) ────────────────────────────────────────────
    it('exports provider.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'anthropicProvider',
            'azureProvider',
            'isValidProviderType',
            'openaiProvider',
            'validateProviderConfig',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── telemetry.js (F13) ───────────────────────────────────────────
    it('exports telemetry.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'createFileTelemetry',
            'createOtlpTelemetry',
            'createStaticTraceProvider',
            'createTelemetryConfig',
            'getTraceContext',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── models/* (F14) ───────────────────────────────────────────────
    it('exports models/helpers.js and models/registry.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            // helpers
            'buildReasoningConfig',
            'filterEnabledModels',
            'filterModels',
            'filterReasoningModels',
            'filterVisionModels',
            'getBillingMultiplier',
            'getContextWindowSize',
            'getDefaultReasoningEffort',
            'getMaxContextTokens',
            'getMaxPromptTokens',
            'getModelById',
            'getSupportedReasoningEfforts',
            'getVisionMediaTypes',
            'hasVision',
            'indexModelsById',
            'isModelEnabled',
            'listModels',
            'pickModel',
            'resolveModelId',
            'supportsReasoning',
            // registry
            'AutoDowngradeDetector',
            'ModelRegistry',
            'ModelSelector',
            'ModelStatsTracker',
            'autoDowngradeDetector',
            'modelRegistry',
            'modelSelector',
            'modelStatsTracker',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    // ─── agents.js (F15) ──────────────────────────────────────────────
    it('exports agents.js', async () => {
        barrel = barrel ?? (await import('#copilot/sdk/index.js'));
        const names = [
            'READ_ONLY_TOOLS',
            'buildAgentList',
            'createAgent',
            'createAnalystAgent',
            'createFullAccessAgent',
            'createReadOnlyAgent',
            'deselectAgent',
            'filterInferableAgents',
            'getCurrentAgent',
            'isValidAgentName',
            'listAgents',
            'reloadAgents',
            'selectAgent',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F87 - Tree-shaking: selective imports resolve correctly
// ═════════════════════════════════════════════════════════════════════════════

describe('F87 - Tree-shaking import validation', () => {
    it('import seletivo de createTool funciona', async () => {
        const { createTool } = await import('#copilot/sdk/index.js');
        expect(typeof createTool).toBe('function');
    });

    it('import seletivo de constantes funciona', async () => {
        const { SESSION_MODES, REASONING_EFFORTS } = await import('#copilot/sdk/index.js');
        expect(SESSION_MODES).toBeDefined();
        expect(REASONING_EFFORTS).toBeDefined();
    });

    it('import seletivo de RPC funciona', async () => {
        const { modelGetCurrent, modeSet } = await import('#copilot/sdk/index.js');
        expect(typeof modelGetCurrent).toBe('function');
        expect(typeof modeSet).toBe('function');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F88 - tools-registry.js deprecation (still accessible via barrel)
// ═════════════════════════════════════════════════════════════════════════════

describe('F88 - tools-registry.js backward-compat', () => {
    it('createRegistry ainda acessivel via barrel', async () => {
        const { createRegistry } = await import('#copilot/sdk/index.js');
        expect(typeof createRegistry).toBe('function');
    });

    it('registerTools ainda acessivel via barrel', async () => {
        const { registerTools, getAllTools } = await import('#copilot/sdk/index.js');
        expect(typeof registerTools).toBe('function');
        expect(typeof getAllTools).toBe('function');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F16 - New module exports (custom-tools, tools-state)
// ═════════════════════════════════════════════════════════════════════════════

describe('F16 - Newly added module exports', () => {
    it('exports custom-tools.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        const names = [
            'BUILTIN_HANDLER_MAP',
            'buildCustomTools',
            'getCustomToolDefinitions',
            'loadCustomTools',
            'loadCustomToolsAsync',
            'registerCustomTool',
            'removeCustomTool',
            '_resetCustomToolsRegistry',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    it('exports tools-state.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        const names = ['getToolsConfig', 'loadToolsConfig', 'loadToolsConfigAsync', 'patchToolsConfig'];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// F89 - Utility module exports
// ═════════════════════════════════════════════════════════════════════════════

describe('F89 - Utility and helper exports', () => {
    it('exports event-helpers.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        expect(typeof barrel.raceEvents).toBe('function');
        expect(typeof barrel.waitForEvent).toBe('function');
    });

    it('exports http-request.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        expect(typeof barrel.httpRequest).toBe('function');
    });

    it('exports url-validator.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        expect(typeof barrel.validateUrl).toBe('function');
        expect(typeof barrel.validateUrlString).toBe('function');
    });

    it('exports utils.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        expect(typeof barrel.pickDefined).toBe('function');
    });

    it('exports hooks/factory.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        const names = [
            'composePreToolUseHandlers',
            'createAuditHooks',
            'createDenyAllHooks',
            'createErrorNotifierHook',
            'createHooks',
            'createMinimalHooks',
            'createSafeHooks',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });

    it('exports hooks/permission.js', async () => {
        const barrel = await import('#copilot/sdk/index.js');
        const names = [
            'createApproveAllPermission',
            'createAuditOnlyPermission',
            'createPermissionHandler',
            'createRestrictedPermission',
            'createSafePermission',
        ];
        for (const n of names) expect(barrel[n], `missing: ${n}`).toBeDefined();
    });
});
