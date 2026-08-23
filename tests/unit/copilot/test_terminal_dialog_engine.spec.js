// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_engine.spec.js
 *
 * Contrato: terminal/dialog/engine.js
 */

import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const configMocks = vi.hoisted(() => ({
    readConfiguredByokSummary:
        /** @type {import('vitest').Mock<typeof import('../../../src/copilot/config/index.js').readConfiguredByokSummary>} */ (
            vi.fn(() => ({
                enabled: false,
                ready: false,
                preset: null,
                profile: null,
                providerType: null,
                baseUrl: null,
                model: null,
                wireApi: null,
                azureApiVersion: null,
                auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
                modelList: { configured: false, count: 0 },
                capabilities: { reasoningEffort: false, vision: false, contextWindowTokens: 128000 },
                limits: { maxRequestTokens: null, tokensPerMinute: null, requestsPerMinute: null, dailyRequests: null },
                warnings: [],
                errors: [],
            }))
        ),
}));
const gatewayMocks = vi.hoisted(() => ({
    readTerminalDialogStreamMeta: /** @type {import('vitest').Mock<
    typeof import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js').readTerminalDialogStreamMeta
>} */ (vi.fn(() => ({ model: 'gpt-5-mini', reasoningEffort: 'medium' }))),
    readTerminalRuntimeControlState: /** @type {import('vitest').Mock<
    typeof import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js').readTerminalRuntimeControlState
>} */ (
        vi.fn(() => ({
            status: 'idle',
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            sessionId: null,
            dialogLoopActive: true,
            dialogPaused: false,
            queueSize: 0,
        }))
    ),
    readTerminalRuntimeState: /** @type {import('vitest').Mock<
    typeof import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js').readTerminalRuntimeState
>} */ (
        vi.fn(() => ({
            runtimeId: 'default',
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            status: 'idle',
            sessionId: null,
            dialogLoopActive: true,
            dialogPaused: false,
            queueSize: 0,
            pendingQuestion: null,
            pendingQuestionKind: null,
            pendingQuestionShadow: null,
            pendingQuestionShadowKind: null,
            pendingQuestionShadowState: null,
            pendingQuestionShadowExpired: false,
            pendingQuestionShadowAgeMs: null,
            pendingQuestionShadowExpiresAt: null,
            pendingQuestionShadowRemainingMs: null,
            contextWindow: null,
            lastPrInfo: null,
            lastLlmUsage: null,
        }))
    ),
    runTerminalDialogTurn: vi.fn(async () => 'ok'),
    runTerminalDialogTurnDetailed: vi.fn(async () => ({
        reply: 'ok',
        channel: 'dialog',
        replySource: 'runtime_return',
    })),
    startTerminalAgentRuntime: vi.fn(async () => undefined),
    startTerminalDialogMode: vi.fn(async () => undefined),
}));

