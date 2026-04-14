// @ts-check
/**
 * src/copilot/server/routes/health-registry.js — Registra health checks dos módulos principais.
 *
 * Chamado durante o boot do servidor para popular o registry de health-modules.
 *
 * @module copilot/server/routes/health-registry
 */

import { bridgeEmitter, container } from '#copilot/core';
import { ALWAYS_ALIVE_AGENT } from '../../agent/di-tokens.js';
import { CONVERSATION_STORE, HUB } from '../../conversation-hub/di-tokens.js';
import { registerModuleHealth } from './health-modules.js';

/**
 * Registra health checks dos módulos copilot com estado.
 *
 * Deve ser chamado após init do servidor.
 */
export function registerCopilotHealthChecks() {
    // ── Agent ────────────────────────────────────────────────────────────────
    registerModuleHealth('agent', () => {
        const agent = container.resolve(ALWAYS_ALIVE_AGENT);
        return {
            ok: true,
            details: {
                status: agent.status,
                dialogLoopActive: agent.dialogLoopActive,
                model: agent.model,
            },
        };
    });

    // ── ConversationHub ──────────────────────────────────────────────────────
    registerModuleHealth('conversation-hub', () => {
        const hub = container.resolve(HUB);
        const store = container.resolve(CONVERSATION_STORE);
        const activeSessions = hub.isReady ? store.countHubSessions({ status: 'active' }) : 0;
        return {
            ok: true,
            details: {
                initialized: hub.isReady,
                activeSessions,
            },
        };
    });

    // ── EventBus ─────────────────────────────────────────────────────────────
    registerModuleHealth('events', () => ({
        ok: !!bridgeEmitter,
        details: { bridgeEmitterAvailable: !!bridgeEmitter },
    }));

    // ── Process ──────────────────────────────────────────────────────────────
    registerModuleHealth('process', () => ({
        ok: true,
        details: {
            uptime: Math.round(process.uptime()),
            memoryMB: Math.round(process.memoryUsage.rss() / 1_048_576),
            pid: process.pid,
            nodeVersion: process.version,
        },
    }));
}
