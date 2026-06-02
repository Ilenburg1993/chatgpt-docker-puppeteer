// @ts-check

import { describe, expect, it, vi } from 'vitest';

const defaultRuntime = /** @type {any} */ ({
    status: 'processing',
    model: 'gpt-5',
    reasoningEffort: 'high',
    dialogLoopActive: true,
    getStatusSnapshot: () => ({
        status: 'processing',
        model: 'gpt-5',
        reasoningEffort: 'high',
    }),
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'degraded',
        pendingQuestion: false,
        pendingQuestionKind: null,
        pendingQuestionShadow: true,
        pendingQuestionShadowKind: 'ready',
        pendingQuestionShadowState: 'expiring_soon',
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: 120000,
        pendingQuestionShadowRemainingMs: 15000,
        backgroundPendingCount: 4,
        issues: ['background.backlog_high', 'quota.monitor_missing'],
        recommendedAction: 'inspect_boot_report',
        checks: {
            io: { keepaliveRunning: false },
            quota: { running: false },
        },
    }),
});

const altRuntime = /** @type {any} */ ({
    status: 'idle',
    model: 'gpt-4.1-mini',
    reasoningEffort: 'medium',
    dialogLoopActive: false,
    getStatusSnapshot: () => ({
        status: 'idle',
        model: 'gpt-4.1-mini',
        reasoningEffort: 'medium',
    }),
    getHealthSnapshot: () => ({
        ok: true,
        healthy: true,
        status: 'healthy',
        pendingQuestion: false,
        pendingQuestionKind: null,
        pendingQuestionShadow: false,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowRemainingMs: null,
        backgroundPendingCount: 0,
        issues: [],
        recommendedAction: 'none',
        checks: {
            io: { keepaliveRunning: true },
            quota: { running: true },
        },
    }),
});

/**
 * @param {typeof defaultRuntime} runtime
 * @returns {{
 *     status: string;
 *     model: string;
 *     reasoningEffort: string;
 *     sessionId: string | null;
 *     dialogLoopActive: boolean;
 *     dialogPaused: boolean;
 *     queueSize: number;
 * }}
 */
function readMockRuntimeControlState(runtime) {
    const snap = runtime.getStatusSnapshot?.() ?? {};
    return {
        status: snap.status ?? runtime.status ?? 'unknown',
        model: snap.model ?? runtime.model ?? 'unknown',
        reasoningEffort: snap.reasoningEffort ?? runtime.reasoningEffort ?? 'off',
        sessionId: runtime.sessionId ?? snap.sessionId ?? null,
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        dialogPaused: Boolean(snap.dialogPaused ?? runtime.dialogPaused),
        queueSize: Number(runtime.queueSize ?? snap.queueSize ?? 0),
    };
}

/**
 * @param {typeof defaultRuntime} runtime
 * @returns {Record<string, any>}
 */
function readMockRuntimeInteractionState(runtime) {
    const health = runtime.getHealthSnapshot?.() ?? {};
    return {
        pendingQuestion: runtime.pendingQuestion ?? null,
        pendingQuestionKind: health.pendingQuestionKind ?? runtime.pendingQuestionKind ?? null,
        pendingQuestionShadow: runtime.pendingQuestionShadow ?? (health.pendingQuestionShadow ? {} : null),
        pendingQuestionShadowKind: health.pendingQuestionShadowKind ?? runtime.pendingQuestionShadowKind ?? null,
        pendingQuestionShadowState: health.pendingQuestionShadowState ?? runtime.pendingQuestionShadowState ?? null,
        pendingQuestionShadowExpired: Boolean(
            health.pendingQuestionShadowExpired ?? runtime.pendingQuestionShadowExpired,
        ),
        pendingQuestionShadowAgeMs: health.pendingQuestionShadowAgeMs ?? runtime.pendingQuestionShadowAgeMs ?? null,
        pendingQuestionShadowExpiresAt: runtime.pendingQuestionShadowExpiresAt ?? null,
        pendingQuestionShadowRemainingMs:
            health.pendingQuestionShadowRemainingMs ?? runtime.pendingQuestionShadowRemainingMs ?? null,
    };
}

/**
 * @param {typeof defaultRuntime} runtime
 * @returns {Record<string, any>}
 */
function readMockRuntimePrBudgetSnapshot(runtime) {
    return {
        sendCount: Number(runtime.getStatusSnapshot?.().sendCount ?? 0),
        dialogLoopActive: Boolean(runtime.dialogLoopActive),
        sessionId: runtime.sessionId ?? null,
        prMetrics: runtime.dialogPrMetrics ?? null,
        lastPrInfo: runtime.lastPrInfo ?? null,
    };
}

