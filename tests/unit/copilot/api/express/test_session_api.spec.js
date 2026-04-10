// @ts-check
/**
 * @file Faixa 37 — API Session CRUD + Messaging Test Suite (F197-F204)
 *
 *   Testes para src/copilot/api/express/session-crud.js e session-messaging.js:
 *
 *   - GET /sessions/active, GET /sessions/last, GET /sessions/foreground
 *   - PUT /sessions/foreground/:id
 *   - GET /sessions, GET /sessions/:id
 *   - POST /sessions (create)
 *   - DELETE /sessions/:id (com admin token + confirm header)
 *   - POST /sessions/:id/disconnect, resume
 *   - GET /sessions/:id/compaction-history
 *   - POST /sessions/:id/send
 *   - POST /sessions/:id/model, abort
 *   - GET /sessions/:id/messages
 *
 *   Usa supertest com Express app montado sobre os routers mockados.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const {
    mockLog,
    mockGetClient,
    mockListActiveSessions,
    mockGetSdkSession,
    mockDisconnectSdkSession,
    mockCreateSdkSession,
    mockResumeSdkSession,
    mockIncrementMessageCount,
    mockGetCompactionHistory,
} = vi.hoisted(() => ({
    mockLog: vi.fn(),
    mockGetClient: vi.fn(),
    mockListActiveSessions: vi.fn(() => []),
    mockGetSdkSession: vi.fn(),
    mockDisconnectSdkSession: vi.fn(),
    mockCreateSdkSession: vi.fn(),
    mockResumeSdkSession: vi.fn(),
    mockIncrementMessageCount: vi.fn(),
    mockGetCompactionHistory: vi.fn(() => []),
}));

vi.mock('#copilot/observability/logger', () => ({ log: mockLog }));

vi.mock('#copilot/observability/event-collector', () => ({
    getCompactionHistory: mockGetCompactionHistory,
}));

vi.mock('#copilot/config/env', () => ({
    BRIDGE_ADMIN_TOKEN: undefined,
    SSE_REPLAY_BUFFER_SIZE: 100,
    SSE_MAX_CONCURRENT: 10,
}));

vi.mock('#copilot/sdk', () => ({
    approveAll: vi.fn(),
    createClientSession: mockCreateSdkSession,
    disconnectClientSession: mockDisconnectSdkSession,
    getClient: mockGetClient,
    getClientSession: mockGetSdkSession,
    listActiveClientSessions: mockListActiveSessions,
    pickDefined: vi.fn((obj) => {
        /** @type {Record<string, unknown>} */
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            if (v !== undefined) result[k] = v;
        }
        return result;
    }),
    resumeClientSession: mockResumeSdkSession,
    incrementSessionMessageCount: mockIncrementMessageCount,
}));

// ─── Import routers após mocks ──────────────────────────────────────────────

const { default: crudRouter } = await import('#copilot/api/express/session-crud');
const { default: messagingRouter } = await import('#copilot/api/express/session-messaging');

// ─── Test App ────────────────────────────────────────────────────────────────

function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/sdk', crudRouter);
    app.use('/api/sdk', messagingRouter);
    return app;
}

let app = createApp();

beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveSessions.mockReturnValue([]);
    mockGetSdkSession.mockReturnValue(null);
    app = createApp();
});

// ═══════════════════════════════════════════════════════════════════════════════
// F197: GET /sessions/active
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — GET /sessions/active (F197)', () => {
    it('retorna lista vazia quando sem sessões ativas', async () => {
        const res = await request(app).get('/api/sdk/sessions/active');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, count: 0, sessions: [] });
    });

    it('retorna sessões ativas com campos enriquecidos', async () => {
        mockListActiveSessions.mockReturnValue([
            { sessionId: 's1', model: 'gpt-4o', createdAt: Date.now() - 5000, messagesCount: 3 },
        ]);

        const res = await request(app).get('/api/sdk/sessions/active');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(1);
        expect(res.body.sessions[0]).toMatchObject({
            sessionId: 's1',
            model: 'gpt-4o',
            messagesCount: 3,
        });
        expect(res.body.sessions[0].activeMs).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F198: GET /sessions/last + GET /sessions/foreground
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — GET /sessions/last (F198)', () => {
    it('retorna lastSessionId quando existe', async () => {
        mockGetClient.mockResolvedValue({
            getLastSessionId: vi.fn().mockResolvedValue('last-123'),
        });

        const res = await request(app).get('/api/sdk/sessions/last');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, lastSessionId: 'last-123' });
    });

    it('retorna null quando sem última sessão', async () => {
        mockGetClient.mockResolvedValue({
            getLastSessionId: vi.fn().mockResolvedValue(undefined),
        });

        const res = await request(app).get('/api/sdk/sessions/last');

        expect(res.body.lastSessionId).toBeNull();
    });
});

