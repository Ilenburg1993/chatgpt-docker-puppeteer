/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- test file uses untyped mocks extensively

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SdkOperationError } from '#copilot/sdk/errors';

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
    LOG_DIR: '/tmp/test-logs',
    getRecentLogs: vi.fn(() => []),
}));

const copilotCtor = vi.fn();

vi.mock('@github/copilot-sdk', () => {
    class MockCopilotClient {
        constructor(options) {
            this.options = options;
            copilotCtor(options);
        }
    }

    return {
        CopilotClient: MockCopilotClient,
        RuntimeConnection: {
            forUri: vi.fn((url, opts) => ({ kind: 'uri', url, ...(opts ?? {}) })),
            forStdio: vi.fn((opts) => ({ kind: 'stdio', ...(opts ?? {}) })),
            forTcp: vi.fn((opts) => ({ kind: 'tcp', ...(opts ?? {}) })),
        },
        approveAll: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
    };
});

import {
    createClientFromCliUrl,
    createSession,
    deleteSession,
    disconnectSession,
    listSessions,
    resolveSessionCreateModel,
    resumeSession,
    setSessionAutoModelResolver,
} from '../../../../src/copilot/sdk/session/lifecycle.js';
import { setSdkMetricEmitter } from '../../../../src/copilot/sdk/telemetry/operation-metrics.js';

/** @type {import('../../../../src/copilot/sdk/types.js').SdkOperationMetric[]} */
let metrics = [];