vi.mock('#copilot/bridges', () => ({ emitNerv: vi.fn() }));
vi.mock('#copilot/config', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        LLM_B_BOOT_TIMEOUT_MS: 60_000,
        LLM_B_TURN_TIMEOUT_MS: 120_000,
        LLM_B_BOOT_PROMPT: undefined,
        LLM_B_DIALOG_QUEUE_MAX: 10,
        readConfiguredByokSummary: configMocks.readConfiguredByokSummary,
    };
});
vi.mock('#copilot/observability', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        log: vi.fn(),
        METRICS_STORE: Symbol.for('METRICS_STORE'),
    };
});
vi.mock('#copilot/dialog/timeout-policy', () => ({
    resolveOptionalDialogTimeout: vi.fn(() => ({
        timeoutMs: null,
        strategy: 'disabled',
        reasons: ['caller_disabled'],
    })),
}));
vi.mock('../../../src/copilot/presentation/runtime/index.js', () => ({
    attachmentToRuntimeEmbed: vi.fn(async () => null),
}));
vi.mock('../../../src/copilot/presentation/state/index.js', () => ({
    clearAttachments: vi.fn(),
    clearNextTurnRequestHeaders: vi.fn(),
    getAttachmentQueue: vi.fn(() => []),
    getHubSessionId: vi.fn(() => null),
    getNextTurnRequestHeaders: vi.fn(() => null),
    getRl: vi.fn(() => null),
    getShowStreaming: vi.fn(() => false),
    getShowThinking: vi.fn(() => false),
    getShowUsage: vi.fn(() => false),
    setBusy: vi.fn(),
    setShowStreaming: vi.fn(),
    setShowThinking: vi.fn(),
    setShowUsage: vi.fn(),
    getShowToolActivity: vi.fn(() => false),
    setShowToolActivity: vi.fn(),
    getShowIntentActivity: vi.fn(() => false),
    setShowIntentActivity: vi.fn(),
    getShowSessionActivity: vi.fn(() => false),
    setShowSessionActivity: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/state/activity-state.js', () => ({
    markTerminalActivityIdle: vi.fn(),
    recordTerminalActivity: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js', () => ({
    readTerminalDialogStreamMeta: gatewayMocks.readTerminalDialogStreamMeta,
    readTerminalRuntimeControlState: gatewayMocks.readTerminalRuntimeControlState,
    readTerminalRuntimeState: gatewayMocks.readTerminalRuntimeState,
    startTerminalAgentRuntime: gatewayMocks.startTerminalAgentRuntime,
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/dialog.js', () => ({
    runTerminalDialogTurn: gatewayMocks.runTerminalDialogTurn,
    runTerminalDialogTurnDetailed: gatewayMocks.runTerminalDialogTurnDetailed,
    startTerminalDialogMode: gatewayMocks.startTerminalDialogMode,
}));
vi.mock('../../../src/copilot/terminal/frontend/gateways/index.js', () => ({
    readTerminalDialogStreamMeta: gatewayMocks.readTerminalDialogStreamMeta,
    readTerminalRuntimeControlState: gatewayMocks.readTerminalRuntimeControlState,
    readTerminalRuntimeState: gatewayMocks.readTerminalRuntimeState,
    runTerminalDialogTurn: gatewayMocks.runTerminalDialogTurn,
    runTerminalDialogTurnDetailed: gatewayMocks.runTerminalDialogTurnDetailed,
    startTerminalAgentRuntime: gatewayMocks.startTerminalAgentRuntime,
    startTerminalDialogMode: gatewayMocks.startTerminalDialogMode,
}));
vi.mock('../../../src/copilot/terminal/dialog/engine-persistence.js', () => ({
    drainPendingNotifications: vi.fn(() => []),
    getPersistenceFailureCount: vi.fn(() => 0),
    persistTurnToHub: vi.fn(async () => undefined),
}));
vi.mock('../../../src/copilot/terminal/dialog/sse.js', () => ({ broadcastSse: vi.fn() }));
vi.mock('../../../src/copilot/model-gateway/health/provider-health.js', () => ({
    recordByokProviderModelCallFailure: vi.fn(),
}));
vi.mock('../../../src/copilot/terminal/dialog/turn-display.js', () => ({
    createDeltaCallback: vi.fn(() => () => {}),
    createDisplayState: vi.fn(() => ({})),
    createReasoningCallback: vi.fn(() => () => {}),
    hasStreamingTranscriptMismatch: vi.fn(() => false),
    measureVisibleTerminalChars: vi.fn((text) => String(text ?? '').replace(/\s+/g, '').length),
    normalizeTerminalTranscriptText: vi.fn((text) => String(text ?? '').trim()),
    releaseDisplayState: vi.fn(),
    renderStreamingFooter: vi.fn(),
    sanitizeTerminalRenderText: vi.fn((text) => String(text ?? '')),
}));

/** @type {typeof import('../../../src/copilot/terminal/dialog/engine.js')} */
let mod;
/** @type {string} */
let src;
/** @type {import('vitest').MockInstance | null} */
let stdoutWriteSpy = null;

/** @typedef {ReturnType<typeof import('../../../src/copilot/config/index.js').readConfiguredByokSummary>} ConfiguredByokSummary */
/** @typedef {ReturnType<
    typeof import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js').readTerminalRuntimeState
>} TerminalRuntimeState */
/** @typedef {Omit<Partial<ConfiguredByokSummary>, 'limits' | 'capabilities'> & {
    limits?: Partial<ConfiguredByokSummary['limits']>;
    capabilities?: Partial<ConfiguredByokSummary['capabilities']>;
}} ConfiguredByokSummaryOverrides */

/**
 * @param {ConfiguredByokSummaryOverrides} [overrides]
 * @returns {ConfiguredByokSummary}
 */
function configuredByokSummaryFixture(overrides = {}) {
    const limits = {
        maxRequestTokens: null,
        tokensPerMinute: null,
        requestsPerMinute: null,
        dailyRequests: null,
        ...(overrides.limits ?? {}),
    };
    const capabilities = {
        reasoningEffort: false,
        vision: false,
        contextWindowTokens: 128000,
        ...(overrides.capabilities ?? {}),
    };
    return {
        enabled: false,
        ready: false,
        preset: null,
        profile: null,
        providerType: null,
        baseUrl: null,
        model: null,
        wireApi: null,
        azureApiVersion: null,
        auth: { apiKeyConfigured: false, bearerTokenConfigured: false, headersConfigured: false },
        modelList: { configured: false, count: 0 },
        warnings: [],
        errors: [],
        ...overrides,
        capabilities,
        limits,
    };
}

/**
 * @param {Partial<TerminalRuntimeState>} [overrides]
 * @returns {TerminalRuntimeState}
 */
