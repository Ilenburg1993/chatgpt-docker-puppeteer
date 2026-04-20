// @ts-check

import { afterEach, describe, expect, it } from 'vitest';

import { getAgent, resetAgent } from '../../../src/copilot/agent/always-alive.js';
import {
    clearAgentRuntimeRegistry,
    registerAgentRuntime,
    setDefaultAgentRuntimeId,
} from '../../../src/copilot/agent/runtime-registry.js';
import {
    getAgentRuntime,
    getDefaultAgentRuntime,
    getDefaultAgentRuntimeId,
    listKnownAgentRuntimes,
    requireAgentRuntime,
} from '../../../src/copilot/presentation/agent-runtime.js';

describe('presentation/agent-runtime', () => {
    afterEach(() => {
        resetAgent();
        clearAgentRuntimeRegistry();
    });

    it('resolve o runtime default a partir do singleton lazy quando necessário', () => {
        const runtime = getDefaultAgentRuntime();

        expect(runtime).toBe(getAgent());
        expect(getAgentRuntime()).toBe(runtime);
        expect(getDefaultAgentRuntimeId()).toBe('default');
    });

    it('consome runtimes nomeados quando a registry define outro default', () => {
        const auditRuntime = /** @type {any} */ ({
            status: 'idle',
            model: 'gpt-5-mini',
            sessionId: 'audit-1',
        });
        registerAgentRuntime(auditRuntime, 'audit');
        setDefaultAgentRuntimeId('audit');

        expect(getDefaultAgentRuntime()).toBe(auditRuntime);
        expect(getAgentRuntime('audit')).toBe(auditRuntime);
        expect(requireAgentRuntime('audit')).toBe(auditRuntime);
        expect(listKnownAgentRuntimes()).toEqual([
            {
                runtimeId: 'audit',
                status: 'idle',
                model: 'gpt-5-mini',
                sessionId: 'audit-1',
                isDefault: true,
            },
        ]);
    });

    it('lança erro quando requireAgentRuntime recebe id inexistente', () => {
        expect(() => requireAgentRuntime('missing')).toThrow('AGENT_RUNTIME_NOT_FOUND:missing');
    });
});
