// @ts-check
/**
 * Factories default dos managers vivos do `AgentContext`.
 *
 * Padrão arquitetural:
 *
 * - `AgentContext` governa estado e invariantes;
 * - factories materializam managers/capabilities;
 * - ports continuam sendo a fronteira para capacidades externas ao agent;
 * - testes e runtimes futuros podem trocar uma capability sem transformar o contexto em container genérico.
 *
 * @module copilot/agent/context-factories
 * @internal
 */

import { MESSAGES_CACHE_TTL_MS } from '#copilot/config/agent';
import {
    EMITTER_AGENT_BACKGROUND_COMPLETED,
    EMITTER_AGENT_BACKGROUND_IDLE,
    EMITTER_PERMISSION_MODE_CHANGED,
} from '#copilot/events';
import { normalizeElicitationCompletedEvent, normalizeElicitationPendingEvent } from '#copilot/sdk';
import { BackgroundTasks } from './background/index.js';
import { DialogLoopManager } from './dialog/orchestrators/index.js';
import { createAgentSdkToolsRegistry } from './facades/index.js';
import { HandoffManager, MessageQueue, WebhookManager } from './infra/index.js';
import { createAgentPermissionController, createQueuedElicitationHandler, defaultMetrics } from './ports/index.js';
import { SessionMessagesCache } from './session/history/index.js';
import { SessionKeepalive } from './session/lifecycle/index.js';

/**
 * @typedef {{
 *     emitter: import('node:events').EventEmitter;
 *     emitProcessQueue: () => void;
 *     invalidateStatusSnapshot: () => void;
 * }} AgentContextFactoryHost
 *
 *
 * @typedef {{
 *     createMessageQueue: (host: AgentContextFactoryHost) => MessageQueue;
 *     createDialogLoop: (host: AgentContextFactoryHost) => DialogLoopManager;
 *     createWebhooks: (host: AgentContextFactoryHost) => WebhookManager;
 *     createPermissions: (host: AgentContextFactoryHost) => import('./ports/index.js').AgentPermissionController;
 *     createToolsRegistry: (host: AgentContextFactoryHost) => import('#copilot/sdk/tools-registry').ToolRegistry;
 *     createKeepalive: (host: AgentContextFactoryHost) => SessionKeepalive;
 *     createHandoff: (host: AgentContextFactoryHost) => HandoffManager;
 *     createMessagesCache: (host: AgentContextFactoryHost) => SessionMessagesCache;
 *     createSdkElicitation: (host: AgentContextFactoryHost) => {
 *         handler: import('#copilot/sdk/types').ElicitationHandler;
 *         resolvePending: (id: string, result: import('#copilot/sdk/types').ElicitationResult) => boolean;
 *         listPending: (opts?: {
 *             sessionId?: string;
 *         }) => import('#copilot/sdk/session/elicitation').QueuedElicitationEntry[];
 *         getPending: (id: string) => import('#copilot/sdk/session/elicitation').QueuedElicitationEntry | null;
 *         clearPending: (id: string, result?: import('#copilot/sdk/types').ElicitationResult) => boolean;
 *         pendingCount: () => number;
 *     };
 *     createBackgroundTasks: (host: AgentContextFactoryHost) => BackgroundTasks;
 *     describePermissionsCapability: (host: AgentContextFactoryHost) => Record<string, unknown>;
 *     describeFactorySet: (host: AgentContextFactoryHost) => Record<string, Record<string, unknown>>;
 * }} AgentContextFactories
 */

