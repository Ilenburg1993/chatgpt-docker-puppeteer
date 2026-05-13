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

vi.mock('../../../src/copilot/presentation/agent/runtime/index.js', () => ({
    requireAgentRuntimeSelection: (/** @type {string | null | undefined} */ runtimeId) => {
        if (runtimeId === 'missing') {
            throw Object.assign(new Error("Runtime 'missing' não encontrado."), {
                name: 'NotFoundError',
                code: 'AGENT_RUNTIME_NOT_FOUND',
                status: 404,
            });
        }
        return {
            requestedRuntimeId: runtimeId ?? null,
            runtimeId: runtimeId ?? 'default',
            runtime: mocks.agent,
            runtimeFound: true,
            usedDefaultRuntimeFallback: false,
            defaultRuntimeId: 'default',
        };
    },
}));

describe('presentation/runtime/webhooks.js', () => {
    it('encapsula list/register/unregister do runtime default', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime/webhooks.js');

        expect(mod.listRuntimeWebhooks()).toEqual([{ id: 'wh-1', url: 'https://example.test/hook' }]);
        expect(mod.registerRuntimeWebhook('https://hook.test')).toEqual({ id: 'wh-1', url: 'https://hook.test' });
        expect(mod.unregisterRuntimeWebhook('wh-1')).toBe(true);

        expect(mocks.listWebhooks).toHaveBeenCalledTimes(1);
        expect(mocks.registerWebhook).toHaveBeenCalledWith('https://hook.test');
        expect(mocks.unregisterWebhook).toHaveBeenCalledWith('wh-1');
    });

    it('aceita runtimeId explícito para seleção futura de runtime', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime/webhooks.js');

        mod.listRuntimeWebhooks('alt');
        mod.registerRuntimeWebhook('https://hook.alt', 'alt');
        mod.unregisterRuntimeWebhook('wh-1', 'alt');

        expect(mocks.listWebhooks).toHaveBeenCalled();
        expect(mocks.registerWebhook).toHaveBeenCalledWith('https://hook.alt');
        expect(mocks.unregisterWebhook).toHaveBeenCalledWith('wh-1');
    });

    it('rejeita runtimeId explícito inexistente em vez de cair silenciosamente no default', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime/webhooks.js');

        expect(() => mod.resolveRuntimeWebhookSelection('missing')).toThrow("Runtime 'missing' não encontrado.");
    });

    it('projeta payload HTTP canônico para list/register/unregister quando o runtime existe', async () => {
        const mod = await import('../../../src/copilot/presentation/runtime/webhooks.js');

        expect(mod.buildRuntimeWebhooksListHttpPayload('alt')).toEqual(
            expect.objectContaining({
                ok: true,
                runtimeId: 'alt',
                requestedRuntimeId: 'alt',
                runtimeFound: true,
                usedDefaultRuntimeFallback: false,
                count: 1,
                webhooks: [{ id: 'wh-1', url: 'https://example.test/hook' }],
            }),
        );

        expect(mod.registerRuntimeWebhookHttp('https://hook.test/new', 'alt')).toEqual(
            expect.objectContaining({
                ok: true,
                runtimeId: 'alt',
                requestedRuntimeId: 'alt',
                id: 'wh-1',
                url: 'https://hook.test/new',
            }),
        );

        expect(mod.unregisterRuntimeWebhookHttp('wh-1', 'alt')).toEqual(
            expect.objectContaining({
                ok: true,
                runtimeId: 'alt',
                requestedRuntimeId: 'alt',
                id: 'wh-1',
            }),
        );
    });
});
