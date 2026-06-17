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
    readAgentRuntimeTodoSummaries: vi.fn(async () => [
        { id: 'a1', title: 'Primeira task' },
        { id: 'a2', title: 'Segunda task' },
    ]),
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
    readAgentRuntimeTodoSummaries: vi.fn(async () => [
        { id: 'a1', title: 'Primeira task' },
        { id: 'a2', title: 'Segunda task' },
    ]),
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
            OPEN_ROUTER_KEY: process.env.OPEN_ROUTER_KEY,
        };
        process.env.COPILOT_BYOK_ENABLED = 'true';
        process.env.COPILOT_BYOK_PROVIDER_PRESET = 'openrouter';
        process.env.COPILOT_BYOK_MODEL = 'deepseek/deepseek-v4-flash:free';
        process.env.COPILOT_BYOK_API_KEY = 'test-diagnose-byok-key-that-must-not-render';
        process.env.OPEN_ROUTER_KEY = 'test-diagnose-byok-key-that-must-not-render';
        const ctx = mockCtx();

        try {
            await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, 'full');
            const output = ctx.output();
            const lowerOutput = output.toLowerCase();

            expect(output).toContain('Diagnóstico do Terminal LLM-B');
            expect(output).toContain('Agente  ·  ambiente · modelo · entrada');
            expect(output).not.toContain('Agente  ·  runtime · modelo · entrada');
            expect(output).toContain('atenção');
            expect(lowerOutput).toContain('segundo plano');
            expect(lowerOutput).toContain('pulso');
            expect(lowerOutput).toContain('quota');
            expect(output).not.toContain('bg tasks');
            expect(output).not.toContain('keepalive');
            expect(output).not.toContain('quota monitor');
            expect(output).toContain('background.backlog_high');
            expect(output).toContain('Executando ferramenta');
            expect(output).toContain('Buscar na web');
            expect(output).not.toContain('Executando tool');
            expect(output).not.toContain('web_fetch');
            expect(output).toContain('verificar relatório de inicialização');
            expect(output).not.toContain('inspect_boot_report');
            expect(output).toContain('streaming ativo');
            expect(output).toContain('Linha viva');
            expect(output).toContain('acima do prompt');
            expect(output).not.toContain('reservada');
            expect(output).not.toContain('reserved');
            expect(lowerOutput).toContain('permiss');
            expect(output).toContain('SDK');
            expect(output).toContain('interativo');
            expect(output).toContain('automáticas');
            expect(output).toContain('prompts SDK ignorados');
            expect(output).toContain('Plano arquivo');
            expect(output).not.toContain('Status       idle');
            expect(output).not.toContain('Modo SDK     interactive');
            expect(output).not.toContain('Plan arquivo');
            expect(output).not.toContain('Permissões   approve_all');
            expect(output).not.toContain('permission');
            expect(output).not.toContain('prompts SDK skip');
            expect(output).not.toContain('sdk prompts=');
            expect(lowerOutput).toContain('pergunta');
            expect(output).toContain('pergunta restaurada expirando');
            expect(output).toContain('Ambiente alvo');
            expect(output).not.toContain('Runtime alvo');
            expect(output).not.toContain('runtime id');
            expect(output).toMatch(/Sessão local\s+ativa/u);
            expect(output).not.toContain('Sessão ambiente');
            expect(output).toMatch(/Sessão SDK\s+ativa/u);
            expect(output).toMatch(/Sessão hub\s+ativo/u);
            expect(output).not.toContain('sdk-diagnose-1…');
            expect(output).not.toContain('hub-1');
            expect(output).not.toContain('sdk-diagnose-123456789012345');
            expect(output).not.toContain('hub-diagnose-123456789012345');
            expect(output).toMatch(/Ambiente alvo\s+principal/u);
            expect(output).toContain('principal · gpt-5 · trabalhando');
            expect(output).not.toContain('*default:gpt-5/processing');
            expect(output).not.toContain('default:gpt-5/processing');
            expect(output).toContain('Gateway');
            expect(output).toContain('1 provedor');
            expect(output).toContain('3 modelos');
            expect(output).toContain('3 habilitados');
            expect(output).toMatch(/ativo\s+[^\n]+ · [^\n]+/u);
            expect(output).not.toContain('@openrouter');
            expect(output).not.toContain('providers=');
            expect(output).not.toContain('active=');
            expect(output).not.toContain('test-diagnose-byok-key-that-must-not-render');
            expect(output).toContain('MCP');
            expect(output).not.toContain('MCP remoto');
            expect(output).toContain('Histórico');
            expect(output).toContain('Inicialização');
            expect(output).toContain('Encerramento');
            expect(output).toContain('Temporizadores');
            expect(output).toContain('Ciclo de vida');
            expect(output).not.toContain('MCP bridge');
            expect(output).not.toContain('Hub storage');
            expect(output).not.toContain('Boot report');
            expect(output).not.toContain('Shutdown');
            expect(output).not.toContain('Timers');
            expect(output).not.toContain('Ciclo vida');
            expect(output).not.toContain('Lifecycle mx');
            expect(output).not.toContain('sdk-preflight');
            expect(output).not.toContain('preflight SDK');
            expect(output).toContain('Rota SDK/FS');
            expect(output).not.toContain('sdk↔fs route');
            expect(output).not.toContain('local-fs-primary');
            expect(output).not.toContain('streaming on');
            expect(output).not.toContain('degraded');
            expect(output).toContain('Pendências');
            expect(output).toContain('Pendente 1');
            expect(output).toContain('Primeira task');
            expect(output).not.toContain('[a1]');
            expect(output).not.toContain('[a2]');
            expect(output).toContain('Ferramentas por latência');
            expect(output).toContain('1. Ler arquivo');
            expect(output).toContain('75% · média 120ms · 4 usos');
            expect(output).toContain('Ler arquivo');
            expect(output).toContain('Intenção capturada');
            expect(output).not.toContain('read_file_content');
            expect(output).not.toContain('report_intent_local');
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
        expect(output).not.toContain('loop ativo');
        expect(output).not.toContain('loop parado');
        expect(output).not.toContain('dialog loop');
        expect(output).toContain('Entrada');
        expect(output).toContain('Gateway');
        expect(output).toContain('Ferramentas');
        expect(output).not.toContain('@');
        expect(output).toContain('locais ativas');
        expect(output).not.toContain('ponte MCP indisponível');
        expect(output).not.toContain('\x1b[90m/health full · /diagnose');
        expect(output).toContain('Mais detalhes');
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

        expect(ctx.output()).toContain('Ambiente alvo');
        expect(ctx.output()).not.toContain('runtime id');
        expect(ctx.output()).toContain('alt');
        expect(ctx.output()).toContain('gpt-4.1-mini');
    });

    it('mostra IDs completos quando detail é solicitado', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-detail-123456789012345', println: ctx.println }, 'detail');

        expect(ctx.output()).toContain('sdk-diagnose-123456789012345');
        expect(ctx.output()).toContain('hub-detail-123456789012345');
    });

    it('explica explicitamente quando o ambiente solicitado não existe', async () => {
        const ctx = mockCtx();

        await cmdDiagnose({ hubSessionId: 'hub-1', println: ctx.println }, '--runtime missing full');

        expect(ctx.output()).toContain('ambiente principal (default)');
        expect(ctx.output()).not.toContain('runtime default (default)');
    });
});
