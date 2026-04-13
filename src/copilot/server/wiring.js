// @ts-check
/**
 * src/copilot/server/wiring.js
 *
 * @deprecated L53.17 — Este módulo está órfão desde a Onda 2.7.
 * O copilot é ferramenta DEV-only e boot via terminal:llm-b.
 * O server de produção não chama mais wireServerCopilot().
 * Mantido para referência; funcionalidade pode ser reaproveitada
 * se o terminal precisar de socket.io ou NERV bridge no futuro.
 *
 * Funcionalidades originais:
 * - NervEventBusAdapter mount
 * - Inbound NERV commands (SEND_MESSAGE, PAUSE, RESUME, RESTART)
 * - ConversationHub init (socket.io + NERV)
 * - AlwaysAliveAgent autostart (se COPILOT_AGENT_AUTOSTART !== 'false')
 *
 * @module copilot/server/wiring
 */

import { container } from '../core/di-container.js';
import { EVENT_BUS } from '../core/di-tokens.js';
import { log } from '../observability/logger.js';

/**
 * @typedef {object} ServerContext
 * @property {any} [io] Socket.IO server instance
 * @property {any} [nerv] NERV event bus instance
 */

/**
 * Wiring copilot ↔ server: NERV adapter, ConversationHub, agent autostart.
 *
 * @param {ServerContext} context
 * @returns {Promise<void>}
 */
export async function wireServerCopilot({ io, nerv }) {
    const eventBus = container.resolve(EVENT_BUS);

    // ── NervEventBusAdapter — relay EventBus ↔ NERV ─────────────────────
    if (eventBus && nerv) {
        try {
            const { nervEventBusAdapter } = await import('../bridges/nerv-event-bus-adapter.js');
            nervEventBusAdapter.mount(eventBus, nerv);
            log('INFO', '[COPILOT] NervEventBusAdapter montado — EventBus ↔ NERV');

            // Inbound commands: NERV → EventBus → Agent
            const {
                NERV_COMMAND_SEND_MESSAGE,
                NERV_COMMAND_PAUSE,
                NERV_COMMAND_RESUME,
                NERV_COMMAND_RESTART,
            } = await import('../events/index.js');
            const { alwaysAliveAgent } = await import('../agent/always-alive.js');

            eventBus.on(NERV_COMMAND_SEND_MESSAGE, (/** @type {any} */ evt) => {
                const msg = evt?.message;
                if (typeof msg === 'string' && msg.trim()) {
                    void alwaysAliveAgent.sendMessage(msg, evt?.options ?? {});
                }
            });
            eventBus.on(NERV_COMMAND_PAUSE, () => {
                if (typeof alwaysAliveAgent.pauseDialogLoop === 'function') {
                    void alwaysAliveAgent.pauseDialogLoop();
                }
            });
            eventBus.on(NERV_COMMAND_RESUME, () => {
                if (typeof alwaysAliveAgent.resumeDialogLoop === 'function') {
                    void alwaysAliveAgent.resumeDialogLoop();
                }
            });
            eventBus.on(NERV_COMMAND_RESTART, async () => {
                await alwaysAliveAgent.stop();
                await alwaysAliveAgent.start();
            });
            log('INFO', '[COPILOT] Inbound NERV commands registrados via EventBus');
        } catch (/** @type {any} */ e) {
            log('WARN', `[COPILOT] Falha ao montar NervEventBusAdapter: ${e.message}`);
        }
    }

    // ── ConversationHub ─────────────────────────────────────────────────
    if (io) {
        try {
            const { conversationHub } = await import('../conversation-hub/hub.js');
            await conversationHub.init({ io, nerv });
            log('INFO', '[COPILOT] ConversationHub inicializado — namespace /copilot ativo');
        } catch (/** @type {any} */ e) {
            log('WARN', `[COPILOT] Falha ao inicializar ConversationHub: ${e.message}`);
        }
    }

    // ── AlwaysAliveAgent autostart ──────────────────────────────────────
    if (process.env.COPILOT_AGENT_AUTOSTART !== 'false') {
        try {
            const { alwaysAliveAgent } = await import('../agent/always-alive.js');
            if (alwaysAliveAgent.status === 'stopped') {
                log('INFO', '[COPILOT] Auto-starting AlwaysAliveAgent...');
                await alwaysAliveAgent.start();
                log('INFO', `[COPILOT] AlwaysAliveAgent ativo. SessionId: ${alwaysAliveAgent.sessionId}`);
            } else {
                log('INFO', `[COPILOT] AlwaysAliveAgent já ativo (status=${alwaysAliveAgent.status})`);
            }
        } catch (/** @type {any} */ e) {
            log(
                'WARN',
                `[COPILOT] Falha ao auto-iniciar AlwaysAliveAgent: ${e.message} — hub disponível mas sem agente`,
            );
        }
    }
}
