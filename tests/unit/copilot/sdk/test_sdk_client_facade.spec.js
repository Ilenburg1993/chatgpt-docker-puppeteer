// @ts-check
import { describe, it, beforeEach } from 'node:test';
/**
 * tests/unit/copilot/sdk/test_sdk_client_facade.spec.js
 *
 * Testes para src/copilot/sdk/client-facade.js (Faixa 5 — Client & Session Facade).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock do SDK
vi.mock('@github/copilot-sdk', () => ({
    approveAll: Object.assign(async () => ({ kind: 'approved' }), { _isMockApproveAll: true }),
    CopilotClient: vi.fn(),
    SYSTEM_PROMPT_SECTIONS: {
        identity: { description: 'Identity' },
        tone: { description: 'Tone' },
        tool_efficiency: { description: 'Tool efficiency' },
        environment_context: { description: 'Environment' },
        code_change_rules: { description: 'Code changes' },
        guidelines: { description: 'Guidelines' },
        safety: { description: 'Safety' },
        tool_instructions: { description: 'Tool instructions' },
        custom_instructions: { description: 'Custom instructions' },
        last_instructions: { description: 'Last instructions' },
    },
    defineTool: vi.fn(),
}));

// Hoisted mock functions (necessário para vi.mock factories)
const {
    mockGetClient,
    mockStopClient,
    mockGetClientState,
    mockForceStopClient,
    mockCreateSession,
    mockResumeOrCreate,
    mockDisconnectSession,
} = vi.hoisted(() => ({
    mockGetClient: vi.fn(),
    mockStopClient: vi.fn(),
    mockGetClientState: vi.fn(),
    mockForceStopClient: vi.fn(),
    mockCreateSession: vi.fn(),
    mockResumeOrCreate: vi.fn(),
    mockDisconnectSession: vi.fn(),
}));

// Mock dos módulos internos
vi.mock('../../../../src/copilot/sdk/client.js', () => ({
    getClient: mockGetClient,
    stopClient: mockStopClient,
    getClientState: mockGetClientState,
    forceStopClient: mockForceStopClient,
    buildClientOptions: vi.fn(),
    createClientSession: vi.fn(),
    deleteClientSession: vi.fn(),
    disconnectClientSession: vi.fn(),
    getActiveSessionCount: vi.fn(),
    getAuthStatus: vi.fn(),
    getClientSession: vi.fn(),
    getClientStatus: vi.fn(),
    incrementSessionMessageCount: vi.fn(),
    listActiveClientSessions: vi.fn(),
    listAllClientSessions: vi.fn(),
    listAvailableModels: vi.fn(),
    pingClient: vi.fn(),
    resumeClientSession: vi.fn(),
    _injectClientForTest: vi.fn(),
    _resetClientState: vi.fn(),
}));

vi.mock('../../../../src/copilot/sdk/session.js', () => ({
    createSession: mockCreateSession,
    resumeSession: vi.fn(),
    resumeOrCreate: mockResumeOrCreate,
    disconnectSession: mockDisconnectSession,
    createClientFromCliUrl: vi.fn(),
    deleteSession: vi.fn(),
    listSessions: vi.fn(),
}));

vi.mock('#copilot/config/session-config', () => ({
    buildAlwaysAliveConfig: vi.fn(),
    buildReadOnlyConfig: vi.fn(),
    buildFullAccessConfig: vi.fn(),
    buildDiagnosticConfig: vi.fn(),
}));

vi.mock('#copilot/config/env', () => ({
    COPILOT_CLI_URL: undefined,
    OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
}));

vi.mock('#copilot/observability/logger', () => ({
    log: vi.fn(),
}));

import {
    buildConfig,
    ensureClient,
    getDefaults,
    isClientReady,
    quickDisconnect,
    quickResume,
    quickSession,
    shutdownClient,
} from '../../../../src/copilot/sdk/client-facade.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockClient = { createSession: vi.fn(), resumeSession: vi.fn() };
const mockSession = { sessionId: 'sess-123', disconnect: vi.fn() };
const mockResult = { session: mockSession, isResumed: false, sessionId: 'sess-123' };

beforeEach(() => {
    vi.clearAllMocks();
    mockGetClient.mockResolvedValue(mockClient);
    mockCreateSession.mockResolvedValue(mockResult);
    mockResumeOrCreate.mockResolvedValue({ ...mockResult, isResumed: true });
    mockStopClient.mockResolvedValue([]);
});

// ─── quickSession ─────────────────────────────────────────────────────────────

describe('quickSession()', () => {
    it('chama getClient e createSession', async () => {
        const result = await quickSession({ model: 'claude-4' });
        expect(mockGetClient).toHaveBeenCalledOnce();
        expect(mockCreateSession).toHaveBeenCalledWith(mockClient, { model: 'claude-4' });
        expect(result.sessionId).toBe('sess-123');
    });

    it('aceita opts vazio', async () => {
        await quickSession();
        expect(mockCreateSession).toHaveBeenCalledWith(mockClient, {});
    });
});

// ─── quickResume ──────────────────────────────────────────────────────────────

describe('quickResume()', () => {
    it('chama getClient e resumeOrCreate com sessionId', async () => {
        const result = await quickResume('old-session-id', { model: 'gpt-4.1' });
        expect(mockGetClient).toHaveBeenCalledOnce();
        expect(mockResumeOrCreate).toHaveBeenCalledWith(mockClient, 'old-session-id', { model: 'gpt-4.1' });
        expect(result.isResumed).toBe(true);
    });

    it('aceita sessionId null para criar nova', async () => {
        await quickResume(null);
        expect(mockResumeOrCreate).toHaveBeenCalledWith(mockClient, null, {});
    });
});

// ─── quickDisconnect ──────────────────────────────────────────────────────────

describe('quickDisconnect()', () => {
    it('delega para disconnectSession', async () => {
        await quickDisconnect(/** @type {any} */ (mockSession));
        expect(mockDisconnectSession).toHaveBeenCalledWith(mockSession);
    });
});

