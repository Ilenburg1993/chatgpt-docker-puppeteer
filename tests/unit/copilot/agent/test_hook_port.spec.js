// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    attachBus: vi.fn((hooks) => hooks),
    classifySdkRateLimitScope: vi.fn(() => 'session'),
    defaultHookBus: { on: vi.fn(), off: vi.fn() },
    modelSelector: { suggestFallback: vi.fn(() => null) },
    getCopilotFallbackModel: vi.fn(() => null),
    recordBlockedToolCall: vi.fn(),
    defaultAuditLog: { record: vi.fn() },
    log: vi.fn(),
}));

vi.mock('#copilot/sdk', () => ({
    attachBus: mocks.attachBus,
    classifySdkRateLimitScope: mocks.classifySdkRateLimitScope,
    defaultHookBus: mocks.defaultHookBus,
    modelSelector: mocks.modelSelector,
}));

vi.mock('#copilot/observability', () => ({
    recordBlockedToolCall: mocks.recordBlockedToolCall,
}));

vi.mock('#copilot/audit', () => ({
    defaultAuditLog: mocks.defaultAuditLog,
}));

vi.mock('#copilot/config', () => ({
    getCopilotFallbackModel: mocks.getCopilotFallbackModel,
}));

vi.mock('../../../../src/copilot/agent/ports/logging-port.js', () => ({
    log: mocks.log,
}));

const { buildAgentBusHooks, withAgentRuntimeToolPolicy } = await import(
    '../../../../src/copilot/agent/ports/hook-port.js'
);

describe('agent/ports/hook-port', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCopilotFallbackModel.mockReturnValue(null);
    });

    it('registra blocked metric quando runtime policy nega a tool', async () => {
        const downstream = vi.fn(async () => ({ permissionDecision: 'allow' }));
        const hooks = withAgentRuntimeToolPolicy(
            /** @type {any} */ ({ onPreToolUse: downstream }),
            (toolName) => toolName === 'danger.tool',
        );

        const result = await hooks.onPreToolUse?.(
            /** @type {any} */ ({ toolName: 'danger.tool', toolArgs: {}, timestamp: 0, cwd: '/' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(result).toEqual(expect.objectContaining({ permissionDecision: 'deny' }));
        expect(mocks.recordBlockedToolCall).toHaveBeenCalledWith('danger.tool');
        expect(downstream).not.toHaveBeenCalled();
    });

    it('registra blocked metric quando hook downstream nega a tool', async () => {
        const downstream = vi.fn(async () => ({ permissionDecision: 'deny' }));
        const hooks = withAgentRuntimeToolPolicy(/** @type {any} */ ({ onPreToolUse: downstream }), () => false);

        const result = await hooks.onPreToolUse?.(
            /** @type {any} */ ({ toolName: 'shell.exec', toolArgs: {}, timestamp: 0, cwd: '/' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(result).toEqual(expect.objectContaining({ permissionDecision: 'deny' }));
        expect(mocks.recordBlockedToolCall).toHaveBeenCalledWith('shell.exec');
        expect(downstream).toHaveBeenCalledTimes(1);
    });

    it('não registra blocked metric quando a tool é permitida', async () => {
        const downstream = vi.fn(async () => ({ permissionDecision: 'allow' }));
        const hooks = withAgentRuntimeToolPolicy(/** @type {any} */ ({ onPreToolUse: downstream }), () => false);

        const result = await hooks.onPreToolUse?.(
            /** @type {any} */ ({ toolName: 'git.status', toolArgs: {}, timestamp: 0, cwd: '/' }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(result).toEqual(expect.objectContaining({ permissionDecision: 'allow' }));
        expect(mocks.recordBlockedToolCall).not.toHaveBeenCalled();
    });

    it('normaliza erro vazio do SDK para mensagem acionável no hook errorOccurred', async () => {
        const emit = vi.fn();
        const hooks = buildAgentBusHooks({
            emitWebhook: vi.fn(async () => {}),
            getModel: () => 'auto',
            scheduleFallback: vi.fn(),
            emit,
            metrics: { recordSessionStart: vi.fn(), recordSessionEnd: vi.fn() },
        });

        const result = await hooks.onErrorOccurred?.(
            /** @type {any} */ ({ error: {}, errorContext: 'model_call', recoverable: true }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(emit).toHaveBeenCalledWith(
            'error',
            expect.objectContaining({ errorMessage: 'Erro do SDK sem mensagem estruturada.' }),
        );
        expect(mocks.log).toHaveBeenCalledWith(
            'WARN',
            expect.stringContaining('Erro do SDK sem mensagem estruturada.'),
        );
    });

    it('aplica fallback live para auto quando model_call recuperável ocorre em modelo explícito', async () => {
        mocks.getCopilotFallbackModel.mockReturnValue('auto');
        const emit = vi.fn();
        const applyModelFallback = vi.fn(() => true);
        const scheduleFallback = vi.fn();
        const hooks = buildAgentBusHooks({
            emitWebhook: vi.fn(async () => {}),
            getModel: () => 'gpt-5.4',
            scheduleFallback,
            applyModelFallback,
            emit,
            metrics: { recordSessionStart: vi.fn(), recordSessionEnd: vi.fn() },
        });

        const result = await hooks.onErrorOccurred?.(
            /** @type {any} */ ({ error: {}, errorContext: 'model_call', recoverable: true }),
            /** @type {any} */ ({ sessionId: 's1' }),
        );

        expect(applyModelFallback).toHaveBeenCalledWith(
            'auto',
            expect.objectContaining({
                previousModel: 'gpt-5.4',
                reason: 'recoverable_model_call_on_explicit_model',
                sessionId: 's1',
            }),
        );
        expect(scheduleFallback).not.toHaveBeenCalled();
        expect(result).toEqual(expect.objectContaining({ errorHandling: 'abort' }));
        expect(emit).toHaveBeenCalledWith(
            'error',
            expect.objectContaining({ errorContext: 'model_call', recoverable: true }),
        );
    });
});
