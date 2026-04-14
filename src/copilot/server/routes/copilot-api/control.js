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

import { BRIDGE_ADMIN_TOKEN, BRIDGE_EXPOSE_DIAGNOSTICS } from '#copilot/config';
import { log } from '#copilot/observability';
import { globalAuditTrail } from '#copilot/hooks';
import { CHANNEL_VERSION } from '#copilot/channel';
import { createConversationService } from '../../../services/conversation-service.js';
import { createRequire } from 'node:module';
import { toError } from '../../../core/error-handlers.js';

const conversationService = createConversationService();

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
 * @typedef {{
 *     status: string;
 *     sessionId: string | null;
 *     model: string;
 *     queueSize: number;
 *     pendingQuestion: object | null;
 *     isResumed: boolean;
 *     resumeCount: number;
 *     sendCount: number;
 *     startedAt: number | null;
 *     starvationAlert: boolean;
 *     oldestTaskWaitMs: number;
 * }} AgentSnap
 *
 *
 * @typedef {import('../../../agent/types.js').IAlwaysAliveAgent} AlwaysAliveAgentLike
 */

/**
 * Registra rotas de controle do agente no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {AlwaysAliveAgentLike} agent - Instância do AlwaysAliveAgent
 * @returns {void}
 */
export function registerControlRoutes(bridge, agent) {
    const requireAdmin = _makeAdminAuthMiddleware();

    bridge.get('/status', (_req, /** @type {Res} */ res) => res.json({ ok: true, ...agent.getStatusSnapshot() }));
    bridge.get('/health', (_req, /** @type {Res} */ res) => _handleHealth(res, agent));
    bridge.get('/session', (_req, /** @type {Res} */ res) => _handleSession(res, agent));
    // SEC-API-001: POST /start e /stop protegidas com requireAdmin (defesa em profundidade)
    bridge.post('/start', requireAdmin, (/** @type {Req} */ _req, /** @type {Res} */ res) => _handleStart(res, agent));
    bridge.post('/stop', requireAdmin, (/** @type {Req} */ _req, /** @type {Res} */ res) => _handleStop(res, agent));
    bridge.get('/permissions', (_req, /** @type {Res} */ res) => _handleGetPermissions(res, agent));
    bridge.post('/permissions', requireAdmin, (/** @type {Req} */ req, /** @type {Res} */ res) =>
        _handleSetPermissions(req, res, agent),
    );

    // GAP-SE-001b (STREAMING-EVENTS-AUDIT Fase 2.2): endpoint de steering (immediate mode)
    bridge.post('/steer', (/** @type {Req} */ req, /** @type {Res} */ res) => _handleSteer(req, res, agent));

    // E3.2 — Dashboard de compliance: decisões de hooks e estatísticas
    bridge.get('/compliance', (_req, /** @type {Res} */ res) => {
        try {
            const data = globalAuditTrail.toJSON();
            res.json({ ok: true, ...data });
        } catch (e) {
            res.status(500).json({ ok: false, error: toError(e).message });
        }
    });
    bridge.get('/compliance/stats', (_req, /** @type {Res} */ res) => {
        try {
            const stats = globalAuditTrail.stats();
            res.json({ ok: true, ...stats });
        } catch (e) {
            res.status(500).json({ ok: false, error: toError(e).message });
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
 * @param {AlwaysAliveAgentLike} agent
 */
function _handleHealth(res, agent) {
    const snap = /** @type {AgentSnap} */ (agent.getStatusSnapshot());
    const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';

    // ARCH-04: verificar conectividade do ConversationStore (SQLite)
    // API-P4-01: verificar se db existe antes de usar ? para não gerar false positive
    /** @type {{ ok: boolean; error?: string }} */
    const hubStore = (() => {
        const store = conversationService.getStore();
        if (!store.db) return { ok: false, error: 'db não inicializado' };
        try {
            store.db.prepare('SELECT 1').get();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(toError(e).message ?? 'unknown') };
        }
    })();

    res.status(healthy ? 200 : 503).json({
        healthy,
        status: snap.status,
        sessionId: snap.sessionId,
        queueSize: snap.queueSize,
        starvationAlert: snap.starvationAlert,
        uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
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
 * @param {AlwaysAliveAgentLike} agent
 */
function _handleSession(res, agent) {
    const snap = /** @type {AgentSnap} */ (agent.getStatusSnapshot());
    res.json({
        ok: true,
        sessionId: snap.sessionId,
        model: snap.model,
        isResumed: snap.isResumed,
        resumeCount: snap.resumeCount,
        sendCount: snap.sendCount,
        startedAt: snap.startedAt,
    });
}

/**
 * @param {Res} res
 * @param {AlwaysAliveAgentLike} agent
 * @returns {Promise<void>}
 */
async function _handleStart(res, agent) {
    try {
        if (agent.status !== 'stopped') {
            return void res.json({ ok: true, message: 'Agente já está ativo.', status: agent.status });
        }
        await agent.start();
        return void res.json({ ok: true, sessionId: agent.sessionId, status: agent.status });
    } catch (e) {
        log('ERROR', `[copilot-api/control/start] ${toError(e).message}`);
        return void res.status(500).json({ ok: false, error: toError(e).message });
    }
}

/**
 * @param {Res} res
 * @param {AlwaysAliveAgentLike} agent
 * @returns {Promise<void>}
 */
async function _handleStop(res, agent) {
    try {
        if (agent.dialogLoopActive) {
            await agent.stopDialogLoop?.({ authorized: true, reason: 'authorized_stop' });
        }
        await agent.stop();
        return void res.json({ ok: true, message: 'Agente parado.' });
    } catch (e) {
        log('ERROR', `[copilot-api/control/stop] ${toError(e).message}`);
        return void res.status(500).json({ ok: false, error: toError(e).message });
    }
}

/**
 * @param {Res} res
 * @param {AlwaysAliveAgentLike} agent
 */
function _handleGetPermissions(res, agent) {
    const mode = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : 'approve_all';
    res.json({ ok: true, mode });
}

/**
 * @param {Req} req
 * @param {Res} res
 * @param {AlwaysAliveAgentLike} agent
 */
function _handleSetPermissions(req, res, agent) {
    const { mode, allowTools, denyTools, denyShell } = req.body ?? {};
    const validModes = ['approve_all', 'audit_only', 'selective'];
    if (!mode || !validModes.includes(mode)) {
        return void res.status(400).json({
            ok: false,
            error: `Campo "mode" inválido. Valores aceitos: ${validModes.join(', ')}.`,
        });
    }
    if (typeof agent.setPermissionMode !== 'function') {
        return void res.status(501).json({ ok: false, error: 'setPermissionMode não disponível nesta instância.' });
    }
    try {
        const before = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : 'approve_all';
        /** @type {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} */
        const opts = {};
        if (Array.isArray(allowTools) && allowTools.length) opts.allowTools = allowTools;
        if (Array.isArray(denyTools) && denyTools.length) opts.denyTools = denyTools;
        if (denyShell === true) opts.denyShell = true;
        agent.setPermissionMode(mode, opts);
        const after = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : mode;
        log('INFO', `[copilot-api/control/permissions] modo: ${before} → ${after}`);
        return void res.json({ ok: true, before, after });
    } catch (e) {
        log('ERROR', `[copilot-api/control/permissions] ${toError(e).message}`);
        return void res.status(500).json({ ok: false, error: toError(e).message });
    }
}

/**
 * GAP-SE-001b: Envia uma mensagem em modo steering (immediate) para redirecionar o agente mid-turn.
 *
 * @param {Req} req
 * @param {Res} res
 * @param {AlwaysAliveAgentLike} agent
 */
async function _handleSteer(req, res, agent) {
    const { message } = req.body ?? {};
    if (!message || typeof message !== 'string') {
        return void res.status(400).json({ ok: false, error: 'Campo "message" (string) é obrigatório.' });
    }
    if (typeof agent.steerMessage !== 'function') {
        return void res.status(501).json({ ok: false, error: 'steerMessage não disponível nesta instância.' });
    }
    try {
        const messageId = await agent.steerMessage(message);
        return void res.json({ ok: true, messageId });
    } catch (e) {
        log('ERROR', `[copilot-api/control/steer] ${toError(e).message}`);
        return void res.status(500).json({ ok: false, error: toError(e).message });
    }
}
