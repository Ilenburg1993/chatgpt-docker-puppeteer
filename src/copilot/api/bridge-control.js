// @ts-check
/**
 * src/copilot/api/bridge-control.js
 *
 * Rotas de controle do AlwaysAliveAgent: status, health, session, start, stop.
 *
 * Exporta `registerControlRoutes(bridge, agent)` para ser montado pelo http-bridge.js.
 *
 * @module copilot/api/bridge-control
 */

import { log } from '#core/logger';
import { createRequire } from 'node:module';
import { CHANNEL_VERSION } from '../channel/index.js';
import { conversationStore } from '../conversation-hub/index.js';

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
 * @typedef {{
 *     status: string;
 *     sessionId: string | null;
 *     getStatusSnapshot: () => AgentSnap;
 *     start: () => Promise<void>;
 *     stop: (opts?: { shutdownTimeoutMs?: number }) => Promise<void>;
 *     sendMessage: (
 *         message: string,
 *         opts?: { timeoutMs?: number; attachments?: import('@github/copilot-sdk').MessageOptions['attachments'] },
 *     ) => Promise<unknown>;
 *     answerPendingQuestion: (answer: string) => boolean;
 *     startDialogLoop: (bootPrompt?: string) => Promise<void>;
 *     sendDialogTurn: (text: string, opts?: { timeout?: number }) => Promise<string>;
 *     stopDialogLoop: (opts?: {
 *         authorized?: boolean;
 *         reason?: 'watchdog_restart' | 'authorized_stop';
 *     }) => Promise<void>;
 *     getPermissionMode?: () => 'approve_all' | 'audit_only' | 'selective';
 *     setPermissionMode?: (
 *         mode: 'approve_all' | 'audit_only' | 'selective',
 *         opts?: { allowTools?: string[]; denyTools?: string[]; denyShell?: boolean },
 *     ) => void;
 *     on: (event: string, listener: (...args: any[]) => void) => any;
 *     off: (event: string, listener: (...args: any[]) => void) => any;
 *     listenerDiagnostics: () => Record<string, number>;
 *     setMaxListeners?: (n: number) => void;
 *     queueSize: number;
 *     dialogLoopActive?: boolean;
 * }} AlwaysAliveAgentLike
 */

/**
 * Registra rotas de controle do agente no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde as rotas serão registradas
 * @param {AlwaysAliveAgentLike} agent - Instância do AlwaysAliveAgent
 * @returns {void}
 */
export function registerControlRoutes(bridge, agent) {
    // ─── GET /status ──────────────────────────────────────────────────────────

    /**
     * Retorna o estado atual do agente (status, pergunta pendente, fila, etc.).
     */
    bridge.get('/status', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
        res.json({ ok: true, ...agent.getStatusSnapshot() });
    });

    // ─── GET /health ──────────────────────────────────────────────────────────

    /**
     * Health check para orquestradores, load balancers e sistemas de monitoramento.
     *
     * Status HTTP 200 quando agente está operacional (idle | processing | waiting_for_input). Status HTTP 503 quando
     * agente está parado ou sem sessão.
     *
     * Body: { healthy, status, sessionId, queueSize, starvationAlert, uptime, listenerCounts, channelVersion, hubStore
     * }
     */
    bridge.get('/health', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
        const snap = /** @type {AgentSnap} */ (agent.getStatusSnapshot());
        const healthy = snap.status === 'idle' || snap.status === 'processing' || snap.status === 'waiting_for_input';

        // ARCH-04: verificar conectividade do ConversationStore (SQLite)
        /** @type {{ ok: boolean; error?: string }} */
        const hubStore = (() => {
            try {
                conversationStore.db?.prepare('SELECT 1').get();
                return { ok: true };
            } catch (/** @type {any} */ e) {
                return { ok: false, error: /** @type {string} */ (e.message ?? 'unknown') };
            }
        })();

        res.status(healthy ? 200 : 503).json({
            healthy,
            status: snap.status,
            sessionId: snap.sessionId,
            queueSize: snap.queueSize,
            starvationAlert: snap.starvationAlert,
            uptime: snap.startedAt !== null ? Date.now() - snap.startedAt : null,
            // SEC-V04 (fix): listenerCounts removido da resposta HTTP — expunha topologia interna de eventos
            channelVersion: CHANNEL_VERSION,
            // UPG-PROP-07 (fix): versão do SDK e do Node.js para rastreabilidade em deploys
            sdkVersion: _sdkVersion,
            nodeVersion: process.version,
            // UPG-PROP-10 (fix): diagnóstico de listeners disponível apenas em desenvolvimento
            listenerDiagnostics: process.env.NODE_ENV === 'development' ? agent.listenerDiagnostics?.() : undefined,
            hubStore,
        });
    });

    // ─── GET /session ─────────────────────────────────────────────────────────

    /**
     * Informações sobre a sessão ativa.
     */
    bridge.get('/session', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
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
    });

    // ─── POST /start ──────────────────────────────────────────────────────────

    /**
     * Inicia o agente (cria ou retoma sessão). Idempotente se já estiver ativo.
     */
    bridge.post('/start', async (/** @type {Req} */ _req, /** @type {Res} */ res) => {
        try {
            if (agent.status !== 'stopped') {
                return res.json({ ok: true, message: 'Agente já está ativo.', status: agent.status });
            }
            await agent.start();
            return res.json({ ok: true, sessionId: agent.sessionId, status: agent.status });
        } catch (/** @type {any} */ e) {
            log('ERROR', `[bridge-control/start] ${e.message}`);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── POST /stop ───────────────────────────────────────────────────────────

    /**
     * Para o agente graciosamente (preserva estado em disco para retomada).
     */
    bridge.post('/stop', async (/** @type {Req} */ _req, /** @type {Res} */ res) => {
        try {
            await agent.stop();
            return res.json({ ok: true, message: 'Agente parado.' });
        } catch (/** @type {any} */ e) {
            log('ERROR', `[bridge-control/stop] ${e.message}`);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── GET /permissions ─────────────────────────────────────────────────────

    /**
     * Retorna o modo de aprovação de tools atualmente ativo.
     *
     * Response: { ok: true, mode: 'approve_all' | 'audit_only' | 'selective' }
     */
    bridge.get('/permissions', (/** @type {Req} */ _req, /** @type {Res} */ res) => {
        const mode = typeof agent.getPermissionMode === 'function' ? agent.getPermissionMode() : 'approve_all';
        return res.json({ ok: true, mode });
    });

    // ─── POST /permissions ────────────────────────────────────────────────────

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * Body: { mode: 'approve_all' | 'audit_only' | 'selective', allowTools?: string[], denyTools?: string[],
     * denyShell?: boolean }
     *
     * DL-PERM: o dialog loop não é uma tool e não é afetado por este endpoint.
     */
    bridge.post('/permissions', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        const { mode, allowTools, denyTools, denyShell } = req.body ?? {};
        const validModes = ['approve_all', 'audit_only', 'selective'];
        if (!mode || !validModes.includes(mode)) {
            return res.status(400).json({
                ok: false,
                error: `Campo "mode" inválido. Valores aceitos: ${validModes.join(', ')}.`,
            });
        }
        if (typeof agent.setPermissionMode !== 'function') {
            return res.status(501).json({ ok: false, error: 'setPermissionMode não disponível nesta instância.' });
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
            log('INFO', `[bridge-control/permissions] modo: ${before} → ${after}`);
            return res.json({ ok: true, before, after });
        } catch (/** @type {any} */ e) {
            log('ERROR', `[bridge-control/permissions] ${e.message}`);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });
}