/** @type {AgentContextFactories} */
export const defaultAgentContextFactories = Object.freeze({
    createMessageQueue: (host) =>
        new MessageQueue({
            onEnqueue: host.emitProcessQueue,
            onChanged: host.invalidateStatusSnapshot,
        }),
    createDialogLoop: () => new DialogLoopManager(),
    createWebhooks: () => new WebhookManager(),
    createPermissions: (host) =>
        createAgentPermissionController({
            onModeChanged: (mode) => host.emitter.emit(EMITTER_PERMISSION_MODE_CHANGED, { mode }),
        }),
    createToolsRegistry: () => createAgentSdkToolsRegistry(),
    createKeepalive: () => new SessionKeepalive(),
    createHandoff: () => new HandoffManager(),
    createMessagesCache: () => new SessionMessagesCache(MESSAGES_CACHE_TTL_MS),
    createSdkElicitation: (host) => {
        const queued = createQueuedElicitationHandler({
            onPending: (entry) => {
                defaultMetrics.recordCounter('sdk.elicitation.provider.pending.total');
                defaultMetrics.recordGauge('sdk.elicitation.provider.pending.current', queued.pendingCount());
                host.invalidateStatusSnapshot();
                host.emitter.emit(
                    'elicitation.pending',
                    normalizeElicitationPendingEvent({
                        requestId: entry.id,
                        sessionId: entry.sessionId,
                        message: entry.message,
                        mode: entry.mode,
                        requestedSchema: entry.requestedSchema ?? null,
                        url: entry.url ?? null,
                        elicitationSource: entry.elicitationSource ?? null,
                        providerRequest: true,
                        actionable: true,
                        ts: entry.createdAt,
                    }),
                );
            },
            onCompleted: (entry) => {
                const waitMs = Math.max(0, entry.completedAt - entry.createdAt);
                defaultMetrics.recordCounter('sdk.elicitation.provider.completed.total');
                defaultMetrics.recordCounter(`sdk.elicitation.provider.action.${entry.result.action}`);
                defaultMetrics.recordGauge('sdk.elicitation.provider.pending.current', queued.pendingCount());
                defaultMetrics.recordGauge('sdk.elicitation.provider.last_wait_ms', waitMs);
                host.invalidateStatusSnapshot();
                host.emitter.emit(
                    'elicitation.completed',
                    normalizeElicitationCompletedEvent({
                        requestId: entry.id,
                        sessionId: entry.sessionId,
                        providerRequest: true,
                        actionable: true,
                        data: entry.result,
                        action: entry.result.action,
                        content: entry.result.content ?? null,
                        ts: entry.completedAt,
                    }),
                );
            },
        });
        return queued;
    },
    createBackgroundTasks: (host) =>
        new BackgroundTasks({
            onCompleted: (event) => {
                host.emitter.emit(EMITTER_AGENT_BACKGROUND_COMPLETED, { agentType: 'always_alive', ...event });
            },
            onIdle: (event) => {
                host.emitter.emit(EMITTER_AGENT_BACKGROUND_IDLE, { agentType: 'always_alive', ...event });
            },
        }),
    describePermissionsCapability: () => ({
        provider: 'agent/ports/permission-port',
        factory: 'defaultAgentContextFactories.createPermissions',
        sdkFirst: true,
        stableHandler: true,
        runtimeAuthority: 'agent',
    }),
    describeFactorySet: () => ({
        'runtime.queue': {
            provider: 'agent/infra/message-queue',
            factory: 'defaultAgentContextFactories.createMessageQueue',
            runtimeAuthority: 'agent',
        },
        'dialog.loop': {
            provider: 'agent/dialog/loop-manager',
            factory: 'defaultAgentContextFactories.createDialogLoop',
            runtimeAuthority: 'agent',
        },
        'governance.permissions': {
            provider: 'agent/ports/permission-port',
            factory: 'defaultAgentContextFactories.createPermissions',
            sdkFirst: true,
            stableHandler: true,
            runtimeAuthority: 'agent',
        },
        'tools.registry': {
            provider: 'sdk/tools-registry',
            factory: 'defaultAgentContextFactories.createToolsRegistry',
            sdkFirst: true,
            runtimeAuthority: 'agent',
        },
        'integration.webhooks': {
            provider: 'infra/webhooks',
            factory: 'defaultAgentContextFactories.createWebhooks',
            runtimeAuthority: 'agent',
        },
        'integration.handoff': {
            provider: 'agent/infra/handoff-manager',
            factory: 'defaultAgentContextFactories.createHandoff',
            runtimeAuthority: 'agent',
        },
        'runtime.background-tasks': {
            provider: 'agent/background-tasks',
            factory: 'defaultAgentContextFactories.createBackgroundTasks',
            runtimeAuthority: 'agent',
        },
        'sdk.session-history-cache': {
            provider: 'agent/session/history-sync',
            factory: 'defaultAgentContextFactories.createMessagesCache',
            runtimeAuthority: 'agent',
        },
        'sdk.elicitation-provider': {
            provider: 'sdk/session/elicitation',
            factory: 'defaultAgentContextFactories.createSdkElicitation',
            sdkFirst: true,
            runtimeAuthority: 'agent',
        },
    }),
});

/**
 * Mescla overrides estreitos sobre as factories default.
 *
 * @param {Partial<AgentContextFactories>} [overrides]
 * @returns {AgentContextFactories}
 */
export function createAgentContextFactories(overrides = {}) {
    return {
        ...defaultAgentContextFactories,
        ...overrides,
    };
}