describe('F37 — GET /sessions/foreground (F198)', () => {
    it('retorna foregroundSessionId', async () => {
        mockGetClient.mockResolvedValue({
            getForegroundSessionId: vi.fn().mockResolvedValue('fg-1'),
        });

        const res = await request(app).get('/api/sdk/sessions/foreground');

        expect(res.status).toBe(200);
        expect(res.body.foregroundSessionId).toBe('fg-1');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F199: GET /sessions (list all)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — GET /sessions (F199)', () => {
    it('lista sessões do disco com flag isActive', async () => {
        mockGetClient.mockResolvedValue({
            listSessions: vi.fn().mockResolvedValue([
                { sessionId: 's1', model: 'gpt-4o' },
                { sessionId: 's2', model: 'claude-sonnet-4-5' },
            ]),
        });
        mockListActiveSessions.mockReturnValue([{ sessionId: 's1' }]);

        const res = await request(app).get('/api/sdk/sessions');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(res.body.sessions[0].isActive).toBe(true);
        expect(res.body.sessions[1].isActive).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F200: GET /sessions/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — GET /sessions/:id (F200)', () => {
    it('retorna 404 quando sessão não existe', async () => {
        mockGetClient.mockResolvedValue({
            listSessions: vi.fn().mockResolvedValue([]),
        });

        const res = await request(app).get('/api/sdk/sessions/nonexistent');

        expect(res.status).toBe(404);
        expect(res.body.ok).toBe(false);
    });

    it('retorna detalhes de sessão ativa', async () => {
        mockGetClient.mockResolvedValue({
            listSessions: vi.fn().mockResolvedValue([{ sessionId: 's1' }]),
        });
        mockGetSdkSession.mockReturnValue({
            model: 'gpt-4o',
            messagesCount: 5,
            createdAt: Date.now() - 10000,
            session: { workspacePath: '/ws' },
        });

        const res = await request(app).get('/api/sdk/sessions/s1');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            ok: true,
            sessionId: 's1',
            isActive: true,
            model: 'gpt-4o',
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F201: DELETE /sessions/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — DELETE /sessions/:id (F201)', () => {
    it('exige header X-Confirm-Delete', async () => {
        const res = await request(app).delete('/api/sdk/sessions/s1');

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('X-Confirm-Delete');
    });

    it('deleta com confirmação', async () => {
        mockGetClient.mockResolvedValue({
            deleteSession: vi.fn(),
        });
        mockDisconnectSdkSession.mockResolvedValue(undefined);

        const res = await request(app).delete('/api/sdk/sessions/s1').set('X-Confirm-Delete', 'true');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(mockDisconnectSdkSession).toHaveBeenCalledWith('s1');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F202: POST /sessions/:id/disconnect + resume
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — POST /sessions/:id/disconnect (F202)', () => {
    it('retorna 404 se sessão não ativa', async () => {
        const res = await request(app).post('/api/sdk/sessions/s1/disconnect');

        expect(res.status).toBe(404);
    });

    it('desconecta sessão ativa', async () => {
        mockGetSdkSession.mockReturnValue({ session: {} });
        mockDisconnectSdkSession.mockResolvedValue(undefined);

        const res = await request(app).post('/api/sdk/sessions/s1/disconnect');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});

describe('F37 — POST /sessions/:id/resume (F202)', () => {
    it('retoma sessão existente', async () => {
        mockResumeSdkSession.mockResolvedValue({
            sessionId: 's1',
            workspacePath: '/ws',
        });

        const res = await request(app).post('/api/sdk/sessions/s1/resume').send({});

        expect(res.status).toBe(200);
        expect(res.body.sessionId).toBe('s1');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F203: GET /sessions/:id/compaction-history
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — GET /sessions/:id/compaction-history (F203)', () => {
    it('retorna histórico de compaction', async () => {
        mockGetCompactionHistory.mockReturnValue([
            { type: 'start', timestamp: 1000 },
            { type: 'complete', timestamp: 2000 },
        ]);

        const res = await request(app).get('/api/sdk/sessions/s1/compaction-history');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(res.body.entries).toHaveLength(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F204: POST /sessions/:id/send (messaging)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — POST /sessions/:id/send (F204)', () => {
    it('retorna 404 se sessão não ativa', async () => {
        const res = await request(app).post('/api/sdk/sessions/s1/send').send({ prompt: 'hello' });

        expect(res.status).toBe(404);
    });

    it('rejeita prompt vazio', async () => {
        mockGetSdkSession.mockReturnValue({ session: {} });

        const res = await request(app).post('/api/sdk/sessions/s1/send').send({ prompt: '' });

        expect(res.status).toBe(400);
    });

    it('envia mensagem com waitForResponse=true', async () => {
        mockGetSdkSession.mockReturnValue({
            session: {
                sendAndWait: vi.fn().mockResolvedValue({
                    data: { content: 'response text', messageId: 'msg-1' },
                }),
            },
        });

        const res = await request(app)
            .post('/api/sdk/sessions/s1/send')
            .send({ prompt: 'hello', waitForResponse: true, timeoutMs: 5000 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            ok: true,
            content: 'response text',
            messageId: 'msg-1',
        });
    });

    it('envia mensagem com waitForResponse=false (enqueue)', async () => {
        mockGetSdkSession.mockReturnValue({
            session: {
                send: vi.fn().mockResolvedValue('msg-2'),
            },
        });

        const res = await request(app)
            .post('/api/sdk/sessions/s1/send')
            .send({ prompt: 'hello', waitForResponse: false });

        expect(res.status).toBe(200);
        expect(res.body.enqueued).toBe(true);
        expect(res.body.messageId).toBe('msg-2');
    });

    it('rejeita timeoutMs negativo (validação Zod)', async () => {
        mockGetSdkSession.mockReturnValue({ session: {} });

        const res = await request(app).post('/api/sdk/sessions/s1/send').send({ prompt: 'hello', timeoutMs: -1 });

        expect(res.status).toBe(400);
        expect(res.body.ok).toBe(false);
    });

    it('rejeita prompt acima do limite (413 entity too large ou 400)', async () => {
        mockGetSdkSession.mockReturnValue({ session: {} });

        const bigPrompt = 'x'.repeat(512_001);
        const res = await request(app).post('/api/sdk/sessions/s1/send').send({ prompt: bigPrompt });

        // Express pode rejeitar com 413 (body parser limit) ou 400 (handler validation)
        expect([400, 413]).toContain(res.status);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /sessions/:id/model, abort, GET /sessions/:id/messages
// ═══════════════════════════════════════════════════════════════════════════════

describe('F37 — POST /sessions/:id/model', () => {
    it('retorna 404 se sessão não existe', async () => {
        const res = await request(app).post('/api/sdk/sessions/s1/model').send({ model: 'gpt-4o' });

        expect(res.status).toBe(404);
    });

    it('muda modelo de sessão ativa', async () => {
        mockGetSdkSession.mockReturnValue({
            session: {
                setModel: vi.fn(),
            },
        });

        const res = await request(app).post('/api/sdk/sessions/s1/model').send({ model: 'gpt-4o' });

        expect(res.status).toBe(200);
        expect(res.body.model).toBe('gpt-4o');
    });
});

describe('F37 — POST /sessions/:id/abort', () => {
    it('retorna 404 se sessão não existe', async () => {
        const res = await request(app).post('/api/sdk/sessions/s1/abort');

        expect(res.status).toBe(404);
    });

    it('aborta sessão ativa', async () => {
        mockGetSdkSession.mockReturnValue({
            session: {
                abort: vi.fn(),
            },
        });

        const res = await request(app).post('/api/sdk/sessions/s1/abort');

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});

describe('F37 — GET /sessions/:id/messages', () => {
    it('retorna 404 se sessão não existe', async () => {
        const res = await request(app).get('/api/sdk/sessions/s1/messages');

        expect(res.status).toBe(404);
    });

    it('retorna histórico de mensagens', async () => {
        mockGetSdkSession.mockReturnValue({
            session: {
                getMessages: vi.fn().mockResolvedValue([
                    { role: 'user', content: 'hello' },
                    { role: 'assistant', content: 'hi' },
                ]),
            },
        });

        const res = await request(app).get('/api/sdk/sessions/s1/messages');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(2);
        expect(res.body.messages).toHaveLength(2);
    });
});
