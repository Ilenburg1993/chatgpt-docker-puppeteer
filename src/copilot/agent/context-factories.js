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

import {
    EMITTER_AGENT_BACKGROUND_COMPLETED,
    EMITTER_AGENT_BACKGROUND_IDLE,
    EMITTER_PERMISSION_MODE_CHANGED,
} from '#copilot/events';
import { MESSAGES_CACHE_TTL_MS } from '../config/agent.js';
import { createAgentSdkToolsRegistry } from './facades/agent-sdk-access.js';
import { WebhookManager } from '../infra/webhooks.js';
import { BackgroundTasks } from './background-tasks.js';
import { DialogLoopManager } from './dialog/loop-manager.js';
import { HandoffManager } from './infra/handoff-manager.js';
import { MessageQueue } from './infra/message-queue.js';
import { createAgentPermissionController } from './ports/permission-port.js';
import { SessionMessagesCache } from './session/history-sync.js';
import { SessionKeepalive } from './session/keepalive.js';

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
 *     createPermissions: (
 *         host: AgentContextFactoryHost,
 *     ) => import('./ports/permission-port.js').AgentPermissionController;
 *     createToolsRegistry: (host: AgentContextFactoryHost) => import('#copilot/sdk/tools-registry').ToolRegistry;
 *     createKeepalive: (host: AgentContextFactoryHost) => SessionKeepalive;
 *     createHandoff: (host: AgentContextFactoryHost) => HandoffManager;
 *     createMessagesCache: (host: AgentContextFactoryHost) => SessionMessagesCache;
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
