// @ts-check

import { afterEach, describe, expect, it } from 'vitest';

import { resetAgent } from '../../../src/copilot/agent/always-alive.js';
import {
    clearAgentRuntimeRegistry,
    registerAgentRuntime,
    setDefaultAgentRuntimeId,
} from '../../../src/copilot/agent/runtime-registry.js';
import {
    normalizeAgentContextWindowProjection,
    readAgentRuntimeOverview,
    readDefaultAgentRuntimeOverview,
} from '../../../src/copilot/presentation/runtime-overview.js';

describe('presentation/runtime-overview', () => {
    afterEach(() => {
        resetAgent();
        clearAgentRuntimeRegistry();
    });

    it('normaliza context window válido e rejeita payload inválido', () => {
        expect(normalizeAgentContextWindowProjection({ tokens: 10, tokenLimit: 100, utilization: 0.1 })).toEqual({
            tokens: 10,
            tokenLimit: 100,
            utilization: 0.1,
        });
        expect(normalizeAgentContextWindowProjection({ tokens: 'x' })).toBeNull();
        expect(normalizeAgentContextWindowProjection(null)).toBeNull();
    });

    it('lê o runtime default com snapshot, health e runtimes conhecidos', () => {
        const runtime = /** @type {any} */ ({
            status: 'idle',
            model: 'gpt-5-mini',
            sessionId: 'sess-1',
            getStatusSnapshot: () => ({
                status: 'idle',
                sessionId: 'sess-1',
                contextWindow: { tokens: 123, tokenLimit: 1000, utilization: 0.123 },
            }),
            getHealthSnapshot: () => ({ ok: true, status: 'healthy' }),
        });

        registerAgentRuntime(runtime, 'default');
        setDefaultAgentRuntimeId('default');

        const overview = readDefaultAgentRuntimeOverview();

        expect(overview.agent).toBe(runtime);
        expect(overview.requestedRuntimeId).toBeNull();
        expect(overview.runtimeId).toBe('default');
        expect(overview.runtimeFound).toBe(true);
        expect(overview.usedDefaultRuntimeFallback).toBe(false);
        expect(overview.runtimeSessionId).toBe('sess-1');
        expect(overview.contextWindow).toEqual({ tokens: 123, tokenLimit: 1000, utilization: 0.123 });
        expect(overview.health).toEqual({ ok: true, status: 'healthy' });
        expect(overview.agentRuntimes).toEqual([
            {
                runtimeId: 'default',
                status: 'idle',
                model: 'gpt-5-mini',
                sessionId: 'sess-1',
                isDefault: true,
            },
        ]);
    });

    it('lê runtime explícito por runtimeId sem quebrar a projection default', () => {
        const defaultRuntime = /** @type {any} */ ({
            status: 'idle',
            model: 'gpt-5-mini',
            sessionId: 'sess-default',
            getStatusSnapshot: () => ({ status: 'idle', sessionId: 'sess-default' }),
            getHealthSnapshot: () => ({ ok: true, status: 'healthy' }),
        });
        const altRuntime = /** @type {any} */ ({
            status: 'processing',
            model: 'gpt-5',
            sessionId: 'sess-alt',
            getStatusSnapshot: () => ({ status: 'processing', sessionId: 'sess-alt' }),
            getHealthSnapshot: () => ({ ok: true, status: 'degraded' }),
        });

        registerAgentRuntime(defaultRuntime, 'default');
        registerAgentRuntime(altRuntime, 'alt');
        setDefaultAgentRuntimeId('default');

        const overview = readAgentRuntimeOverview('alt');

        expect(overview.agent).toBe(altRuntime);
        expect(overview.requestedRuntimeId).toBe('alt');
        expect(overview.runtimeId).toBe('alt');
        expect(overview.runtimeFound).toBe(true);
        expect(overview.usedDefaultRuntimeFallback).toBe(false);
        expect(overview.runtimeSessionId).toBe('sess-alt');
        expect(overview.health).toEqual({ ok: true, status: 'degraded' });
    });

    it('expõe fallback explícito quando o runtime solicitado não existe', () => {
        const defaultRuntime = /** @type {any} */ ({
            status: 'idle',
            model: 'gpt-5-mini',
            sessionId: 'sess-default',
            getStatusSnapshot: () => ({ status: 'idle', sessionId: 'sess-default' }),
            getHealthSnapshot: () => ({ ok: true, status: 'healthy' }),
        });

        registerAgentRuntime(defaultRuntime, 'default');
        setDefaultAgentRuntimeId('default');

        const overview = readAgentRuntimeOverview('missing');

        expect(overview.agent).toBe(defaultRuntime);
        expect(overview.requestedRuntimeId).toBe('missing');
        expect(overview.runtimeId).toBe('default');
        expect(overview.runtimeFound).toBe(false);
        expect(overview.usedDefaultRuntimeFallback).toBe(true);
    });
});
