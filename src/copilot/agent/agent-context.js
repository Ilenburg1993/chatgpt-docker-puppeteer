// @ts-check
/**
 * src/copilot/agent/agent-context.js
 *
 * F35: AgentContext — objeto de contexto compartilhado entre todos os módulos do agente.
 *
 * Substitui os 32 campos #private espalhados por always-alive.js, permitindo que módulos extraídos (lifecycle, dialog,
 * messaging, state) acessem o estado via referência ao contexto ao invés de callbacks pesados.
 *
 * ATENÇÃO: este módulo NÃO é exportado no barrel público (index.js). Uso exclusivo interno do agent/ — consumidores
 * externos acessam via API pública do AlwaysAliveAgent.
 *
 * @module copilot/agent/agent-context
 * @internal
 */

import { createRegistry } from '#copilot/sdk/index';
import { COPILOT_MODEL, COPILOT_REASONING_EFFORT, MESSAGES_CACHE_TTL_MS } from './config.js';
import { DialogLoopManager } from './dialog/loop-manager.js';
import { HandoffManager } from './infra/handoff-manager.js';
import { MessageQueue } from './infra/message-queue.js';
import { PermissionController } from './infra/permission-controller.js';
import { WebhookManager } from './infra/webhook-manager.js';
import { SessionMessagesCache } from './session/history-sync.js';
import { SessionKeepalive } from './session/keepalive.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 *
 * @typedef {import('./always-alive.js').PendingQuestion} PendingQuestion
 *
 * @typedef {import('./always-alive.js').AgentStatus} AgentStatus
 */

/**
 * Contexto compartilhado entre todos os módulos internos do agente.
 *
 * Ciclo de vida: criado uma vez no constructor do AlwaysAliveAgent, passado por referência a todos os sub-módulos.
 * Campos são mutáveis diretamente — a semântica é idêntica aos antigos #private fields.
 */
export class AgentContext {
    // ─── SDK / Session ─────────────────────────────────────────────────────

    /** @type {CopilotClient | null} */
    client = null;

    /** @type {CopilotSession | null} */
    session = null;

    /** @type {boolean} */
    isReconnecting = false;

    /**
     * Funções de unsubscribe retornadas por session.on().
     *
     * @type {(() => void)[]}
     */
    sessionEventUnsubscribers = [];

    // ─── State ─────────────────────────────────────────────────────────────

    /** @type {AgentStatus} */
    status = 'stopped';

    /** @type {boolean} */
    isResumed = false;

    /** @type {number} */
    sendCount = 0;

    /** @type {PendingQuestion | null} */
    pendingQuestion = null;

    /**
     * Cache do status snapshot com dirty flag + TTL.
     *
     * @type {{ snapshot: import('./always-alive.js').AgentStatusSnapshot; at: number } | null}
     */
    statusSnapshotCache = null;

    // ─── Config ────────────────────────────────────────────────────────────

    /** @type {string} */
    model;

    /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
    reasoningEffort;

    // ─── Counters / Caches ─────────────────────────────────────────────────

    /**
     * Último snapshot de billing (model, cost, quotaSnapshots, timestamp).
     *
     * @type {{ model?: string; cost?: number; quotaSnapshots?: Record<string, unknown>; ts: number } | null}
     */
    lastPrInfo = null;

    /**
     * Uso de contexto capturado do evento session.usage_info.
     *
     * @type {{ tokens: number; tokenLimit: number; utilization: number } | null}
     */
    contextState = null;

    /**
     * Último caminho de checkpoint salvo pelo SDK.
     *
     * @type {string | null}
     */
    lastCheckpointPath = null;

    // ─── Infra (timers / cancel tokens) ────────────────────────────────────

    /**
     * Timer de emissão periódica de agent.metrics.
     *
     * @type {ReturnType<typeof setInterval> | null}
     */
    metricsTimer = null;

    /**
     * Cancel do job de auto-reconnect ao MCP.
     *
     * @type {(() => void) | null}
     */
    mcpReconnectCancel = null;

    /**
     * Flag de idempotência do dialog loop wiring.
     *
     * @type {boolean}
     */
    dialogLoopAttached = false;

    /**
     * Agent-event-observer para cleanup no stop().
     *
     * @type {{ attach: (agent: import('node:events').EventEmitter) => void; detach: () => void } | null}
     */
    agentObserver = null;

    // ─── Managers (instâncias com lifecycle) ───────────────────────────────

    /** @type {DialogLoopManager} */
    dialogLoop;

    /** @type {MessageQueue} */
    messageQueue;

    /** @type {WebhookManager} */
    webhooks;

    /** @type {PermissionController} */
    permissions;

    /** @type {import('#copilot/sdk/tools-registry').ToolRegistry} */
    toolsRegistry;

    /** @type {SessionKeepalive} */
    keepalive;

    /** @type {HandoffManager} */
    handoff;

    /** @type {SessionMessagesCache} */
    messagesCache;

    /**
     * @param {import('node:events').EventEmitter} emitter - Referência ao AlwaysAliveAgent (para emit)
     * @param {{ model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' }} [options]
     */
    constructor(emitter, options = {}) {
        this.model = options.model ?? COPILOT_MODEL;
        this.reasoningEffort =
            /** @type {'low' | 'medium' | 'high' | 'xhigh' | undefined} */
            (options.reasoningEffort ?? (COPILOT_REASONING_EFFORT || undefined));

        // Instanciar managers com callbacks para o emitter
        this.messageQueue = new MessageQueue({
            onEnqueue: () => emitter.emit('__processQueue'),
            onChanged: () => {
                this.statusSnapshotCache = null;
            },
        });

        this.dialogLoop = new DialogLoopManager();
        this.webhooks = new WebhookManager();
        this.permissions = new PermissionController({
            onModeChanged: (mode) => emitter.emit('permission.mode_changed', { mode }),
        });
        this.toolsRegistry = createRegistry();
        this.keepalive = new SessionKeepalive();
        this.handoff = new HandoffManager();
        this.messagesCache = new SessionMessagesCache(MESSAGES_CACHE_TTL_MS);
    }

    /**
     * Altera o status e invalida o cache de snapshot. Emite evento 'status' no emitter passado.
     *
     * @param {AgentStatus} status
     * @param {import('node:events').EventEmitter} emitter
     */
    setStatus(status, emitter) {
        this.status = status;
        this.statusSnapshotCache = null;
        emitter.emit('status', status);
    }
}