// ─── ensureClient ─────────────────────────────────────────────────────────────

describe('ensureClient()', () => {
    it('retorna client via getClient', async () => {
        const client = await ensureClient();
        expect(client).toBe(mockClient);
    });
});

// ─── shutdownClient ───────────────────────────────────────────────────────────

describe('shutdownClient()', () => {
    it('chama stopClient por default', async () => {
        const errors = await shutdownClient();
        expect(mockStopClient).toHaveBeenCalledOnce();
        expect(errors).toEqual([]);
    });

    it('chama forceStopClient quando force=true', async () => {
        const errors = await shutdownClient({ force: true });
        expect(mockForceStopClient).toHaveBeenCalledOnce();
        expect(errors).toEqual([]);
    });
});

// ─── isClientReady ────────────────────────────────────────────────────────────

describe('isClientReady()', () => {
    it('retorna true quando state é connected', () => {
        mockGetClientState.mockReturnValue('connected');
        expect(isClientReady()).toBe(true);
    });

    it('retorna false quando state não é connected', () => {
        mockGetClientState.mockReturnValue('disconnected');
        expect(isClientReady()).toBe(false);
    });

    it('retorna false quando not_started', () => {
        mockGetClientState.mockReturnValue('not_started');
        expect(isClientReady()).toBe(false);
    });
});

// ─── getDefaults (alias) ──────────────────────────────────────────────────────

describe('getDefaults()', () => {
    it('retorna project defaults com model e streaming', () => {
        const d = getDefaults();
        expect(d.model).toBe('gpt-4.1');
        expect(d.streaming).toBe(true);
    });
});

// ─── buildConfig (alias) ──────────────────────────────────────────────────────

describe('buildConfig()', () => {
    it('constrói config com merge de defaults', () => {
        const cfg = buildConfig({ model: 'claude-4' });
        expect(cfg.model).toBe('claude-4');
        expect(cfg.streaming).toBe(true);
    });
});

// ─── Barrel re-export ─────────────────────────────────────────────────────────

describe('sdk/index.js barrel re-exports client-facade', () => {
    it('re-exporta as funções principais', async () => {
        const barrel = await import('../../../../src/copilot/sdk/index.js');
        expect(typeof barrel.quickSession).toBe('function');
        expect(typeof barrel.quickResume).toBe('function');
        expect(typeof barrel.quickDisconnect).toBe('function');
        expect(typeof barrel.ensureClient).toBe('function');
        expect(typeof barrel.shutdownClient).toBe('function');
        expect(typeof barrel.isClientReady).toBe('function');
    });
});