function terminalIdleRuntimeState(overrides = {}) {
    return {
        runtimeId: 'default',
        model: 'gpt-5-mini',
        reasoningEffort: 'medium',
        status: 'idle',
        sessionId: null,
        dialogLoopActive: true,
        dialogPaused: false,
        queueSize: 0,
        pendingQuestion: null,
        pendingQuestionKind: null,
        pendingQuestionShadow: null,
        pendingQuestionShadowKind: null,
        pendingQuestionShadowState: null,
        pendingQuestionShadowExpired: false,
        pendingQuestionShadowAgeMs: null,
        pendingQuestionShadowExpiresAt: null,
        pendingQuestionShadowRemainingMs: null,
        contextWindow: null,
        lastPrInfo: null,
        lastLlmUsage: null,
        ...overrides,
    };
}

beforeAll(async () => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mod = await import('../../../src/copilot/terminal/dialog/engine.js');
    src = await readFile(new URL('../../../src/copilot/terminal/dialog/engine.js', import.meta.url), 'utf-8');
});

afterAll(() => {
    stdoutWriteSpy?.mockRestore();
    stdoutWriteSpy = null;
});

describe('terminal/dialog/engine.js — contrato', () => {
    it('importa sem erros', async () => {
        expect(mod).toBeTruthy();
    });

    it('exporta sendTurn', async () => {
        expect(typeof mod.sendTurn).toBe('function');
    });

    it('exporta ensureDialogLoop', async () => {
        expect(typeof mod.ensureDialogLoop).toBe('function');
    });

    it('exporta getTurnQueueDepth', async () => {
        expect(typeof mod.getTurnQueueDepth).toBe('function');
    });

    it('exporta avaliação de orçamento BYOK antes do turno', async () => {
        expect(typeof mod.evaluateTerminalByokTurnBudget).toBe('function');
    });

    it('repinta forçadamente o prompt após o reattach pronto', () => {
        expect(src).toContain('scheduleTerminalPromptRedraw(rl, buildUserPrompt(), { force: true })');
    });

    it('bloqueia quando o limite BYOK declarado não comporta o envelope terminal', async () => {
        const result = mod.evaluateTerminalByokTurnBudget(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                limits: { maxRequestTokens: 6000, tokensPerMinute: 6000 },
                capabilities: { contextWindowTokens: 131072 },
            }),
            terminalIdleRuntimeState({ contextWindow: { tokens: 1000, tokenLimit: 131072, utilization: 0.01 } }),
            'mensagem curta',
        );

        expect(result.shouldWarn).toBe(true);
        expect(result.shouldBlock).toBe(true);
        expect(result.severity).toBe('block');
        expect(result.label).toContain('provider pode recusar');
        expect(result.estimatedRequestTokens).toBeGreaterThan(6000);
        expect(result.limit).toBe(6000);
    });

    it('avisa quando a estimativa do turno ultrapassa o limite BYOK', async () => {
        const result = mod.evaluateTerminalByokTurnBudget(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                limits: { maxRequestTokens: 12000, tokensPerMinute: null },
                capabilities: { contextWindowTokens: 131072 },
            }),
            terminalIdleRuntimeState({ contextWindow: { tokens: 11500, tokenLimit: 131072, utilization: 0.09 } }),
            'mensagem que empurra o turno acima do limite',
        );

        expect(result.shouldWarn).toBe(true);
        expect(result.shouldBlock).toBe(true);
        expect(result.severity).toBe('block');
        expect(result.label).toContain('provider pode recusar');
        expect(result.estimatedRequestTokens).toBeGreaterThan(12000);
    });

    it('normaliza modo de admission control BYOK com default restritivo', async () => {
        expect(mod.readTerminalByokAdmissionMode({})).toBe('block');
        expect(mod.readTerminalByokAdmissionMode({ COPILOT_BYOK_ADMISSION_MODE: 'warn-only' })).toBe('warn');
        expect(mod.readTerminalByokAdmissionMode({ COPILOT_BYOK_ADMISSION_MODE: 'off' })).toBe('off');
    });

    it('mantém Copilot SDK em watchdog-only e ativa timeout de inatividade para BYOK', async () => {
        const timeoutPolicy = await import('#copilot/dialog/timeout-policy');
        const resolveMock = vi.mocked(timeoutPolicy.resolveOptionalDialogTimeout);
        resolveMock.mockClear();

        mod.resolveTerminalDialogTurnTimeout({
            byok: configuredByokSummaryFixture({ enabled: false, ready: false }),
            runtimeState: terminalIdleRuntimeState({ queueSize: 0, contextWindow: null }),
            metricsSummary: null,
            message: 'oi',
        });
        expect(resolveMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                explicitTimeoutMs: 0,
                allowDisabled: true,
                phase: 'dialog',
            }),
        );

        mod.resolveTerminalDialogTurnTimeout({
            byok: configuredByokSummaryFixture({ enabled: true, ready: true }),
            runtimeState: terminalIdleRuntimeState({ queueSize: 0, contextWindow: null }),
            metricsSummary: null,
            message: 'oi',
        });
        expect(resolveMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                explicitTimeoutMs: undefined,
                allowDisabled: false,
                phase: 'dialog',
            }),
        );
    });

    it('bloqueia turno BYOK antes de chamar SDK quando estimativa excede limite declarado', async () => {
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const sse = await import('../../../src/copilot/terminal/dialog/sse.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockClear();
        vi.mocked(sse.broadcastSse).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValueOnce(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'tiny-byok',
                preset: 'test',
                providerType: 'openai',
                model: 'tiny-model',
                limits: { maxRequestTokens: 12000, tokensPerMinute: null },
                capabilities: { contextWindowTokens: 131072 },
            }),
        );
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValueOnce(
            terminalIdleRuntimeState({
                runtimeId: 'default',
                model: 'tiny-model',
                reasoningEffort: 'medium',
                status: 'idle',
                sessionId: null,
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadow: null,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                contextWindow: { tokens: 11800, tokenLimit: 131072, utilization: 0.09 },
                lastPrInfo: null,
            }),
        );

        await expect(mod.sendTurn('mensagem acima do orçamento', 'user')).resolves.toBeNull();

        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).not.toHaveBeenCalled();
        expect(vi.mocked(sse.broadcastSse)).toHaveBeenCalledWith(
            'terminal.byok.admission_blocked',
            expect.objectContaining({
                reason: 'estimated_request_exceeds_provider_limit',
                admissionMode: 'block',
            }),
        );
    });

    it('permite override explícito para warn-only quando BYOK excede limite', async () => {
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValueOnce(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'tiny-byok',
                preset: 'test',
                providerType: 'openai',
                model: 'tiny-model',
                limits: { maxRequestTokens: 12000, tokensPerMinute: null },
                capabilities: { contextWindowTokens: 131072 },
            }),
        );
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValueOnce(
            terminalIdleRuntimeState({
                runtimeId: 'default',
                model: 'tiny-model',
                reasoningEffort: 'medium',
                status: 'idle',
                sessionId: null,
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadow: null,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                contextWindow: { tokens: 11800, tokenLimit: 131072, utilization: 0.09 },
                lastPrInfo: null,
            }),
        );

        const previousMode = process.env['COPILOT_BYOK_ADMISSION_MODE'];
        process.env['COPILOT_BYOK_ADMISSION_MODE'] = 'warn';
        try {
            await expect(mod.sendTurn('mensagem acima do orçamento com override', 'user')).resolves.toBe('ok');
        } finally {
            if (previousMode === undefined) {
                delete process.env['COPILOT_BYOK_ADMISSION_MODE'];
            } else {
                process.env['COPILOT_BYOK_ADMISSION_MODE'] = previousMode;
            }
        }

        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledWith(
            'mensagem acima do orçamento com override',
            expect.any(Object),
        );
    });

    it('embute blob attachment estruturado no próximo turno do usuário', async () => {
        const state = await import('../../../src/copilot/presentation/state/index.js');
        const runtimeDialog = await import('../../../src/copilot/presentation/runtime/index.js');
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');

        vi.mocked(state.getAttachmentQueue).mockReturnValue([
            {
                type: 'blob',
                data: 'Y29udGV1ZG8=',
                mimeType: 'text/plain',
                displayName: 'memo.txt',
            },
        ]);
        vi.mocked(runtimeDialog.attachmentToRuntimeEmbed).mockResolvedValueOnce(
            'Blob `memo.txt` (text/plain)\n```\nconteúdo\n```',
        );

        await mod.sendTurn('Explique este artefato.', 'user');

        expect(vi.mocked(state.clearAttachments)).toHaveBeenCalled();
        expect(vi.mocked(runtimeDialog.attachmentToRuntimeEmbed)).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'blob',
                mimeType: 'text/plain',
                displayName: 'memo.txt',
            }),
        );
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledWith(
            expect.stringContaining('Blob `memo.txt` (text/plain)'),
            expect.any(Object),
        );
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledWith(
            expect.stringContaining('Explique este artefato.'),
            expect.any(Object),
        );
    });

    it('consome requestHeaders one-shot do próximo turno e encaminha ao gateway de diálogo', async () => {
        const state = await import('../../../src/copilot/presentation/state/index.js');
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');

        vi.mocked(state.getNextTurnRequestHeaders).mockReturnValue({ Authorization: 'Bearer test', 'X-Mode': 'byok' });

        await mod.sendTurn('Mensagem com byok', 'user');

        expect(vi.mocked(state.clearNextTurnRequestHeaders)).toHaveBeenCalled();
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledWith(
            'Mensagem com byok',
            expect.objectContaining({
                requestHeaders: { Authorization: 'Bearer test', 'X-Mode': 'byok' },
            }),
        );
    });

    it('libera display state quando o SDK falha durante o turno', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const turnDisplay = await import('../../../src/copilot/terminal/dialog/turn-display.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockRejectedValueOnce(new Error('sdk stream failed'));

        await expect(mod.sendTurn('forçar erro de stream', 'user')).resolves.toBeNull();
        expect(vi.mocked(turnDisplay.releaseDisplayState)).toHaveBeenCalledWith(expect.any(Object));
    });

    it('classifica timeout de inatividade BYOK como falha operacional do provider/modelo', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const health = await import('../../../src/copilot/model-gateway/health/provider-health.js');

        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'mistral-free',
                providerType: 'openai',
                preset: 'mistral',
                model: 'codestral-latest',
            }),
        );
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockRejectedValueOnce(
            Object.assign(new Error('[DialogLoopManager] sendTurn sem progresso por 120000ms'), {
                code: 'DIALOG_TIMEOUT',
            }),
        );

        await expect(mod.sendTurn('forçar stall BYOK', 'user')).resolves.toBeNull();

        expect(vi.mocked(health.recordByokProviderModelCallFailure)).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'mistral-free',
                providerId: 'mistral',
                providerModel: 'codestral-latest',
                errorContext: 'dialog.byok_inactivity_timeout',
            }),
        );

        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: false,
                ready: false,
                profile: null,
                model: null,
            }),
        );
    });

    it('classifica 402 BYOK como bloqueio de credito no turno vivo sem duplicar erro generico no terminal', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const health = await import('../../../src/copilot/model-gateway/health/provider-health.js');
        const activity = await import('../../../src/copilot/terminal/state/activity-state.js');

        const previousAuto = process.env['COPILOT_BYOK_GATEWAY_AUTO'];
        process.env['COPILOT_BYOK_GATEWAY_AUTO'] = 'true';
        stdoutWriteSpy?.mockClear();
        vi.mocked(activity.recordTerminalActivity).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'chutes-ai',
                providerType: 'openai',
                preset: 'chutes',
                model: 'Qwen/Qwen3.5-397B-A17B-TEE',
            }),
        );
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockRejectedValueOnce(
            new Error('402 402 status code (no body)'),
        );

        await expect(mod.sendTurn('forcar credito BYOK', 'user')).resolves.toBeNull();

        expect(vi.mocked(health.recordByokProviderModelCallFailure)).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'chutes-ai',
                providerId: 'chutes',
                errorContext: 'dialog.byok_provider_credits',
            }),
        );
        expect(vi.mocked(activity.recordTerminalActivity)).toHaveBeenCalledWith(
            'error',
            'Falha da rota BYOK no turno',
            expect.objectContaining({ source: 'dialog' }),
        );
        expect(vi.mocked(activity.recordTerminalActivity)).not.toHaveBeenCalledWith(
            'error',
            'Erro no turno',
            expect.anything(),
        );
        expect(stdoutWriteSpy?.mock.calls.map((call) => String(call[0])).join('')).toContain(
            '/byok auto record profile:chutes-ai',
        );
        const renderedOutput = stdoutWriteSpy?.mock.calls.map((call) => String(call[0])).join('') ?? '';
        expect(renderedOutput).toContain('Rota BYOK');
        expect(renderedOutput).toContain('rota BYOK recusou a chamada por crédito');
        expect(renderedOutput).toContain('Destino');
        expect(renderedOutput).not.toContain('dialog.byok_provider_credits:');
        expect(renderedOutput).not.toContain('402 402 status code');
        if (previousAuto === undefined) delete process.env['COPILOT_BYOK_GATEWAY_AUTO'];
        else process.env['COPILOT_BYOK_GATEWAY_AUTO'] = previousAuto;

        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: false,
                ready: false,
                profile: null,
                model: null,
            }),
        );
    });

    it('expõe turno BYOK vazio como falha operacional quando não há input humano pendente', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const state = await import('../../../src/copilot/presentation/state/index.js');
        const health = await import('../../../src/copilot/model-gateway/health/provider-health.js');
        const sse = await import('../../../src/copilot/terminal/dialog/sse.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockReset();
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(terminalIdleRuntimeState());
        vi.mocked(state.getNextTurnRequestHeaders).mockReturnValue(null);
        vi.mocked(health.recordByokProviderModelCallFailure).mockClear();
        vi.mocked(sse.broadcastSse).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'kilo',
                providerType: 'openai',
                preset: 'kilo-code',
                model: 'kilo-auto/free',
            }),
        );
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: '',
            channel: 'dialog',
            replySource: 'empty',
            semanticOutcome: 'empty',
            semanticReplySource: 'direct_dispatch',
            semanticDiagnostics: {
                dispatched: true,
                assistantMessageCount: 0,
                deltaChars: 0,
                deltaEligible: false,
                pendingProtocolKind: null,
                pendingHumanInput: false,
                toolSignalCount: 0,
                lastDeltaSeq: 0,
                lastToolSignalSeq: 0,
            },
        });
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: '',
            channel: 'dialog',
            replySource: 'empty',
            semanticOutcome: 'empty',
            semanticReplySource: 'direct_dispatch',
            semanticDiagnostics: {
                dispatched: true,
                assistantMessageCount: 0,
                deltaChars: 0,
                deltaEligible: false,
                pendingProtocolKind: null,
                pendingHumanInput: false,
                toolSignalCount: 0,
                lastDeltaSeq: 0,
                lastToolSignalSeq: 0,
            },
        });

        await expect(mod.sendTurn('forçar reply vazio BYOK', 'user')).resolves.toBe('');

        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(health.recordByokProviderModelCallFailure)).toHaveBeenCalledWith(
            expect.objectContaining({
                routeProfile: 'kilo',
                providerId: 'kilo-code',
                providerModel: 'kilo-auto/free',
                errorContext: 'dialog.byok_empty_output',
            }),
        );
        expect(vi.mocked(sse.broadcastSse)).toHaveBeenCalledWith(
            'terminal.turn.empty_output',
            expect.objectContaining({
                actor: 'user',
                source: 'terminal-dialog/empty-output',
                assistantMessageCount: 0,
                cause: 'modelo encerrou o turno sem texto público nem protocolo de continuidade',
                evidence: expect.stringContaining('tools 0'),
                operatorSummary: expect.stringContaining('modelo encerrou o turno'),
                operatorAction: expect.stringContaining('troque rota/modelo'),
            }),
        );
        const renderedOutput = stdoutWriteSpy?.mock.calls.map((call) => String(call[0])).join('') ?? '';
        expect(renderedOutput).toContain('LLM-B encerrou sem resposta pública');
        expect(renderedOutput).toContain('Causa');
        expect(renderedOutput).toContain('Evidências');

        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: false,
                ready: false,
                profile: null,
                model: null,
            }),
        );
    });

    it('recupera uma vez turno vazio pré-ação sem degradar saúde BYOK', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const state = await import('../../../src/copilot/presentation/state/index.js');
        const health = await import('../../../src/copilot/model-gateway/health/provider-health.js');
        const sse = await import('../../../src/copilot/terminal/dialog/sse.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockReset();
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(terminalIdleRuntimeState());
        vi.mocked(state.getNextTurnRequestHeaders).mockReturnValue(null);
        vi.mocked(health.recordByokProviderModelCallFailure).mockClear();
        vi.mocked(sse.broadcastSse).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'kilo',
                providerType: 'openai',
                preset: 'kilo-code',
                model: 'kilo-auto/free',
            }),
        );
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: '',
            channel: 'dialog',
            replySource: 'empty',
            semanticOutcome: 'empty',
            semanticReplySource: 'direct_dispatch',
            semanticDiagnostics: {
                dispatched: true,
                assistantMessageCount: 0,
                deltaChars: 0,
                deltaEligible: false,
                pendingProtocolKind: null,
                pendingHumanInput: false,
                toolSignalCount: 0,
                lastDeltaSeq: 0,
                lastToolSignalSeq: 0,
            },
        });
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: 'resposta recuperada',
            channel: 'dialog',
            replySource: 'runtime_return',
            semanticOutcome: 'public_reply',
            semanticReplySource: 'loop.reply',
            semanticDiagnostics: {
                dispatched: true,
                assistantMessageCount: 1,
                deltaChars: 18,
                deltaEligible: true,
                pendingProtocolKind: null,
                pendingHumanInput: false,
                toolSignalCount: 0,
                lastDeltaSeq: 1,
                lastToolSignalSeq: 0,
            },
        });

        await expect(mod.sendTurn('forçar reply vazio recuperável', 'user')).resolves.toBe('resposta recuperada');

        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mock.calls[1]?.[0]).toContain(
            'RECUPERAÇÃO AUTOMÁTICA DO TERMINAL',
        );
        expect(vi.mocked(health.recordByokProviderModelCallFailure)).not.toHaveBeenCalled();
        expect(vi.mocked(sse.broadcastSse)).toHaveBeenCalledWith(
            'terminal.turn.empty_recovery',
            expect.objectContaining({
                reason: 'pre_action_empty_output',
                attempt: 1,
                maxAttempts: 1,
            }),
        );
        expect(vi.mocked(sse.broadcastSse)).not.toHaveBeenCalledWith('terminal.turn.empty_output', expect.any(Object));

        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: false,
                ready: false,
                profile: null,
                model: null,
            }),
        );
    });

    it('aceita reply vazio quando ask_user deixou input humano pendente', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const state = await import('../../../src/copilot/presentation/state/index.js');
        const health = await import('../../../src/copilot/model-gateway/health/provider-health.js');
        const sse = await import('../../../src/copilot/terminal/dialog/sse.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockReset();
        vi.mocked(state.getNextTurnRequestHeaders).mockReturnValue(null);
        vi.mocked(health.recordByokProviderModelCallFailure).mockClear();
        vi.mocked(sse.broadcastSse).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'kilo',
                providerType: 'openai',
                preset: 'kilo-code',
                model: 'kilo-auto/free',
            }),
        );
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(
            terminalIdleRuntimeState({
                runtimeId: 'default',
                model: 'kilo-auto/free',
                reasoningEffort: 'high',
                status: 'waiting_for_input',
                sessionId: 'sdk-ask',
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: {
                    question: 'ASK-CANONICAL?',
                    choices: ['SIM'],
                    kind: 'question',
                    allowFreeform: true,
                    askedAt: 1,
                    protocolControlled: false,
                },
                pendingQuestionKind: 'question',
                pendingQuestionShadow: null,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                contextWindow: null,
                lastPrInfo: null,
            }),
        );
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: '',
            channel: 'dialog',
            replySource: 'empty',
        });

        await expect(mod.sendTurn('forçar ask_user vazio', 'user')).resolves.toBe('');

        expect(vi.mocked(health.recordByokProviderModelCallFailure)).not.toHaveBeenCalled();
        expect(vi.mocked(sse.broadcastSse)).not.toHaveBeenCalledWith('terminal.turn.empty_output', expect.any(Object));

        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(
            terminalIdleRuntimeState({
                runtimeId: 'default',
                model: 'gpt-5-mini',
                reasoningEffort: 'medium',
                status: 'idle',
                sessionId: null,
                dialogLoopActive: true,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadow: null,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                contextWindow: null,
                lastPrInfo: null,
            }),
        );
        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: false,
                ready: false,
                profile: null,
                model: null,
            }),
        );
    });

    it('não degrada saúde BYOK quando o Agent classifica o turno vazio como tool-only', async () => {
        const dialogGateway = await import('../../../src/copilot/terminal/frontend/gateways/dialog.js');
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const state = await import('../../../src/copilot/presentation/state/index.js');
        const health = await import('../../../src/copilot/model-gateway/health/provider-health.js');
        const sse = await import('../../../src/copilot/terminal/dialog/sse.js');

        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockReset();
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(terminalIdleRuntimeState());
        vi.mocked(state.getNextTurnRequestHeaders).mockReturnValue(null);
        vi.mocked(health.recordByokProviderModelCallFailure).mockClear();
        vi.mocked(sse.broadcastSse).mockClear();
        configMocks.readConfiguredByokSummary.mockReturnValue(
            configuredByokSummaryFixture({
                enabled: true,
                ready: true,
                profile: 'kilo',
                providerType: 'openai',
                preset: 'kilo-code',
                model: 'kilo-auto/free',
            }),
        );
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: '',
            channel: 'dialog',
            replySource: 'empty',
            semanticOutcome: 'tool_only',
            semanticReplySource: 'loop.reply',
            semanticDiagnostics: {
                dispatched: true,
                assistantMessageCount: 0,
                deltaChars: 0,
                deltaEligible: false,
                pendingProtocolKind: null,
                pendingHumanInput: false,
                toolSignalCount: 2,
                lastDeltaSeq: 0,
                lastToolSignalSeq: 2,
            },
        });
        vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mockResolvedValueOnce({
            reply: 'síntese recuperada após tools',
            channel: 'dialog',
            replySource: 'runtime_return',
            semanticOutcome: 'public_reply',
            semanticReplySource: 'loop.reply',
            semanticDiagnostics: {
                dispatched: true,
                assistantMessageCount: 1,
                deltaChars: 30,
                deltaEligible: true,
                pendingProtocolKind: null,
                pendingHumanInput: false,
                toolSignalCount: 0,
                lastDeltaSeq: 1,
                lastToolSignalSeq: 2,
            },
        });

        await expect(
            mod.sendTurn(
                [
                    'executar tools sem síntese',
                    'Por fim invoque a ferramenta real ask_user perguntando exatamente "ASK-TEST: responda SIM".',
                    'Não use outras tools além de report_intent, read_file_content, ask_user.',
                ].join(' '),
                'user',
            ),
        ).resolves.toBe('síntese recuperada após tools');

        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mock.calls[1]?.[0]).toContain(
            'O turno imediatamente anterior executou tools reais',
        );
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mock.calls[1]?.[0]).toContain(
            'Allowlist original de tools: report_intent, read_file_content, ask_user',
        );
        expect(vi.mocked(dialogGateway.runTerminalDialogTurnDetailed).mock.calls[1]?.[0]).toContain(
            'use exatamente esta pergunta: "ASK-TEST: responda SIM"',
        );
        expect(vi.mocked(health.recordByokProviderModelCallFailure)).not.toHaveBeenCalled();
        expect(vi.mocked(sse.broadcastSse)).toHaveBeenCalledWith(
            'terminal.turn.empty_recovery',
            expect.objectContaining({
                reason: 'post_tool_only_no_public_output',
                firstOutcome: 'tool_only',
            }),
        );
        expect(vi.mocked(sse.broadcastSse)).not.toHaveBeenCalledWith(
            'terminal.turn.non_text_outcome',
            expect.objectContaining({ semanticOutcome: 'tool_only' }),
        );
    });

    it('pausa o boot do dialog loop quando a policy SDK bloqueia reconnect por auth', async () => {
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const nerv = await import('#copilot/bridges');

        vi.mocked(runtime.readTerminalRuntimeControlState).mockReturnValue({
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            sessionId: null,
            dialogLoopActive: false,
            dialogPaused: false,
            isResumed: false,
            status: 'stopped',
            queueSize: 0,
        });
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(
            terminalIdleRuntimeState({
                runtimeId: 'default',
                model: 'gpt-5-mini',
                reasoningEffort: 'medium',
                status: 'idle',
                sessionId: null,
                dialogLoopActive: false,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadow: null,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                contextWindow: null,
                lastPrInfo: null,
            }),
        );
        vi.mocked(runtime.startTerminalAgentRuntime).mockRejectedValueOnce(
            Object.assign(new Error('unauthorized'), { status: 401 }),
        );

        await expect(mod.ensureDialogLoop()).resolves.toBeUndefined();
        expect(vi.mocked(nerv.emitNerv)).toHaveBeenCalledWith(
            'copilot:dialog:boot_blocked',
            expect.objectContaining({ reason: 'sdk_auth' }),
        );
    });

    it('pausa o boot do dialog loop quando a policy SDK bloqueia reconnect por rate_limit', async () => {
        const runtime = await import('../../../src/copilot/terminal/frontend/gateways/agent-runtime.js');
        const nerv = await import('#copilot/bridges');

        vi.mocked(runtime.readTerminalRuntimeControlState).mockReturnValue({
            model: 'gpt-5-mini',
            reasoningEffort: 'medium',
            sessionId: null,
            dialogLoopActive: false,
            dialogPaused: false,
            isResumed: false,
            status: 'stopped',
            queueSize: 0,
        });
        vi.mocked(runtime.readTerminalRuntimeState).mockReturnValue(
            terminalIdleRuntimeState({
                runtimeId: 'default',
                model: 'gpt-5-mini',
                reasoningEffort: 'medium',
                status: 'idle',
                sessionId: null,
                dialogLoopActive: false,
                dialogPaused: false,
                queueSize: 0,
                pendingQuestion: null,
                pendingQuestionKind: null,
                pendingQuestionShadow: null,
                pendingQuestionShadowKind: null,
                pendingQuestionShadowState: null,
                pendingQuestionShadowExpired: false,
                pendingQuestionShadowAgeMs: null,
                pendingQuestionShadowExpiresAt: null,
                pendingQuestionShadowRemainingMs: null,
                contextWindow: null,
                lastPrInfo: null,
            }),
        );
        vi.mocked(runtime.startTerminalAgentRuntime).mockRejectedValueOnce(
            Object.assign(new Error('Too many requests'), { status: 429 }),
        );

        await expect(mod.ensureDialogLoop()).resolves.toBeUndefined();
        expect(vi.mocked(nerv.emitNerv)).toHaveBeenCalledWith(
            'copilot:dialog:boot_blocked',
            expect.objectContaining({
                reason: 'sdk_rate_limit',
                actionHint: expect.stringContaining('/model auto'),
            }),
        );
    });

    it('envia turnos Copilot em modo watchdog-only e BYOK com guardião de inatividade', () => {
        expect(src).toContain('resolveOptionalDialogTimeout({');
        expect(src).toContain('explicitTimeoutMs: 0');
        expect(src).toContain('allowDisabled: true');
        expect(src).toContain('byok_provider_watchdog_only');
        expect(src).toContain('allowDisabled: false');
        expect(src).toContain('timeout: timeoutDecision.timeoutMs');
    });

    it('prefere assistant.usage moderno no footer e usa snapshot request-based apenas como fallback legacy', () => {
        expect(src).toContain('latestRuntimeState.lastLlmUsage');
        expect(src).toContain('const usageInfo = llmUsage ?? prInfo');
        expect(src).toContain('billing/quota legacy');
        expect(src).not.toContain("llmUsage['premiumRequest'] === false");
    });
});
