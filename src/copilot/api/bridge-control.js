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
import { CHANNEL_VERSION } from '../channel/index.js';
import { conversationStore } from '../conversation-hub/index.js';

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
 *     stopDialogLoop: (opts?: { authorized?: boolean; reason?: 'watchdog_restart' | 'authorized_stop' }) => Promise<void>;
 *     on: (event: string, listener: (...args: any[]) => void) => any;
 *     off: (event: string, listener: (...args: any[]) => void) => any;
 *     listenerDiagnostics: () => Record<string, number>;
 *     queueSize: number;
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
            listenerCounts: agent.listenerDiagnostics(),
            channelVersion: CHANNEL_VERSION,
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
}
