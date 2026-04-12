// @ts-check
/**
 * @file Faixa 50 — API: session-middleware + event-fanout
 *
 *   Cobre:
 *
 *   - api/express/session-middleware.js — rateLimitMiddleware, validateModel, withErrorHandler, validateBody
 *   - api/sse/fanout.js — EventFanout publish/subscribe/destroy
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/observability/logger', () => ({ log: vi.fn(), LOG_DIR: '/tmp/test-logs', getRecentLogs: vi.fn(() => []), }));

// ═══════════════════════════════════════════════════════════════════════════════
// 1. session-middleware.js
// ═══════════════════════════════════════════════════════════════════════════════

describe('F50 — validateModel', () => {
    it('aceita modelo válido', async () => {
        const { validateModel } = await import('#copilot/api/express/session-middleware');
        expect(validateModel('gpt-4o')).toEqual({ ok: true, model: 'gpt-4o' });
    });

    it('trima whitespace', async () => {
        const { validateModel } = await import('#copilot/api/express/session-middleware');
        expect(validateModel('  gpt-4.1-mini  ')).toEqual({ ok: true, model: 'gpt-4.1-mini' });
    });

    it('rejeita string vazia', async () => {
        const { validateModel } = await import('#copilot/api/express/session-middleware');
        const result = validateModel('');
        expect(result.ok).toBe(false);
    });

    it('rejeita não-string', async () => {
        const { validateModel } = await import('#copilot/api/express/session-middleware');
        expect(validateModel(null).ok).toBe(false);
        expect(validateModel(123).ok).toBe(false);
    });

    it('rejeita caracteres inválidos (SEC-N05/N06)', async () => {
        const { validateModel } = await import('#copilot/api/express/session-middleware');
        expect(validateModel('gpt-4; rm -rf /').ok).toBe(false);
        expect(validateModel('../../../etc/passwd').ok).toBe(false);
    });

    it('aceita modelos com pontos e underscores', async () => {
        const { validateModel } = await import('#copilot/api/express/session-middleware');
        expect(validateModel('claude-sonnet-4').ok).toBe(true);
        expect(validateModel('gemini-2.5-pro').ok).toBe(true);
    });
});

describe('F50 — rateLimitMiddleware', () => {
    it('permite requisições dentro do limite', async () => {
        const { rateLimitMiddleware } = await import('#copilot/api/express/session-middleware');
        const mw = rateLimitMiddleware(100, 'test');
        const req = { ip: '127.0.0.1' };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();
        mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('bloqueia quando excede limite retornando 429', async () => {
        const { rateLimitMiddleware } = await import('#copilot/api/express/session-middleware');
        const mw = rateLimitMiddleware(2, 'strict');
        const req = { ip: '10.0.0.1' };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();
        mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
        mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
        mw(/** @type {any} */ (req), /** @type {any} */ (res), next); // 3rd → blocked
        expect(res.status).toHaveBeenCalledWith(429);
    });
});

describe('F50 — withErrorHandler', () => {
    it('executa fn normalmente quando não lança', async () => {
        const { withErrorHandler } = await import('#copilot/api/express/session-middleware');
        const req = { method: 'GET', path: '/test' };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), headersSent: false };
        const fn = vi.fn(async () => {});
        await withErrorHandler(/** @type {any} */ (req), /** @type {any} */ (res), fn);
        expect(fn).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('retorna 500 quando fn lança', async () => {
        const { withErrorHandler } = await import('#copilot/api/express/session-middleware');
        const req = { method: 'POST', path: '/sessions' };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), headersSent: false };
        await withErrorHandler(/** @type {any} */ (req), /** @type {any} */ (res), async () => {
            throw new Error('boom');
        });
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'boom' }));
    });

    it('não envia response se headers já foram enviados', async () => {
        const { withErrorHandler } = await import('#copilot/api/express/session-middleware');
        const req = { method: 'GET', path: '/' };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), headersSent: true };
        await withErrorHandler(/** @type {any} */ (req), /** @type {any} */ (res), async () => {
            throw new Error('late');
        });
        expect(res.status).not.toHaveBeenCalled();
    });
});

