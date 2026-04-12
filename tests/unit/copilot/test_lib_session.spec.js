// @ts-check
/**
 * Sprint 10 — Testes unitários de src/copilot/lib/session.js
 *
 * Cobre: buildSystemMessageConfig (via createSession), resumeOrCreate fallback, createClientFromCliUrl, e comportamento
 * dos parametros de configuracao.
 *
 * CopilotClient REAL nao e instanciado — todos os testes usam mocks.
 */
import assert from 'node:assert';
import { describe, it } from 'node:test';

// ─── mock de CopilotClient ───────────────────────────────────────────────────

/**
 * @param {{ sessionId?: string; shouldFailResume?: boolean }} [opts]
 * @returns {any}
 */
function makeMockClient(opts = {}) {
    const sessionId = opts.sessionId ?? 'mock-session-001';
    const shouldFailResume = opts.shouldFailResume ?? false;

    return {
        createSession: async (/** @type {any} */ config) => ({
            sessionId,
            disconnect: async () => {},
            send: async () => {},
            sendAndWait: async () => undefined,
            _config: config,
        }),
        resumeSession: async (/** @type {string} */ id, /** @type {any} */ config) => {
            if (shouldFailResume) throw new Error('Session not found: ' + id);
            return {
                sessionId: id,
                disconnect: async () => {},
                send: async () => {},
                _config: config,
            };
        },
        listSessions: async (/** @type {any} */ filter) => [{ sessionId, filter }],
        deleteSession: async (/** @type {string} */ id) => ({ deleted: id }),
        getState: () => 'connected',
    };
}

// ─── imports ─────────────────────────────────────────────────────────────────

describe('lib/session › imports', () => {
    it('importa sem erros', async () => {
        const mod = await import('#copilot/sdk/session');
        assert.ok(typeof mod.createSession === 'function');
        assert.ok(typeof mod.resumeSession === 'function');
        assert.ok(typeof mod.resumeOrCreate === 'function');
        assert.ok(typeof mod.listSessions === 'function');
        assert.ok(typeof mod.deleteSession === 'function');
        assert.ok(typeof mod.disconnectSession === 'function');
        assert.ok(typeof mod.createClientFromCliUrl === 'function');
    });
});

// ─── createSession ────────────────────────────────────────────────────────────

describe('lib/session › createSession', () => {
    it('cria sessao com client mock e retorna result correto', async () => {
        const { createSession } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'new-sess-abc' });
        const result = await createSession(client, { model: 'gpt-4.1' });
        assert.strictEqual(result.sessionId, 'new-sess-abc');
        assert.strictEqual(result.isResumed, false);
        assert.ok(result.session);
    });

    it('usa gpt-4.1 como model padrao', async () => {
        const { createSession } = await import('#copilot/sdk/session');
        const capturedConfigs = /** @type {any[]} */ ([]);
        const client = {
            ...makeMockClient(),
            createSession: async (/** @type {any} */ cfg) => {
                capturedConfigs.push(cfg);
                return { sessionId: 'x', disconnect: async () => {} };
            },
        };
        await createSession(client);
        assert.ok(capturedConfigs.length > 0);
        // model deve ser 'gpt-4.1' (default)
        assert.strictEqual(capturedConfigs[0].model, 'gpt-4.1');
    });

    it('inclui systemMessage quando systemMessageContent fornecido', async () => {
        const { createSession } = await import('#copilot/sdk/session');
        const capturedConfigs = /** @type {any[]} */ ([]);
        const client = {
            ...makeMockClient(),
            createSession: async (/** @type {any} */ cfg) => {
                capturedConfigs.push(cfg);
                return { sessionId: 'y', disconnect: async () => {} };
            },
        };
        await createSession(client, { systemMessageContent: 'contexto de teste' });
        const cfg = capturedConfigs[0];
        assert.ok(cfg.systemMessage, 'deve ter systemMessage');
        // SDK-03 (update): SDK v0.2.0 usa { mode: 'customize', content }
        assert.strictEqual(cfg.systemMessage.mode, 'customize');
        assert.strictEqual(cfg.systemMessage.content, 'contexto de teste');
    });

    it('nao inclui systemMessage quando systemMessage=false', async () => {
        const { createSession } = await import('#copilot/sdk/session');
        const capturedConfigs = /** @type {any[]} */ ([]);
        const client = {
            ...makeMockClient(),
            createSession: async (/** @type {any} */ cfg) => {
                capturedConfigs.push(cfg);
                return { sessionId: 'z', disconnect: async () => {} };
            },
        };
        await createSession(client, { systemMessage: false });
        assert.strictEqual(capturedConfigs[0].systemMessage, undefined);
    });
});

