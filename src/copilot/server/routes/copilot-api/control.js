// @ts-check
/**
 * src/copilot/server/routes/copilot-api/control.js
 *
 * Rotas de controle do AlwaysAliveAgent: status, health, session, start, stop, permissions, steer.
 *
 * Onda 4.8 — migrado de `api/bridge/control.js` para `server/routes/copilot-api/`.
 *
 * @module copilot/server/routes/copilot-api/control
 */

import { CHANNEL_VERSION } from '#copilot/channel';
import { BRIDGE_ADMIN_TOKEN, BRIDGE_EXPOSE_DIAGNOSTICS } from '#copilot/config';
import { CONVERSATION_STORE } from '#copilot/conversation-hub';
import { container } from '#copilot/core';
import { globalAuditTrail } from '#copilot/hooks';
import { log } from '#copilot/observability';
import { createRequire } from 'node:module';
import { toError } from '../../../core/error-handlers.js';
import { projectAgentHttpError } from '../../../presentation/agent-http-errors.js';
import { buildAgentRuntimeCapabilitiesFromRoute } from '../../../presentation/runtime-capabilities.js';
import { readAgentRuntimeControlStateFromRoute } from '../../../presentation/runtime-controls.js';
import { getAgentHealthHttpStatus, getAgentHealthSnapshotCompat } from '../../../presentation/runtime-health.js';
import { buildRuntimeRouteMetaPayload } from '../../../presentation/runtime-meta.js';
import { resolveCopilotApiRouteBinding } from '../../../presentation/runtime-request.js';
import {
    buildAgentSessionHttpPayloadFromRoute,
    buildAgentStatusHttpPayloadFromRoute,
} from '../../../presentation/runtime-status.js';
import { sanitizeHttpErrorMessage } from '../../middleware/error-handler.js';

// UPG-PROP-07 (fix): ler versão do SDK uma vez no carregamento do módulo para incluir no /health
const _sdkVersion = (() => {
    try {
        const req = createRequire(import.meta.url);
        return /** @type {{ version: string }} */ (req('@github/copilot-sdk/package.json')).version;
    } catch {
        return 'unknown';
    }
})();

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('../../../presentation/runtime-route-deps.js').CopilotApiRouteDeps} RuntimeRouteDeps
 *
 * @typedef {import('../../../presentation/runtime-request.js').CopilotApiRouteBinding} RuntimeRouteBinding
 */

/**
 * Registra rotas de controle do agente no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {RuntimeRouteBinding} binding - Runtime fixo legado ou resolver por requisição
 * @returns {void}
 */
export function registerControlRoutes(bridge, binding) {
    const requireAdmin = _makeAdminAuthMiddleware();

    bridge.get('/status', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        res.json(buildAgentStatusHttpPayloadFromRoute(deps));
    });
    bridge.get('/health', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        _handleHealth(res, deps);
    });
    bridge.get('/session', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        _handleSession(res, deps);
    });
    bridge.get('/capabilities', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const deps = resolveCopilotApiRouteBinding(binding, req);
        res.json(buildAgentRuntimeCapabilitiesFromRoute(deps));
    });
    // SEC-API-001: POST /start e /stop protegidas com requireAdmin (defesa em profundidade)
    bridge.post('/start', requireAdmin, (/** @type {Req} */ req, /** @type {Res} */ res) =>
        _handleStart(res, resolveCopilotApiRouteBinding(binding, req)),
    );
    bridge.post('/stop', requireAdmin, (/** @type {Req} */ req, /** @type {Res} */ res) =>
        _handleStop(res, resolveCopilotApiRouteBinding(binding, req)),
    );
    bridge.get('/permissions', (/** @type {Req} */ req, /** @type {Res} */ res) =>
        _handleGetPermissions(res, resolveCopilotApiRouteBinding(binding, req)),
    );
    bridge.post('/permissions', requireAdmin, (/** @type {Req} */ req, /** @type {Res} */ res) =>
        _handleSetPermissions(req, res, resolveCopilotApiRouteBinding(binding, req)),
    );

    // GAP-SE-001b (STREAMING-EVENTS-AUDIT Fase 2.2): endpoint de steering (immediate mode)
    bridge.post('/steer', (/** @type {Req} */ req, /** @type {Res} */ res) =>
        _handleSteer(req, res, resolveCopilotApiRouteBinding(binding, req)),
    );

    // E3.2 — Dashboard de compliance: decisões de hooks e estatísticas
    bridge.get('/compliance', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const runtimeMeta = buildRuntimeRouteMetaPayload(resolveCopilotApiRouteBinding(binding, req));
        try {
            const data = globalAuditTrail.toJSON();
            res.json({ ok: true, ...runtimeMeta, ...data });
        } catch (e) {
            res.status(500).json({
                ...runtimeMeta,
                ok: false,
                error: sanitizeHttpErrorMessage(toError(e).message, 500),
            });
        }
    });
    bridge.get('/compliance/stats', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const runtimeMeta = buildRuntimeRouteMetaPayload(resolveCopilotApiRouteBinding(binding, req));
        try {
            const stats = globalAuditTrail.stats();
            res.json({ ok: true, ...runtimeMeta, ...stats });
        } catch (e) {
            res.status(500).json({
                ...runtimeMeta,
                ok: false,
                error: sanitizeHttpErrorMessage(toError(e).message, 500),
            });
        }
    });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Cria middleware de autenticação admin via BRIDGE_ADMIN_TOKEN.
 *
 * @returns {import('express').RequestHandler}
 */