vi.mock('#copilot/agent', () => ({
    getAgent: () => defaultRuntime,
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') =>
        runtimeId === 'alt' ? altRuntime : runtimeId === 'default' ? defaultRuntime : null,
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
    readAgentRuntimeStatusSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getHealthSnapshot(),
    readRuntimeControlState: readMockRuntimeControlState,
    readRuntimeInteractionState: readMockRuntimeInteractionState,
    readRuntimePrBudgetSnapshot: readMockRuntimePrBudgetSnapshot,
    readRuntimeAutoModelPolicy: (/** @type {typeof defaultRuntime} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    readSdkModelMetadata: () => null,
}));

vi.mock('#copilot/agent/always-alive', () => ({
    alwaysAliveAgent: defaultRuntime,
    getAgent: () => defaultRuntime,
}));

vi.mock('#copilot/agent/runtime-registry', () => ({
    getDefaultAgentRuntimeId: () => 'default',
    getDefaultRegisteredAgentRuntime: () => defaultRuntime,
    getRegisteredAgentRuntime: (runtimeId = 'default') =>
        runtimeId === 'alt' ? altRuntime : runtimeId === 'default' ? defaultRuntime : null,
    listAgentRuntimes: () => [
        { runtimeId: 'default', runtime: defaultRuntime },
        { runtimeId: 'alt', runtime: altRuntime },
    ],
}));

vi.mock('#copilot/agent/facades', () => ({
    readAgentRuntimeStatusSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getStatusSnapshot(),
    readAgentRuntimeHealthSnapshot: (/** @type {typeof defaultRuntime} */ agent) => agent.getHealthSnapshot(),
    readRuntimeControlState: readMockRuntimeControlState,
    readRuntimeInteractionState: readMockRuntimeInteractionState,
    readRuntimePrBudgetSnapshot: readMockRuntimePrBudgetSnapshot,
    readRuntimePermissionMode: vi.fn(() => 'approve_all'),
    readAgentRuntimeSdkResourceSnapshot: vi.fn(() => ({ client: false, session: false, quotaMonitor: false })),
    readRuntimeAutoModelPolicy: (/** @type {typeof defaultRuntime} */ runtime) => ({
        configuredModel: runtime.model,
        observedModel: runtime.lastPrInfo?.effectiveModel ?? runtime.lastPrInfo?.model ?? null,
        selectionAuthority: 'github-copilot',
        canForcePreference: false,
    }),
    readAgentRuntimeTodoSummaries: vi.fn(async () => []),
    readSdkModelMetadata: () => null,
}));

vi.mock('#copilot/bridges', () => ({
    getMcpStatus: () => ({ available: false, toolCount: 0, circuitOpen: false, latencyMs: null }),
}));

vi.mock('#copilot/conversation-hub', () => ({
    conversationHub: { isReady: false },
    conversationStore: {
        getHubSession: vi.fn(() => null),
    },
}));

vi.mock('#copilot/observability', () => ({
    getToolStats: () => ({
        read_file_content: { calls: 4, errors: 1, avgLatencyMs: 120 },
        report_intent_local: { calls: 2, errors: 0, avgLatencyMs: 40 },
    }),
}));

vi.mock('#copilot/core', async () => {
    const actual = await vi.importActual('#copilot/core');
    return {
        ...actual,
        getSharedSessionBinding: () => ({
            hubSessionId: 'hub-diagnose-123456789012345',
            sdkSessionId: 'sdk-diagnose-123456789012345',
        }),
    };
});

vi.mock('../../../../src/copilot/tools/todo/store.js', async (importOriginal) => ({
    ...(await importOriginal()),
    readStore: async () => ({
        tasks: {
            a1: { id: 'a1', title: 'Primeira task', status: 'todo' },
            a2: { id: 'a2', title: 'Segunda task', status: 'in_progress' },
        },
    }),
}));

vi.mock('../../../../src/copilot/terminal/state/activity-state.js', () => ({
    readTerminalActivitySnapshot: () => ({
        phase: 'tool',
        label: 'Executando tool',
        detail: 'web_fetch · 50%',
        source: 'sdk',
        severity: 'info',
        progress: 50,
        toolName: 'web_fetch',
        startedAt: 1,
        updatedAt: 2,
        ageMs: 1200,
    }),
    readTerminalActivityHistory: () => [],
}));

vi.mock('#copilot/tools', async (importOriginal) => ({
    ...(await importOriginal()),
    readIntrospectionRegistrySnapshot: () => ({
        total: 6,
        categories: { file: 6 },
        disabled: [],
        hasCanonicalLocalFsTools: true,
        hasSdkWorkspaceTooling: true,
    }),
}));

