// @ts-check
/**
 * @module copilot/server/handler-bridge
 * @file Adaptador entre os handlers copilot e Express.
 *
 *   Os handlers existentes em `terminal/handlers/` retornam `{ status: number; body: unknown; cors?: boolean }` —
 *   compatíveis com Express mas escritos para o servidor HTTP nativo. Este módulo adapta essas funções para funcionar
 *   como RequestHandlers Express normais.
 *
 *   Onda 3.1 — suporte às rotas (L55.x).
 *
 *   src/copilot/server/handler-bridge.js
 */

import { log } from '#copilot/observability';
import { resolveRequestedRuntimeId } from '../presentation/runtime-request.js';
import { normalizeRuntimeId } from '../presentation/runtime-targeting.js';

/**
 * @typedef {{ status: number; body: unknown; cors?: boolean }} HandlerResult
 *
 * @typedef {(params: Record<string, unknown>) => HandlerResult | Promise<HandlerResult>} CopilotHandler
 */

/**
 * Extrai parâmetros de query e de rota de um request Express.
 *
 * @param {import('express').Request} req
 * @returns {Record<string, unknown>}
 */
function extractParams(req) {
    return {
        ...req.params,
        ...Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : v])),
        body: req.body,
        runtimeId: resolveRequestedRuntimeId(req),
    };
}

/**
 * Combina os parâmetros-base extraídos do request com um extrator customizado, preservando `runtimeId` canônico.
 *
 * @param {import('express').Request} req
 * @param {((req: import('express').Request) => Record<string, unknown>) | undefined} paramsExtractor
 * @returns {Record<string, unknown>}
 */
function resolveHandlerParams(req, paramsExtractor) {
    const base = extractParams(req);
    if (!paramsExtractor) return base;
    const custom = paramsExtractor(req);
    return {
        ...base,
        ...custom,
        runtimeId: normalizeRuntimeId(custom?.['runtimeId']) ?? base.runtimeId,
    };
}

/**
 * Adapta um handler copilot (retorna `HandlerResult`) para uso como RequestHandler Express.
 *
 * Erros são propagados via `next(err)` para o `copilotErrorHandler`.
 *
 * @param {CopilotHandler} handler - Handler copilot original
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function callHandler(handler, req, res, next) {
    const params = extractParams(req);
    let result;
    try {
        result = handler(params);
    } catch (e) {
        next(e);
        return;
    }

    // Handler síncrono
    if (!result || typeof (/** @type {{ then?: unknown }} */ (result).then) !== 'function') {
        const r = /** @type {HandlerResult} */ (result);
        try {
            res.status(r.status).json(r.body);
        } catch (e) {
            log('ERROR', `[HandlerBridge] Erro ao enviar resposta: ${e}`);
        }
        return;
    }

    // Handler assíncrono
    /** @type {Promise<HandlerResult>} */ (result)
        .then((r) => {
            res.status(r.status).json(r.body);
        })
        .catch(next);
}

/**
 * Cria um RequestHandler Express a partir de um handler copilot, com parâmetros extras.
 *
 * Use para rotas que precisam de transformação de params (ex: rotas com pathname regex).
 *
 * @param {CopilotHandler} handler
 * @param {(req: import('express').Request) => Record<string, unknown>} [paramsExtractor] - Extrator customizado
 * @returns {import('express').RequestHandler}
 */
export function bridgeHandler(handler, paramsExtractor) {
    return function bridgedRequestHandler(req, res, next) {
        const params = resolveHandlerParams(req, paramsExtractor);
        let result;
        try {
            result = handler(params);
        } catch (e) {
            next(e);
            return;
        }

        if (!result || typeof (/** @type {{ then?: unknown }} */ (result).then) !== 'function') {
            const r = /** @type {HandlerResult} */ (result);
            res.status(r.status).json(r.body);
            return;
        }

        /** @type {Promise<HandlerResult>} */ (result).then((r) => res.status(r.status).json(r.body)).catch(next);
    };
}
