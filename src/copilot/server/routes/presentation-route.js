// @ts-check
/**
 * @module copilot/server/routes/presentation-route
 * @file Adapter canônico entre handlers de `presentation/` e RequestHandlers Express.
 *
 *   Esta é a trilha canônica para rotas raiz em `server/routes/*.js` que expõem projections e operações vindas de
 *   `presentation/`.
 */

import { log } from '#copilot/observability';
import { resolveRequestedRuntimeId } from '../../presentation/runtime-request.js';
import { normalizeRuntimeId } from '../../presentation/runtime-targeting.js';
import { sanitizeHttpErrorMessage } from '../middleware/error-handler.js';

/**
 * @typedef {{ status: number; body: unknown; cors?: boolean; contentType?: string }} PresentationHandlerResult
 *
 * @typedef {(params: Record<string, unknown>) => PresentationHandlerResult | Promise<PresentationHandlerResult>} PresentationHandler
 *
 *
 * @typedef {(req: import('express').Request) => Record<string, unknown>} PresentationParamsExtractor
 */

/**
 * Extrai parâmetros comuns do request Express para handlers de presentation.
 *
 * @param {import('express').Request} req
 * @returns {Record<string, unknown>}
 */
function extractPresentationParams(req) {
    return {
        ...req.params,
        ...Object.fromEntries(
            Object.entries(req.query).map(([key, value]) => [key, typeof value === 'string' ? value : value]),
        ),
        body: req.body,
        runtimeId: resolveRequestedRuntimeId(req),
    };
}

/**
 * Resolve parâmetros finais preservando `runtimeId` canônico mesmo com extractor customizado.
 *
 * @param {import('express').Request} req
 * @param {PresentationParamsExtractor | undefined} paramsExtractor
 * @returns {Record<string, unknown>}
 */
function resolvePresentationRouteParams(req, paramsExtractor) {
    const base = extractPresentationParams(req);
    if (!paramsExtractor) return base;

    const custom = paramsExtractor(req);
    return {
        ...base,
        ...custom,
        runtimeId: normalizeRuntimeId(custom['runtimeId']) ?? base['runtimeId'],
    };
}

/**
 * Envia o resultado de um handler de presentation para a resposta Express.
 *
 * @param {import('express').Response} res
 * @param {PresentationHandlerResult} result
 * @returns {void}
 */
function sendPresentationHandlerResult(res, result) {
    const body =
        result.status >= 500 &&
        result.body &&
        typeof result.body === 'object' &&
        typeof (/** @type {Record<string, unknown>} */ (result.body)['error']) === 'string'
            ? {
                  .../** @type {Record<string, unknown>} */ (result.body),
                  error: sanitizeHttpErrorMessage(
                      /** @type {string} */ (/** @type {Record<string, unknown>} */ (result.body)['error']),
                      result.status,
                  ),
              }
            : result.body;

    if (result.contentType) {
        res.status(result.status).type(result.contentType).send(body);
        return;
    }

    res.status(result.status).json(body);
}

/**
 * Executa um handler de presentation com tratamento uniforme de sync/async.
 *
 * @param {PresentationHandler} handler
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {PresentationParamsExtractor | undefined} paramsExtractor
 * @returns {void}
 */
function invokePresentationHandler(handler, req, res, next, paramsExtractor) {
    const params = resolvePresentationRouteParams(req, paramsExtractor);

    let result;
    try {
        result = handler(params);
    } catch (error) {
        next(error);
        return;
    }

    if (!result || typeof (/** @type {{ then?: unknown }} */ (result).then) !== 'function') {
        try {
            sendPresentationHandlerResult(res, /** @type {PresentationHandlerResult} */ (result));
        } catch (error) {
            log('ERROR', `[PresentationRoute] Erro ao enviar resposta: ${error}`);
            next(error);
        }
        return;
    }

    /** @type {Promise<PresentationHandlerResult>} */ (result)
        .then((resolved) => {
            sendPresentationHandlerResult(res, resolved);
        })
        .catch(next);
}

/**
 * Executa diretamente um handler de presentation para o request atual.
 *
 * Útil em rotas triviais ou quando o RequestHandler já está sendo montado manualmente.
 *
 * @param {PresentationHandler} handler
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function callPresentationHandler(handler, req, res, next) {
    invokePresentationHandler(handler, req, res, next, undefined);
}

/**
 * Cria um RequestHandler Express a partir de um handler de presentation.
 *
 * @param {PresentationHandler} handler
 * @param {PresentationParamsExtractor} [paramsExtractor]
 * @returns {import('express').RequestHandler}
 */
export function createPresentationRoute(handler, paramsExtractor) {
    return function presentationRouteHandler(req, res, next) {
        invokePresentationHandler(handler, req, res, next, paramsExtractor);
    };
}