// ─── resumeSession ────────────────────────────────────────────────────────────

describe('lib/session › resumeSession', () => {
    it('retoma sessao existente e retorna isResumed=true', async () => {
        const { resumeSession } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'resume-001' });
        const result = await resumeSession(client, 'resume-001');
        assert.strictEqual(result.sessionId, 'resume-001');
        assert.strictEqual(result.isResumed, true);
    });

    it('lanca erro quando sessao nao existe', async () => {
        const { resumeSession } = await import('#copilot/sdk/session');
        const client = makeMockClient({ shouldFailResume: true });
        await assert.rejects(
            () => resumeSession(client, 'nao-existe'),
            (/** @type {any} */ e) => e.message.includes('Session not found'),
        );
    });
});

// ─── resumeOrCreate ───────────────────────────────────────────────────────────

describe('lib/session › resumeOrCreate', () => {
    it('cria sessao nova quando existingSessionId e null', async () => {
        const { resumeOrCreate } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'newly-created' });
        const result = await resumeOrCreate(client, null);
        assert.strictEqual(result.isResumed, false);
        assert.strictEqual(result.sessionId, 'newly-created');
    });

    it('retoma sessao quando existingSessionId e fornecido e valido', async () => {
        const { resumeOrCreate } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'existing-001' });
        const result = await resumeOrCreate(client, 'existing-001');
        assert.strictEqual(result.isResumed, true);
        assert.strictEqual(result.sessionId, 'existing-001');
    });

    it('cria sessao nova quando resume falha (fallback)', async () => {
        const { resumeOrCreate } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'fallback-new', shouldFailResume: true });
        const result = await resumeOrCreate(client, 'sessao-expirada');
        assert.strictEqual(result.isResumed, false);
        assert.strictEqual(result.sessionId, 'fallback-new');
    });
});

// ─── listSessions ─────────────────────────────────────────────────────────────

describe('lib/session › listSessions', () => {
    it('retorna array do client', async () => {
        const { listSessions } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'list-001' });
        const list = await listSessions(client);
        assert.ok(Array.isArray(list));
    });
});

// ─── deleteSession ────────────────────────────────────────────────────────────

describe('lib/session › deleteSession', () => {
    it('nao lanca erro ao deletar sessao existente', async () => {
        const { deleteSession } = await import('#copilot/sdk/session');
        const client = makeMockClient({ sessionId: 'del-001' });
        await assert.doesNotReject(() => deleteSession(client, 'del-001'));
    });
});

// ─── disconnectSession ────────────────────────────────────────────────────────

describe('lib/session › disconnectSession', () => {
    it('chama disconnect na sessao', async () => {
        const { disconnectSession } = await import('#copilot/sdk/session');
        let disconnectCalled = false;
        const mockSession = /** @type {any} */ ({
            sessionId: 'disc-001',
            disconnect: async () => {
                disconnectCalled = true;
            },
        });
        await disconnectSession(mockSession);
        assert.ok(disconnectCalled, 'disconnect deve ter sido chamado');
    });
});

// ─── createClientFromCliUrl ───────────────────────────────────────────────────

describe('lib/session › createClientFromCliUrl', () => {
    it('retorna um objeto (CopilotClient) — sem conectar', async () => {
        const { createClientFromCliUrl } = await import('#copilot/sdk/session');
        // CopilotClient nao conecta no construtor — apenas configura
        const client = createClientFromCliUrl('http://localhost:9999');
        assert.ok(client);
        assert.ok(typeof client === 'object');
    });
});
