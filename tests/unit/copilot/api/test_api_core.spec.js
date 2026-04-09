// @ts-check
/**
 * tests/unit/copilot/api/test_api_core.spec.js
 *
 * Testes unitários para src/copilot/api — middleware + SSE replay buffer.
 * F236: testes para endpoints e infraestrutura API restante.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── SSE Replay Buffer ─────────────────────────────────────────────────────

vi.mock('#copilot/config/env', () => ({
    SSE_REPLAY_BUFFER_SIZE: 100,
}));

import { SseReplayBuffer } from '../../../../src/copilot/api/sse/replay-buffer.js';

describe('api/sse/SseReplayBuffer', () => {
    /** @type {InstanceType<typeof SseReplayBuffer>} */
    let buf;

    beforeEach(() => {
        buf = new SseReplayBuffer(5);
    });

    it('push retorna IDs incrementais', () => {
        expect(buf.push('event1', { a: 1 })).toBe(1);
        expect(buf.push('event2', { b: 2 })).toBe(2);
        expect(buf.push('event3', { c: 3 })).toBe(3);
    });

    it('lastId retorna 0 quando vazio', () => {
        const empty = new SseReplayBuffer(5);
        expect(empty.lastId).toBe(0);
    });

    it('lastId reflete último push', () => {
        buf.push('a', 1);
        buf.push('b', 2);
        expect(buf.lastId).toBe(2);
    });

    it('getAfter retorna eventos após afterId', () => {
        buf.push('a', 1);
        buf.push('b', 2);
        buf.push('c', 3);
        const after1 = buf.getAfter(1);
        expect(after1).toHaveLength(2);
        expect(after1[0].event).toBe('b');
        expect(after1[1].event).toBe('c');
    });

    it('getAfter(0) retorna todos', () => {
        buf.push('a', 1);
        buf.push('b', 2);
        expect(buf.getAfter(0)).toHaveLength(2);
    });

    it('getAfter com ID maior que todos retorna vazio', () => {
        buf.push('a', 1);
        buf.push('b', 2);
        expect(buf.getAfter(999)).toHaveLength(0);
    });

    it('respeita maxSize (circular)', () => {
        for (let i = 0; i < 8; i++) {
            buf.push(`e${i}`, i);
        }
        // Buffer com maxSize=5, inseriu 8 → mantém últimos 5 (IDs 4-8)
        const all = buf.getAfter(0);
        expect(all).toHaveLength(5);
        expect(all[0].id).toBe(4);
        expect(all[4].id).toBe(8);
    });
});

// ─── Middleware (withErrorHandler) ──────────────────────────────────────────

vi.mock('#copilot/observability/logger', () => ({ log: vi.fn() }));

import { withErrorHandler } from '../../../../src/copilot/api/express/middleware.js';

describe('api/express/withErrorHandler', () => {
    /** @returns {any} */
    function mockReq(method = 'GET', path = '/test') {
        return { method, path };
    }

    /** @returns {any} */
    function mockRes() {
        const r = {
            headersSent: false,
            statusCode: 200,
            _json: null,
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
        return r;
    }

    it('executa fn com sucesso', async () => {
        const fn = vi.fn().mockResolvedValue(undefined);
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(fn).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('captura erro async e retorna 500', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('boom'));
        const req = mockReq('POST', '/fail');
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ ok: false, error: expect.any(String), code: 'INTERNAL_ERROR', status: 500 }),
        );
    });

    it('não envia resposta se headers já foram enviados', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('late'));
        const req = mockReq();
        const res = mockRes();
        res.headersSent = true;
        await withErrorHandler('test', req, res, fn);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('sanitiza paths em mensagens de erro', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail at /workspaces/chatgpt/foo.js:10'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        const errorMsg = res.json.mock.calls[0][0].error;
        expect(errorMsg).not.toContain('/workspaces/');
    });

    it('retorna 400 para ValidationError', async () => {
        const { ValidationError } = await import('../../../../src/copilot/core/errors.js');
        const fn = vi.fn().mockRejectedValue(new ValidationError('bad input'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(400);
        const body = res.json.mock.calls[0][0];
        expect(body).toMatchObject({ ok: false, code: 'VALIDATION_ERROR', status: 400 });
    });

    it('retorna 400 para ConfigError', async () => {
        const { ConfigError } = await import('../../../../src/copilot/core/errors.js');
        const fn = vi.fn().mockRejectedValue(new ConfigError('invalid config'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json.mock.calls[0][0].code).toBe('CONFIG_ERROR');
    });

    it('retorna 422 para ToolError', async () => {
        const { ToolError } = await import('../../../../src/copilot/core/errors.js');
        const fn = vi.fn().mockRejectedValue(new ToolError('tool failed'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json.mock.calls[0][0].code).toBe('TOOL_ERROR');
    });

    it('retorna 409 para SessionError', async () => {
        const { SessionError } = await import('../../../../src/copilot/core/errors.js');
        const fn = vi.fn().mockRejectedValue(new SessionError('conflict'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json.mock.calls[0][0].code).toBe('SESSION_ERROR');
    });

    it('retorna 504 para TimeoutError', async () => {
        const { TimeoutError } = await import('../../../../src/copilot/core/errors.js');
        const fn = vi.fn().mockRejectedValue(new TimeoutError('timed out'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(504);
        expect(res.json.mock.calls[0][0].code).toBe('TIMEOUT');
    });

    it('retorna 500 para CopilotError genérica', async () => {
        const { CopilotError } = await import('../../../../src/copilot/core/errors.js');
        const fn = vi.fn().mockRejectedValue(new CopilotError('generic'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].code).toBe('COPILOT_ERROR');
    });

    it('retorna INTERNAL_ERROR code para erros não-CopilotError', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('plain'));
        const req = mockReq();
        const res = mockRes();
        await withErrorHandler('test', req, res, fn);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
    });
});