const { cmdDiagnose } = await import('../../../../src/copilot/terminal/commands/diagnose.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/diagnose', () => {
    it('inclui health, issues e status transversais do agente', async () => {
        const previousEnv = {
            COPILOT_BYOK_ENABLED: process.env.COPILOT_BYOK_ENABLED,
            COPILOT_BYOK_PROVIDER_PRESET: process.env.COPILOT_BYOK_PROVIDER_PRESET,
            COPILOT_BYOK_MODEL: process.env.COPILOT_BYOK_MODEL,
            COPILOT_BYOK_API_KEY: process.env.COPILOT_BYOK_API_KEY,
        };
        process.env.COPILOT_BYOK_ENABLED = 'true';
        process.env.COPILOT_BYOK_PROVIDER_PRESET = 'openrouter';
        process.env.COPILOT_BYOK_MODEL = 'deepseek/deepseek-v4-flash:free';
        process.env.COPILOT_BYOK_API_KEY = 'test-diagnose-byok-key-that-must-not-render';
        const ctx = mockCtx();

        try {
            await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, 'full');

            expect(ctx.output()).toContain('Diagnóstico do Terminal LLM-B');
            expect(ctx.output()).toContain('degraded');
            expect(ctx.output()).toContain('bg tasks');
            expect(ctx.output()).toContain('keepalive');
            expect(ctx.output()).toContain('quota monitor');
            expect(ctx.output()).toContain('background.backlog_high');
            expect(ctx.output()).toContain('Executando tool');
            expect(ctx.output()).toContain('inspect_boot_report');
            expect(ctx.output()).toContain('streaming on');
            expect(ctx.output()).toContain('inline status');
            expect(ctx.output()).toContain('reserved');
            expect(ctx.output()).toContain('permission');
            expect(ctx.output()).toContain('prompts SDK skip');
            expect(ctx.output()).not.toContain('sdk prompts=');
            expect(ctx.output()).toContain('pergunta');
            expect(ctx.output()).toContain('pergunta restaurada expirando');
            expect(ctx.output()).toContain('runtime id');
            expect(ctx.output()).toContain('sdk-diagnose-1…');
            expect(ctx.output()).toContain('hub-1');
            expect(ctx.output()).not.toContain('sdk-diagnose-123456789012345');
            expect(ctx.output()).not.toContain('hub-diagnose-123456789012345');
            expect(ctx.output()).toContain('*default:gpt-5/processing');
            expect(ctx.output()).toContain('gateway');
            expect(ctx.output()).toContain('1 provedor');
            expect(ctx.output()).toContain('3 modelos');
            expect(ctx.output()).toContain('3 habilitados');
            expect(ctx.output()).toContain('ativo openrouter:deepseek/deepseek-v4-flash:free @ openrouter');
            expect(ctx.output()).not.toContain('providers=');
            expect(ctx.output()).not.toContain('active=');
            expect(ctx.output()).not.toContain('test-diagnose-byok-key-that-must-not-render');
            expect(ctx.output()).toContain('Boot report');
            expect(ctx.output()).toContain('Shutdown');
            expect(ctx.output()).toContain('Timers');
            expect(ctx.output()).toContain('Lifecycle mx');
            expect(ctx.output()).toContain('sdk↔fs route');
            expect(ctx.output()).toContain('degraded');
            expect(ctx.output()).toContain('Ler arquivo');
            expect(ctx.output()).toContain('Intenção capturada');
            expect(ctx.output()).not.toContain('read_file_content');
            expect(ctx.output()).not.toContain('report_intent_local');
        } finally {
            for (const [key, value] of Object.entries(previousEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });

    it('renderiza /health compacto por padrão sem despejar IDs e rótulos técnicos', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println });

        const output = ctx.output();
        expect(output).toContain('Saúde do Terminal LLM-B');
        expect(output).not.toContain('\x1b[36mSaúde do Terminal LLM-B');
        expect(output).toContain('Conversa');
        expect(output).toContain('Entrada');
        expect(output).toContain('Ferramentas');
        expect(output).toContain('locais ativas');
        expect(output).not.toContain('ponte MCP indisponível');
        expect(output).not.toContain('\x1b[90m/health full · /diagnose');
        expect(output).toContain('/health full');
        expect(output).not.toContain('Diagnóstico do Terminal LLM-B');
        expect(output).not.toContain('runtime id');
        expect(output).not.toContain('sdk prompts=');
        expect(output).not.toContain('streaming=');
        expect(output).not.toContain('read_file_content');
        expect(output).not.toContain('report_intent_local');
        expect(output).not.toContain('sdk-diagnose-123456789012345');
    });

    it('aceita runtimeId explícito no comando', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, '--runtime alt full');

        expect(ctx.output()).toContain('runtime id');
        expect(ctx.output()).toContain('alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('mostra IDs completos quando detail é solicitado', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-detail-123456789012345', println: ctx.println }, 'detail');

        expect(ctx.output()).toContain('sdk-diagnose-123456789012345');
        expect(ctx.output()).toContain('hub-detail-123456789012345');
    });

    it('explica explicitamente quando o runtime solicitado não existe', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, '--runtime missing full');

        expect(ctx.output()).toContain('runtime default (default)');
    });
});
