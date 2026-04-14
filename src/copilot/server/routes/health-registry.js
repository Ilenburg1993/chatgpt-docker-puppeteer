// @ts-check
/**
 * src/copilot/server/routes/health-registry.js — Registra health checks dos módulos principais.
 *
 * Chamado durante o boot do servidor para popular o registry de health-modules.
 *
 * @module copilot/server/routes/health-registry
 */

import { conversationHub, conversationStore } from '#copilot/conversation-hub';
import { bridgeEmitter } from '#copilot/core';
import { alwaysAliveAgent } from '#copilot/services';
import { registerModuleHealth } from './health-modules.js';

/**
 * Registra health checks dos módulos copilot com estado.
 *
 * Deve ser chamado após init do servidor.
 */
export function registerCopilotHealthChecks() {
    // ── Agent ────────────────────────────────────────────────────────────────
    registerModuleHealth('agent', () => ({
        ok: true,
        details: {
            status: alwaysAliveAgent.status,
            dialogLoopActive: alwaysAliveAgent.dialogLoopActive,
            model: alwaysAliveAgent.model,
        },
    }));

    // ── ConversationHub ──────────────────────────────────────────────────────
    registerModuleHealth('conversation-hub', () => {
        const activeSessions = conversationHub.isReady ? conversationStore.countHubSessions({ status: 'active' }) : 0;
        return {
            ok: true,
            details: {
                initialized: conversationHub.isReady,
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