function _makeAdminAuthMiddleware() {
    /** @type {import('express').RequestHandler} */
    return function requireAdminAuth(req, res, next) {
        const token = BRIDGE_ADMIN_TOKEN;
        if (!token) {
            if (process.env['NODE_ENV'] === 'production') {
                return res.status(503).json({ ok: false, error: 'BRIDGE_ADMIN_TOKEN não configurado.' });
            }
            log(
                'WARN',
                '[copilot-api/control] BRIDGE_ADMIN_TOKEN não configurado — endpoint admin sem autenticação (dev only).',
            );
            return next();
        }
        const authHeader = req.headers['authorization'] ?? '';
        const provided =
            typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!provided || provided !== token) {
            return res.status(401).json({ ok: false, error: 'Não autorizado.' });
        }
        return next();
    };
}

// ─── Handlers de rota ─────────────────────────────────────────────────────────

/**
 * Health check: 200 = operacional, 503 = parado.
 *
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 */
function _handleHealth(res, deps) {
    const { agent } = deps;
    const health = getAgentHealthSnapshotCompat(agent);

    // ARCH-04: verificar conectividade do ConversationStore (SQLite)
    // API-P4-01: verificar se db existe antes de usar ? para não gerar false positive
    /** @type {{ ok: boolean; error?: string }} */
    const hubStore = (() => {
        const store = container.resolve(CONVERSATION_STORE);
        if (!store.db) return { ok: false, error: 'db não inicializado' };
        try {
            store.db.prepare('SELECT 1').get();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(toError(e).message ?? 'unknown') };
        }
    })();

    res.status(getAgentHealthHttpStatus(health)).json({
        ...buildRuntimeRouteMetaPayload(deps),
        ...health,
        // G2-API-14: permissionMode para rastreabilidade de configuração de auditoria
        permissionMode: typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : 'approve_all',
        channelVersion: CHANNEL_VERSION,
        // UPG-PROP-07: versão do SDK e do Node.js para rastreabilidade em deploys
        sdkVersion: _sdkVersion,
        nodeVersion: process.version,
        // UPG-PROP-10: diagnóstico de listeners disponível apenas em desenvolvimento
        listenerDiagnostics:
            process.env['NODE_ENV'] === 'development' && BRIDGE_EXPOSE_DIAGNOSTICS
                ? agent.listenerDiagnostics?.()
                : undefined,
        hubStore,
    });
}

/**
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 */
function _handleSession(res, deps) {
    res.json(buildAgentSessionHttpPayloadFromRoute(deps));
}

/**
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 * @returns {Promise<void>}
 */
async function _handleStart(res, deps) {
    const { agent } = deps;
    const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
    try {
        const currentState = readAgentRuntimeControlStateFromRoute(deps);
        if (currentState.status !== 'stopped') {
            return void res.json({
                ok: true,
                ...runtimeMeta,
                message: 'Agente já está ativo.',
                status: currentState.status,
            });
        }
        await agent.start();
        const nextState = readAgentRuntimeControlStateFromRoute(deps);
        return void res.json({ ok: true, ...runtimeMeta, sessionId: nextState.sessionId, status: nextState.status });
    } catch (e) {
        log('ERROR', `[copilot-api/control/start] ${toError(e).message}`);
        const projection = projectAgentHttpError(e);
        return void res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
    }
}

/**
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 * @returns {Promise<void>}
 */
async function _handleStop(res, deps) {
    const { agent } = deps;
    const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
    try {
        const currentState = readAgentRuntimeControlStateFromRoute(deps);
        if (currentState.dialogLoopActive) {
            await agent.stopDialogLoop?.({ authorized: true, reason: 'authorized_stop' });
        }
        await agent.stop();
        return void res.json({ ok: true, ...runtimeMeta, message: 'Agente parado.' });
    } catch (e) {
        log('ERROR', `[copilot-api/control/stop] ${toError(e).message}`);
        const projection = projectAgentHttpError(e);
        return void res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
    }
}

