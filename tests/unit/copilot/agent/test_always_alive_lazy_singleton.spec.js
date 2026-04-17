// @ts-check

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    AlwaysAliveAgent,
    alwaysAliveAgent,
    getAgent,
    resetAgent,
} from '../../../../src/copilot/agent/always-alive.js';

describe('AlwaysAliveAgent lazy singleton (K8)', () => {
    afterEach(() => {
        resetAgent();
    });

    it('getAgent retorna a mesma instância enquanto não houver reset', () => {
        resetAgent();
        const first = getAgent();
        const second = getAgent();

        expect(first).toBeInstanceOf(AlwaysAliveAgent);
        expect(first).toBe(second);
    });

    it('alwaysAliveAgent expõe a instância lazy via proxy compatível', () => {
        resetAgent();
        const handler = vi.fn();

        alwaysAliveAgent.on('lazy.proxy.test', handler);
        getAgent().emit('lazy.proxy.test', { ok: true });

        expect(alwaysAliveAgent).toBeInstanceOf(AlwaysAliveAgent);
        expect(handler).toHaveBeenCalledWith({ ok: true });

        alwaysAliveAgent.off('lazy.proxy.test', handler);
        expect(getAgent().listenerCount('lazy.proxy.test')).toBe(0);
    });

    it('proxy suporta override de propriedades para testes via defineProperty/delete', () => {
        resetAgent();
        const agent = getAgent();

        Object.defineProperty(alwaysAliveAgent, 'status', {
            get: () => 'idle',
            configurable: true,
        });

        expect(alwaysAliveAgent.status).toBe('idle');

        delete alwaysAliveAgent.status;

        expect(alwaysAliveAgent.status).toBe(agent.status);
    });

    it('resetAgent cria nova instância no próximo acesso', () => {
        resetAgent();
        const first = getAgent();

        resetAgent();
        const second = getAgent();

        expect(second).toBeInstanceOf(AlwaysAliveAgent);
        expect(second).not.toBe(first);
    });
});
