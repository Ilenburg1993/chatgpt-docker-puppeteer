// @ts-check
/**
 * src/copilot/api/bridge-stream.js
 *
 * Rota SSE (Server-Sent Events) do AlwaysAliveAgent — push de eventos em tempo real.
 *
 * Exporta `registerStreamRoutes(bridge, agent)` para ser montado pelo http-bridge.js.
 *
 * @module copilot/api/bridge-stream
 */

import { AGENT_EVENTS } from '#copilot/core';

/**
 * @typedef {import('express').Request} Req
 *
 * @typedef {import('express').Response} Res
 *
 * @typedef {import('express').Router} BridgeRouter
 *
 * @typedef {import('./bridge-control.js').AlwaysAliveAgentLike} AlwaysAliveAgentLike
 *
 * @typedef {import('#copilot/core').AgentEventName} AgentEventName
 */

/**
 * Registra a rota SSE GET /stream no router fornecido.
 *
 * @param {BridgeRouter} bridge - Express Router onde a rota será registrada
 * @param {AlwaysAliveAgentLike} agent - Instância do AlwaysAliveAgent
 * @returns {void}
 */
export function registerStreamRoutes(bridge, agent) {
    // ARCH-05 (fix): cada conexão SSE adiciona N listeners ao agent (um por AGENT_EVENT).
    // Com múltiplos clientes conectados, o EventEmitter emit warning de memory leak.
    // setMaxListeners(0) desabilita o limite — correto para fan-out pattern.
    agent.setMaxListeners?.(0);
    // ─── GET /stream ──────────────────────────────────────────────────────────

    /**
     * SSE global do AlwaysAliveAgent — push de eventos em tempo real para o cliente.
     *
     * Eventos emitidos:
     *
     * - `connected` — estado inicial do agente ao conectar
     * - `task.queued` / `task.started` / `task.completed` / `task.error` / `task.delta`
     * - `question.pending` / `question.answered`
     * - `status` / `stopped` / `ready`
     * - `session.compaction_start` / `session.compaction_complete`
     * - `dialog.ready` / `dialog.reply` / `dialog.stopped` — eventos do Dialog Loop §15.8
     * - `tool.execution_start` / `tool.execution_complete` — auditoria de tool calls (Fase U/Q)
     * - `task.reasoning` / `session.usage` / `session.mode_changed` — eventos SDK (Fase U)
     * - `heartbeat` — sinal a cada 15 s para manter conexão viva
     *
     * Uso: `GET /api/copilot/stream` com `Accept: text/event-stream`
     */
    bridge.get('/stream', (/** @type {Req} */ req, /** @type {Res} */ res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        /**
         * Envia um evento SSE para o cliente.
         *
         * @param {AgentEventName | 'connected' | 'heartbeat'} event - Nome do evento SSE
         * @param {object} data - Dados serializados em JSON
         * @returns {void}
         */
        const sendEvt = (event, data) => {
            if (!res.writableEnded) {
                // SEC-VULN-02 (fix aplicado consistentemente): sanitizar nome do evento SSE
                const safeEvent = String(event).replace(/[\r\n]/g, '_');
                res.write(`event: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`);
            }
        };

        // Evento inicial com snapshot do estado atual
        sendEvt('connected', { ...agent.getStatusSnapshot(), timestamp: Date.now() });

        /** @type {Map<AgentEventName, (data: any) => void>} */
        const handlers = new Map(
            AGENT_EVENTS.map((evt) => [evt, (/** @type {any} */ data) => sendEvt(evt, data ?? {})]),
        );

        handlers.forEach((handler, evt) => agent.on(evt, handler));

        const heartbeat = setInterval(() => sendEvt('heartbeat', { ts: Date.now() }), 15_000);

        // G2-SEC-08: limite de vida por conexão SSE para evitar esgotamento de file descriptors.
        // Configurável via MAX_SSE_LIFETIME_MS (default 24h). Ao expirar, envia evento 'reconnect'
        // e fecha a conexão para forçar o cliente a reconectar.
        const MAX_SSE_LIFETIME_MS = Number(process.env.MAX_SSE_LIFETIME_MS) || 24 * 60 * 60 * 1000;
        const lifetimeTimer = setTimeout(() => {
            if (!res.writableEnded) {
                sendEvt(/** @type {any} */ ('reconnect'), { reason: 'max_lifetime', ts: Date.now() });
                res.end();
            }
        }, MAX_SSE_LIFETIME_MS);

        req.on('close', () => {
            clearTimeout(lifetimeTimer);
            clearInterval(heartbeat);
            handlers.forEach((handler, evt) => agent.off(evt, handler));
        });
    });
}