function fakeClient(overrides = {}) {
    return {
        start: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue({ sessionId: 's1' }),
        resumeSession: vi.fn().mockResolvedValue({ sessionId: 's2' }),
        listSessions: vi.fn().mockResolvedValue([{ id: 's1' }]),
        deleteSession: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('sdk/session/lifecycle core hardening', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        metrics = [];
        setSessionAutoModelResolver(null);
        setSdkMetricEmitter((metric) => metrics.push(metric));
    });

    it('createSession converte erro do SDK em SdkOperationError', async () => {
        const client = fakeClient({
            createSession: vi.fn().mockRejectedValue(new Error('create failed')),
        });

        await expect(createSession(client, { model: 'gpt-4.1' })).rejects.toBeInstanceOf(SdkOperationError);
    });

    it('createSession traduz createSessionFsHandler para createSessionFsProvider', async () => {
        const client = fakeClient();
        const sessionFsHandler = vi.fn();
        const elicitationHandler = vi.fn();
        const commandHandler = vi.fn();

        await createSession(client, {
            model: 'gpt-4.1',
            gitHubToken: 'ghs_session',
            createSessionFsHandler: sessionFsHandler,
            onElicitationRequest: elicitationHandler,
            commands: [{ name: 'diagnose', description: 'Diagnose', handler: commandHandler }],
            modelCapabilities: { supports: { vision: false } },
            enableConfigDiscovery: true,
            includeSubAgentStreamingEvents: false,
            defaultAgent: { excludedTools: ['shell'] },
        });

        expect(client.createSession).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-4.1',
                gitHubToken: 'ghs_session',
                createSessionFsProvider: sessionFsHandler,
                onElicitationRequest: elicitationHandler,
                commands: [expect.objectContaining({ name: 'diagnose', handler: commandHandler })],
                modelCapabilities: { supports: { vision: false } },
                enableConfigDiscovery: true,
                includeSubAgentStreamingEvents: false,
                defaultAgent: { excludedTools: ['shell'] },
            }),
        );
    });

    it('createSession aplica retry curto e emite métricas em falha transitória', async () => {
        const client = fakeClient({
            createSession: vi
                .fn()
                .mockRejectedValueOnce(Object.assign(new Error('conn reset'), { code: 'ECONNRESET' }))
                .mockResolvedValueOnce({ sessionId: 's1' }),
        });

        const result = await createSession(client, { model: 'gpt-4.1' });

        expect(result.sessionId).toBe('s1');
        expect(client.start).toHaveBeenCalledTimes(1);
        expect(client.createSession).toHaveBeenCalledTimes(2);
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining(['session.create:started', 'session.create:succeeded']),
        );
        expect(
            metrics.find((metric) => metric.operation === 'session.create' && metric.status === 'succeeded'),
        ).toMatchObject({
            attributes: expect.objectContaining({ attempt: 2, model: 'gpt-4.1' }),
        });
    });

    it('createSession permite configurar reasoning default do gpt-5-mini por env', async () => {
        const previous = process.env.COPILOT_GPT5_MINI_REASONING_EFFORT;
        process.env.COPILOT_GPT5_MINI_REASONING_EFFORT = 'medium';
        try {
            const client = fakeClient();
            await createSession(client, { model: 'gpt-5-mini' });
            expect(client.createSession).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-5-mini',
                    reasoningEffort: 'medium',
                }),
            );
        } finally {
            if (previous === undefined) {
                delete process.env.COPILOT_GPT5_MINI_REASONING_EFFORT;
            } else {
                process.env.COPILOT_GPT5_MINI_REASONING_EFFORT = previous;
            }
        }
    });

    it('createSession preserva model auto nativo do SDK sem resolver local', async () => {
        const client = fakeClient();
        const resolver = vi.fn().mockResolvedValue('resolved-auto-model');
        setSessionAutoModelResolver(resolver);

        await createSession(client, { model: 'auto', reasoningEffort: 'high' });

        expect(resolver).not.toHaveBeenCalled();
        expect(client.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'auto' }));
        expect(client.createSession).toHaveBeenCalledWith(
            expect.not.objectContaining({
                reasoningEffort: 'high',
            }),
        );
    });

    it('resolveSessionCreateModel retorna modelo explícito sem acionar resolver', async () => {
        const resolver = vi.fn().mockResolvedValue('should-not-run');
        setSessionAutoModelResolver(resolver);

        await expect(resolveSessionCreateModel('gpt-4.1')).resolves.toBe('gpt-4.1');
        expect(resolver).not.toHaveBeenCalled();
    });

    it('resolveSessionCreateModel preserva auto para seleção nativa do SDK', async () => {
        const resolver = vi.fn().mockResolvedValue('should-not-run');
        setSessionAutoModelResolver(resolver);

        await expect(resolveSessionCreateModel('auto')).resolves.toBe('auto');
        expect(resolver).not.toHaveBeenCalled();
    });

    it('resumeSession valida sessionId não-vazio', async () => {
        const client = fakeClient();
        await expect(resumeSession(client, '')).rejects.toThrow(TypeError);
    });

    it('resumeSession converte erro do SDK em SdkOperationError', async () => {
        const client = fakeClient({
            resumeSession: vi.fn().mockRejectedValue(new Error('resume failed')),
        });

        await expect(resumeSession(client, 's2')).rejects.toBeInstanceOf(SdkOperationError);
    });

    it('resumeSession traduz createSessionFsHandler para createSessionFsProvider', async () => {
        const client = fakeClient();
        const sessionFsHandler = vi.fn();
        const elicitationHandler = vi.fn();
        const commandHandler = vi.fn();

        await resumeSession(client, 's2', {
            gitHubToken: 'ghs_resume',
            createSessionFsHandler: sessionFsHandler,
            onElicitationRequest: elicitationHandler,
            commands: [{ name: 'resume-diagnose', handler: commandHandler }],
            modelCapabilities: { supports: { vision: true } },
            enableConfigDiscovery: true,
            includeSubAgentStreamingEvents: false,
            defaultAgent: { availableTools: ['read_file'] },
        });

        expect(client.resumeSession).toHaveBeenCalledWith(
            's2',
            expect.objectContaining({
                gitHubToken: 'ghs_resume',
                createSessionFsProvider: sessionFsHandler,
                onElicitationRequest: elicitationHandler,
                commands: [expect.objectContaining({ name: 'resume-diagnose', handler: commandHandler })],
                modelCapabilities: { supports: { vision: true } },
                enableConfigDiscovery: true,
                includeSubAgentStreamingEvents: false,
                defaultAgent: { availableTools: ['read_file'] },
            }),
        );
    });

    it('resumeSession preserva model="auto" nativo e omite reasoningEffort sem modelo concreto', async () => {
        const client = fakeClient();

        await resumeSession(client, 's2', {
            model: 'auto',
            reasoningEffort: 'high',
        });

        expect(client.resumeSession).toHaveBeenCalledWith(
            's2',
            expect.objectContaining({
                model: 'auto',
            }),
        );
        expect(client.resumeSession).toHaveBeenCalledWith(
            's2',
            expect.not.objectContaining({
                reasoningEffort: 'high',
            }),
        );
    });

    it('resumeSession aplica retry curto, reconnect best-effort e métricas em timeout', async () => {
        const client = fakeClient({
            resumeSession: vi
                .fn()
                .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
                .mockResolvedValueOnce({ sessionId: 's2' }),
        });

        const result = await resumeSession(client, 's2');

        expect(result.sessionId).toBe('s2');
        expect(client.start).toHaveBeenCalledTimes(1);
        expect(client.resumeSession).toHaveBeenCalledTimes(2);
        expect(metrics.map((metric) => `${metric.operation}:${metric.status}`)).toEqual(
            expect.arrayContaining(['session.resume:started', 'session.resume:succeeded']),
        );
        expect(
            metrics.find((metric) => metric.operation === 'session.resume' && metric.status === 'succeeded'),
        ).toMatchObject({
            attributes: expect.objectContaining({ attempt: 2, sessionId: 's2' }),
        });
    });

    it('listSessions converte erro do SDK em SdkOperationError', async () => {
        const client = fakeClient({
            listSessions: vi.fn().mockRejectedValue(new Error('list failed')),
        });

        await expect(listSessions(client)).rejects.toBeInstanceOf(SdkOperationError);
    });

    it('deleteSession valida sessionId e normaliza erro', async () => {
        const client = fakeClient();
        await expect(deleteSession(client, '')).rejects.toThrow(TypeError);

        const broken = fakeClient({
            deleteSession: vi.fn().mockRejectedValue(new Error('delete failed')),
        });
        await expect(deleteSession(broken, 's1')).rejects.toBeInstanceOf(SdkOperationError);
    });

    it('disconnectSession valida sessão e normaliza erro', async () => {
        await expect(disconnectSession(null)).rejects.toThrow(TypeError);

        const session = {
            sessionId: 's1',
            disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')),
        };

        await expect(disconnectSession(session)).rejects.toBeInstanceOf(SdkOperationError);
    });

    it('createClientFromCliUrl valida cliUrl e instancia CopilotClient', () => {
        expect(() => createClientFromCliUrl('')).toThrow(TypeError);

        const client = createClientFromCliUrl('http://localhost:3111');
        expect(client).toBeDefined();
        expect(copilotCtor).toHaveBeenCalledWith({
            connection: { kind: 'uri', url: 'http://localhost:3111' },
        });
    });
});
