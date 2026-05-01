// @ts-check
/**
 * Rotas de workspace virtual de sessões SDK.
 */

import { resolveSdkRouteSharedDeps } from './deps.js';
import { validateBody, withErrorHandler } from './session-middleware.js';
import { getActiveSessionEntryOrReply, withRuntimeMeta, withSessionRuntimeMeta } from './session-route-helpers.js';
import { WorkspaceCreateFileBodySchema } from './session-schemas.js';
import { validateWorkspacePath } from './session-workspace-helpers.js';

/**
 * @typedef {import('express').Router} Router
 */

/**
 * @param {Router} router
 * @returns {void}
 */
export function registerSessionWorkspaceRoutes(router) {
    router.get('/sessions/:id/workspace/files', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.workspaceListFiles(entry.session);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.get('/sessions/:id/workspace/file', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const validation = validateWorkspacePath(req.query['path']);
            if (!validation.ok) {
                res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: validation.error }));
                return;
            }
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.workspaceReadFile(entry.session, validation.path);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/workspace/file', validateBody(WorkspaceCreateFileBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { path, content } = req.body ?? {};
            const validation = validateWorkspacePath(path);
            if (!validation.ok) {
                res.status(400).json(withRuntimeMeta(routeDeps, { ok: false, error: validation.error }));
                return;
            }
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.workspaceCreateFile(entry.session, validation.path, content);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });
}
