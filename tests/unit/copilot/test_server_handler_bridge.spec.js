// @ts-check

import { describe, expect, it, vi } from 'vitest';

import {
    callPresentationHandler,
    createPresentationRoute,
} from '../../../src/copilot/server/routes/presentation-route.js';

/**
 * @returns {{
 *     req: import('express').Request;
 *     res: import('express').Response;
 *     next: import('express').NextFunction;
 *     status: ReturnType<typeof vi.fn>;
 *     json: ReturnType<typeof vi.fn>;
 *     type: ReturnType<typeof vi.fn>;
 *     send: ReturnType<typeof vi.fn>;
 * }}
 */
function createHttpHarness() {
    const json = vi.fn();
    const send = vi.fn();
    const status = vi.fn(() => res);
    const type = vi.fn(() => res);
    const req = /** @type {import('express').Request} */ ({
        query: {},
        params: {},
        headers: {},
        body: {},
    });
    const res = /** @type {import('express').Response} */ (
        /** @type {unknown} */ ({
            status,
            json,
            send,
            type,
        })
    );
    const next = /** @type {import('express').NextFunction} */ (vi.fn());
    return { req, res, next, status, json, type, send };
}

describe('server/routes/presentation-route runtimeId propagation', () => {
    it('callPresentationHandler injeta runtimeId canônico extraído do request', () => {
        const { req, res, next, status, json } = createHttpHarness();
        req.headers = { 'x-agent-runtime-id': 'alt' };

        callPresentationHandler(
            (params) => ({ status: 200, body: { ok: true, runtimeId: params['runtimeId'] } }),
            req,
            res,
            next,
        );

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ ok: true, runtimeId: 'alt' });
    });

    it('createPresentationRoute preserva runtimeId mesmo com paramsExtractor customizado', () => {
        const { req, res, next, status, json } = createHttpHarness();
        req.query = { runtimeId: 'query-alt', n: '5' };

        const handler = createPresentationRoute(
            (params) => ({ status: 200, body: params }),
            (request) => ({ n: Number(request.query['n'] ?? 0), custom: true }),
        );

        handler(req, res, next);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'query-alt', n: 5, custom: true }));
    });

    it('paramsExtractor pode sobrescrever runtimeId explicitamente quando necessário', () => {
        const { req, res, next, status, json } = createHttpHarness();
        req.query = { runtimeId: 'query-default' };

        const handler = createPresentationRoute(
            (params) => ({ status: 200, body: params }),
            () => ({ runtimeId: 'forced-alt', custom: true }),
        );

        handler(req, res, next);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'forced-alt', custom: true }));
    });

    it('normaliza runtimeId sobrescrito pelo paramsExtractor antes de propagar', () => {
        const { req, res, next, status, json } = createHttpHarness();
        req.query = { runtimeId: 'query-default' };

        const handler = createPresentationRoute(
            (params) => ({ status: 200, body: params }),
            () => ({ runtimeId: '  forced-alt  ' }),
        );

        handler(req, res, next);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'forced-alt' }));
    });

    it('envia HandlerResult textual sem serializar como JSON', () => {
        const { req, res, next, status, json, type, send } = createHttpHarness();
        const handler = createPresentationRoute(() => ({
            status: 200,
            contentType: 'text/plain; version=0.0.4; charset=utf-8',
            body: '# HELP metric\nmetric 1\n',
        }));

        handler(req, res, next);

        expect(status).toHaveBeenCalledWith(200);
        expect(type).toHaveBeenCalledWith('text/plain; version=0.0.4; charset=utf-8');
        expect(send).toHaveBeenCalledWith('# HELP metric\nmetric 1\n');
        expect(json).not.toHaveBeenCalled();
    });
});
