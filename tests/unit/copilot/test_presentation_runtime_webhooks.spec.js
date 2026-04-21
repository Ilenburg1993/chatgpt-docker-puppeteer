// @ts-check

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const listWebhooks = vi.fn(() => [{ id: 'wh-1', url: 'https://example.test/hook' }]);
    const registerWebhook = vi.fn((url) => ({ id: 'wh-1', url }));
    const unregisterWebhook = vi.fn((id) => id === 'wh-1');

    const agent = {
        listWebhooks,
        registerWebhook,
        unregisterWebhook,
    };

    return { agent, listWebhooks, registerWebhook, unregisterWebhook };
});

vi.mock('#copilot/agent', () => ({
    listAgentRuntimeWebhooks: mocks.listWebhooks,
    registerAgentRuntimeWebhook: (/** @type {unknown} */ _runtime, /** @type {string} */ url) =>
        mocks.registerWebhook(url),
    unregisterAgentRuntimeWebhook: (/** @type {unknown} */ _runtime, /** @type {string} */ id) =>
        mocks.unregisterWebhook(id),
}));

vi.mock('../../../src/copilot/presentation/agent-runtime.js', () => ({
    resolveAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => ({
        requestedRuntimeId: runtimeId ?? null,
        runtimeId: runtimeId === 'missing' ? 'default' : (runtimeId ?? 'default'),
        runtime: mocks.agent,
        runtimeFound: runtimeId !== 'missing',
        usedDefaultRuntimeFallback: runtimeId === 'missing',
        defaultRuntimeId: 'default',
    }),
}));

describe('presentation/runtime-webhooks.js', () => {
    it('encapsula list/register/unregister do runtime default', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-webhooks.js');

        expect(mod.listRuntimeWebhooks()).toEqual([{ id: 'wh-1', url: 'https://example.test/hook' }]);
        expect(mod.registerRuntimeWebhook('https://hook.test')).toEqual({ id: 'wh-1', url: 'https://hook.test' });
        expect(mod.unregisterRuntimeWebhook('wh-1')).toBe(true);

        expect(mocks.listWebhooks).toHaveBeenCalledTimes(1);
        expect(mocks.registerWebhook).toHaveBeenCalledWith('https://hook.test');
        expect(mocks.unregisterWebhook).toHaveBeenCalledWith('wh-1');
    });

    it('aceita runtimeId explícito para seleção futura de runtime', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-webhooks.js');

        mod.listRuntimeWebhooks('alt');
        mod.registerRuntimeWebhook('https://hook.alt', 'alt');
        mod.unregisterRuntimeWebhook('wh-1', 'alt');

        expect(mocks.listWebhooks).toHaveBeenCalled();
        expect(mocks.registerWebhook).toHaveBeenCalledWith('https://hook.alt');
        expect(mocks.unregisterWebhook).toHaveBeenCalledWith('wh-1');
    });

    it('expõe fallback explícito quando o runtime pedido não existe', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime-webhooks.js');

        expect(mod.resolveRuntimeWebhookSelection('missing')).toEqual(
            expect.objectContaining({
                requestedRuntimeId: 'missing',
                runtimeId: 'default',
                runtimeFound: false,
                usedDefaultRuntimeFallback: true,
            }),
        );
    });
});
