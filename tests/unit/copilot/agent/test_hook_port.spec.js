// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    attachBus: vi.fn((hooks) => hooks),
    classifySdkRateLimitScope: vi.fn(() => 'session'),
    defaultHookBus: { on: vi.fn(), off: vi.fn() },
    modelSelector: { suggestFallback: vi.fn(() => null) },
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
    getCopilotFallbackModel: vi.fn(() => null),
}));

vi.mock('../../../../src/copilot/agent/ports/logging-port.js', () => ({
    log: mocks.log,
}));

const { withAgentRuntimeToolPolicy } = await import('../../../../src/copilot/agent/ports/hook-port.js');

describe('agent/ports/hook-port', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
