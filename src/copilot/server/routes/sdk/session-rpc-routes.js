// @ts-check
/**
 * Rotas RPC auxiliares de sessões SDK: permissions, tools, commands, compaction e shell.
 */

import { resolveSdkRouteSharedDeps } from './deps.js';
import { validateBody, withErrorHandler } from './session-middleware.js';
import { getActiveSessionEntryOrReply, withSessionRuntimeMeta } from './session-route-helpers.js';
import {
    HandlePendingCommandBodySchema,
    HandlePendingToolCallBodySchema,
    PermissionDecisionBodySchema,
    ShellExecBodySchema,
    ShellKillBodySchema,
} from './session-schemas.js';

/**
 * @typedef {import('express').Router} Router
 */

/**
 * @param {Router} router
 * @returns {void}
 */
export function registerSessionRpcRoutes(router) {
    router.post('/sessions/:id/permissions/:requestId', validateBody(PermissionDecisionBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const requestId = /** @type {string} */ (req.params['requestId']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.permissionsHandlePending(
                entry.session,
                requestId,
                req.body.result,
            );
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/tools/:requestId', validateBody(HandlePendingToolCallBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const requestId = /** @type {string} */ (req.params['requestId']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.toolsHandlePendingCall(entry.session, requestId, req.body);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/commands/:requestId', validateBody(HandlePendingCommandBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const requestId = /** @type {string} */ (req.params['requestId']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.commandsHandlePending(entry.session, requestId, req.body);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/compaction/compact', (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.compactionCompact(entry.session);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/shell/exec', validateBody(ShellExecBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const { command, cwd, timeout } = req.body ?? {};
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.shellExec(
                entry.session,
                command,
                routeDeps.sdkSession.pickDefined({ cwd, timeout }),
            );
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });

    router.post('/sessions/:id/shell/:processId/kill', validateBody(ShellKillBodySchema), (req, res) => {
        void withErrorHandler(req, res, async () => {
            const routeDeps = resolveSdkRouteSharedDeps(req);
            const id = /** @type {string} */ (req.params['id']);
            const processId = /** @type {string} */ (req.params['processId']);
            const entry = getActiveSessionEntryOrReply(routeDeps, id, res);
            if (!entry) return;
            const result = await routeDeps.sdkSessionRpc.shellKill(entry.session, processId, req.body?.signal);
            res.json(withSessionRuntimeMeta(routeDeps, { ok: true, sessionId: id, result }, id));
        });
    });
}
