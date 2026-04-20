// @ts-check

import { afterEach, describe, expect, it } from 'vitest';

import { getAgent, resetAgent } from '../../../../src/copilot/agent/always-alive.js';
import {
    clearAgentRuntimeRegistry,
    DEFAULT_AGENT_RUNTIME_ID,
    getDefaultAgentRuntimeId,
    getDefaultRegisteredAgentRuntime,
    getRegisteredAgentRuntime,
    hasAgentRuntime,
    listAgentRuntimes,
    registerAgentRuntime,
    setDefaultAgentRuntimeId,
    unregisterAgentRuntime,
} from '../../../../src/copilot/agent/runtime-registry.js';

describe('agent/runtime-registry', () => {
    afterEach(() => {
        resetAgent();
        clearAgentRuntimeRegistry();
    });

    it('getAgent registra o runtime default lazy na registry', () => {
        const agent = getAgent();

        expect(getDefaultAgentRuntimeId()).toBe(DEFAULT_AGENT_RUNTIME_ID);
        expect(hasAgentRuntime()).toBe(true);
        expect(getRegisteredAgentRuntime()).toBe(agent);
        expect(getDefaultRegisteredAgentRuntime()).toBe(agent);
        expect(listAgentRuntimes()).toEqual([{ runtimeId: DEFAULT_AGENT_RUNTIME_ID, runtime: agent }]);
    });

    it('suporta runtimes nomeados e troca explícita do runtime default', () => {
        const auditRuntime = /** @type {any} */ ({ status: 'idle', model: 'gpt-5-mini', sessionId: 'audit-1' });
        registerAgentRuntime(auditRuntime, 'audit');

        expect(hasAgentRuntime('audit')).toBe(true);
        expect(getRegisteredAgentRuntime('audit')).toBe(auditRuntime);

        setDefaultAgentRuntimeId('audit');

        expect(getDefaultAgentRuntimeId()).toBe('audit');
        expect(getDefaultRegisteredAgentRuntime()).toBe(auditRuntime);

        unregisterAgentRuntime('audit');
        expect(getRegisteredAgentRuntime('audit')).toBeNull();
        expect(getDefaultRegisteredAgentRuntime()).toBeNull();
    });

    it('rejeita troca do runtime default para ids não registrados', () => {
        expect(() => setDefaultAgentRuntimeId('missing')).toThrow('AGENT_RUNTIME_NOT_FOUND:missing');
    });
});
