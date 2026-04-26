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
        approveAll: vi.fn().mockResolvedValue({ kind: 'approved' }),
    };
});

import {
    createClientFromCliUrl,
    createSession,
    deleteSession,
    disconnectSession,
    listSessions,
    resumeSession,
} from '../../../../src/copilot/sdk/session/lifecycle.js';

function fakeClient(overrides = {}) {
    return {
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
    });

    it('createSession converte erro do SDK em SdkOperationError', async () => {
        const client = fakeClient({
            createSession: vi.fn().mockRejectedValue(new Error('create failed')),
        });

        await expect(createSession(client, { model: 'gpt-4.1' })).rejects.toBeInstanceOf(SdkOperationError);
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
        expect(copilotCtor).toHaveBeenCalledWith({ cliUrl: 'http://localhost:3111' });
    });
});
