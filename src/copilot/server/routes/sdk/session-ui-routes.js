// @ts-check
/**
 * Rotas de UI capabilities de sessões SDK.
 */

import { resolveSdkRouteSharedDeps } from './deps.js';
import { validateBody, withErrorHandler } from './session-middleware.js';
import { getActiveSessionEntryOrReply, withSessionRuntimeMeta } from './session-route-helpers.js';
import {
    ElicitationBodySchema,
    UiConfirmBodySchema,
    UiInputBodySchema,
    UiSelectBodySchema,
} from './session-schemas.js';

/**
 * @typedef {import('express').Router} Router
 */

/**
 * @param {Router} router
 * @returns {void}
 */
export function registerSessionUiRoutes(router) {
    router.get('/sessions/:id/ui/capabilities', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const capabilities = routeDeps.sdkSessionUi.getSessionCapabilities(entry.session);
            const available = routeDeps.sdkSessionUi.isSessionUiElicitationAvailable(entry.session);
            res.json(
                withSessionRuntimeMeta(
                    routeDeps,
                    { ok: true, sessionId: id, capabilities, elicitationAvailable: available },
                    id,
                ),
            );
        });
    });

    router.post('/sessions/:id/ui/elicitation', validateBody(ElicitationBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { message, requestedSchema } = req.body ?? {};
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionUi.sessionUiElicitation(entry.session, {
                message,
                requestedSchema,
            });
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/ui/confirm', validateBody(UiConfirmBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { message } = req.body ?? {};
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionUi.sessionUiConfirm(entry.session, message);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/ui/select', validateBody(UiSelectBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { message, options } = req.body ?? {};
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionUi.sessionUiSelect(entry.session, message, options);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/ui/input', validateBody(UiInputBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { message, options } = req.body ?? {};
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionUi.sessionUiInput(entry.session, message, options);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });
}