/**
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 */
function _handleGetPermissions(res, deps) {
    const { agent } = deps;
    const mode = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : 'approve_all';
    res.json({ ok: true, ...buildRuntimeRouteMetaPayload(deps), mode });
}

/**
 * @param {Req} req
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 */
function _handleSetPermissions(req, res, deps) {
    const { agent } = deps;
    const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
    const { mode, allowTools, denyTools, denyShell } = req.body ?? {};
    const validModes = ['approve_all', 'audit_only', 'selective'];
    const toolNameRe = /^[a-zA-Z0-9_]+$/;
    /**
     * @param {unknown} names
     * @param {'allowTools' | 'denyTools'} label
     * @returns {{ ok: true; value: string[] } | { ok: false; error: string }}
     */
    const sanitizeToolNames = (names, label) => {
        if (names === undefined) return { ok: true, value: [] };
        if (!Array.isArray(names)) {
            return { ok: false, error: `Campo "${label}" deve ser array de strings.` };
        }
        const unique = new Set();
        for (const raw of names) {
            if (typeof raw !== 'string') {
                return { ok: false, error: `Campo "${label}" deve conter apenas strings.` };
            }
            const normalized = raw.trim();
            if (!normalized || !toolNameRe.test(normalized)) {
                return {
                    ok: false,
                    error: `Campo "${label}" contém nome inválido: "${raw}". Use apenas [a-zA-Z0-9_].`,
                };
            }
            unique.add(normalized);
        }
        return { ok: true, value: [...unique] };
    };

    if (!mode || !validModes.includes(mode)) {
        return void res.status(400).json({
            ...runtimeMeta,
            ok: false,
            error: `Campo "mode" inválido. Valores aceitos: ${validModes.join(', ')}.`,
        });
    }
    if (denyShell !== undefined && typeof denyShell !== 'boolean') {
        return void res.status(400).json({ ...runtimeMeta, ok: false, error: 'Campo "denyShell" deve ser boolean.' });
    }
    const allowNames = sanitizeToolNames(allowTools, 'allowTools');
    if (!allowNames.ok) {
        return void res.status(400).json({ ...runtimeMeta, ok: false, error: allowNames.error });
    }
    const denyNames = sanitizeToolNames(denyTools, 'denyTools');
    if (!denyNames.ok) {
        return void res.status(400).json({ ...runtimeMeta, ok: false, error: denyNames.error });
    }
    if (typeof agent.setPermissionMode !== 'function') {
        return void res
            .status(501)
            .json({ ...runtimeMeta, ok: false, error: 'setPermissionMode não disponível nesta instância.' });
    }
    try {
        const before = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : 'approve_all';
        /** @type {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} */
        const opts = {};
        if (allowNames.value.length) opts.allowTools = allowNames.value;
        if (denyNames.value.length) opts.denyTools = denyNames.value;
        if (denyShell === true) opts.denyShell = true;
        agent.setPermissionMode(mode, opts);
        const after = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : mode;
        log('INFO', `[copilot-api/control/permissions] modo: ${before} → ${after}`);
        return void res.json({ ok: true, ...runtimeMeta, before, after });
    } catch (e) {
        log('ERROR', `[copilot-api/control/permissions] ${toError(e).message}`);
        const projection = projectAgentHttpError(e);
        return void res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
    }
}

/**
 * GAP-SE-001b: Envia uma mensagem em modo steering (immediate) para redirecionar o agente mid-turn.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {RuntimeRouteDeps} deps
 */
async function _handleSteer(req, res, deps) {
    const { agent } = deps;
    const runtimeMeta = buildRuntimeRouteMetaPayload(deps);
    const { message } = req.body ?? {};
    if (!message || typeof message !== 'string') {
        return void res
            .status(400)
            .json({ ...runtimeMeta, ok: false, error: 'Campo "message" (string) é obrigatório.' });
    }
    if (typeof agent.steerMessage !== 'function') {
        return void res
            .status(501)
            .json({ ...runtimeMeta, ok: false, error: 'steerMessage não disponível nesta instância.' });
    }
    try {
        const messageId = await agent.steerMessage(message);
        return void res.json({ ok: true, ...runtimeMeta, messageId });
    } catch (e) {
        log('ERROR', `[copilot-api/control/steer] ${toError(e).message}`);
        const projection = projectAgentHttpError(e);
        return void res.status(projection.status).json({ ...runtimeMeta, ...projection.body });
    }
}