describe('F50 — validateBody', () => {
    it('chama next para body válido', async () => {
        const { validateBody } = await import('#copilot/api/express/session-middleware');
        const { z } = await import('zod');
        const schema = z.object({ name: z.string() });
        const mw = validateBody(schema);
        const req = { body: { name: 'test' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();
        mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
        expect(next).toHaveBeenCalled();
    });

    it('retorna 400 para body inválido com detalhes', async () => {
        const { validateBody } = await import('#copilot/api/express/session-middleware');
        const { z } = await import('zod');
        const schema = z.object({ count: z.number() });
        const mw = validateBody(schema);
        const req = { body: { count: 'not-a-number' } };
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const next = vi.fn();
        mw(/** @type {any} */ (req), /** @type {any} */ (res), next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                ok: false,
                error: 'Corpo da requisição inválido.',
            }),
        );
    });
});

describe('F50 — Zod schemas export', () => {
    it('CreateSessionBodySchema valida body com model', async () => {
        const { CreateSessionBodySchema } = await import('#copilot/api/express/session-middleware');
        const result = CreateSessionBodySchema.safeParse({ model: 'gpt-4o' });
        expect(result.success).toBe(true);
    });

    it('SendMessageBodySchema requer prompt não-vazio', async () => {
        const { SendMessageBodySchema } = await import('#copilot/api/express/session-middleware');
        expect(SendMessageBodySchema.safeParse({ prompt: '' }).success).toBe(false);
        expect(SendMessageBodySchema.safeParse({ prompt: 'hello' }).success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. api/sse/fanout.js — EventFanout
// ═══════════════════════════════════════════════════════════════════════════════

describe('F50 — EventFanout', () => {
    it('publish + subscribe entrega evento no canal correto', async () => {
        const { EventFanout } = await import('#copilot/api/sse/fanout');
        const fanout = new EventFanout();
        const handler = vi.fn();
        fanout.subscribe('terminal', handler);
        fanout.publish('terminal', 'input', { text: 'hello' });
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: 'terminal',
                event: 'input',
                data: { text: 'hello' },
            }),
        );
        fanout.destroy();
    });

    it('wildcard subscriber (*) recebe todos os canais', async () => {
        const { EventFanout } = await import('#copilot/api/sse/fanout');
        const fanout = new EventFanout();
        const handler = vi.fn();
        fanout.subscribe('*', handler);
        fanout.publish('bridge', 'connect', {});
        fanout.publish('terminal', 'output', {});
        expect(handler).toHaveBeenCalledTimes(2);
        fanout.destroy();
    });

    it('unsubscribe remove listener', async () => {
        const { EventFanout } = await import('#copilot/api/sse/fanout');
        const fanout = new EventFanout();
        const handler = vi.fn();
        const sub = fanout.subscribe('test', handler);
        sub.unsubscribe();
        fanout.publish('test', 'x', {});
        expect(handler).not.toHaveBeenCalled();
        fanout.destroy();
    });

    it('destroy remove todos os listeners', async () => {
        const { EventFanout } = await import('#copilot/api/sse/fanout');
        const fanout = new EventFanout();
        const handler = vi.fn();
        fanout.subscribe('ch', handler);
        fanout.destroy();
        fanout.publish('ch', 'x', {});
        expect(handler).not.toHaveBeenCalled();
    });

    it('evento inclui ts e origin', async () => {
        const { EventFanout } = await import('#copilot/api/sse/fanout');
        const fanout = new EventFanout({ processId: 'test-process' });
        const handler = vi.fn();
        fanout.subscribe('ch', handler);
        fanout.publish('ch', 'ev', {});
        const evt = handler.mock.calls[0][0];
        expect(evt.ts).toBeDefined();
        expect(evt.origin).toBe('test-process');
        fanout.destroy();
    });

    it('eventFanout singleton é exportado', async () => {
        const { eventFanout } = await import('#copilot/api/sse/fanout');
        expect(eventFanout).toBeDefined();
        expect(typeof eventFanout.publish).toBe('function');
    });
});
