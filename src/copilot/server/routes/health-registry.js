// @ts-check
/**
 * src/copilot/server/routes/health-registry.js — Registra health checks dos módulos principais.
 *
 * Chamado durante o boot do servidor para popular o registry de health-modules.
 *
 * @module copilot/server/routes/health-registry
 */

import { ALWAYS_ALIVE_AGENT } from '#copilot/agent';
import { CONVERSATION_STORE, HUB } from '#copilot/conversation-hub';
import { bridgeEmitter, container } from '#copilot/core';
import { getObservabilityBusDiagnostics } from '#copilot/observability';
import { buildAgentModuleHealth } from './agent-health.js';
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
        return buildAgentModuleHealth(agent);
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

    // ── Observability ───────────────────────────────────────────────────────
    registerModuleHealth('observability', () => {
        const diagnostics = getObservabilityBusDiagnostics();
        const health = diagnostics.health;
        return {
            ok: diagnostics.attached && health?.status !== 'critical',
            details: {
                attached: diagnostics.attached,
                actions: diagnostics.actions,
                health,
                activity: diagnostics.activity,
                recentTraceCount: diagnostics.recentTraceCount,
            },
        };
    });

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
