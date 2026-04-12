// @ts-check
/**
 * src/copilot/observability/event-collector.js
 *
 * @module copilot/observability/event-collector
 * @see EventBus
 */

import { COPILOT_EVENTS_MAX_BYTES, COPILOT_LOG_DIR } from '#copilot/config';
import { logSwallowed, registerShutdownHandler } from '#copilot/core';
import { onSessionEvent } from '#copilot/sdk';
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    attachAssistantHandlers,
    attachInteractionHandlers,
    attachSessionHandlers,
    attachToolHandlers,
    injectRecordCompaction,
    quotaState,
} from './collectors/index.js';
import { log } from './logger.js';

/**
 * Resolve LOGS_DIR sem depender de LOG_DIR (evita TDZ em import cíclico).
 *
 * @see logger.js - mesma logica de resolucao.
 */
const _ecProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOGS_DIR = COPILOT_LOG_DIR ? path.resolve(COPILOT_LOG_DIR) : path.join(_ecProjectRoot, 'var', 'logs', 'copilot');
const EVENTS_FILE = path.join(LOGS_DIR, 'events.jsonl');
const MAX_EVENTS_BYTES = COPILOT_EVENTS_MAX_BYTES;

/**
 * @typedef {{ remainingPercentage: number; resetDate?: string; [k: string]: unknown }} QuotaSnapshot
 */

/**
 * Último quotaSnapshot por quotaId, atualizado a cada `assistant.usage`. Estado compartilhado via
 * collectors/assistant-handlers.js.
 */

/**
 * Retorna o último quotaSnapshot recebido.
 *
 * @returns {{ snapshots: Record<string, QuotaSnapshot>; ts: number }}
 */
export function getLastQuotaSnapshots() {
    return { snapshots: /** @type {Record<string, QuotaSnapshot>} */ (quotaState.snapshots), ts: quotaState.ts };
}
/**
 * @typedef {{ type: string; ts: unknown; data?: unknown }} CompactionEntry
 */

/** @type {Map<string, CompactionEntry[]>} */
const _compactionHistory = new Map();

const MAX_COMPACTION_ENTRIES = 50;

/**
 * Registra um evento de compaction para a sessão.
 *
 * @param {string} sessionId
 * @param {CompactionEntry} entry
 */
function _recordCompaction(sessionId, entry) {
    let list = _compactionHistory.get(sessionId);
    if (!list) {
        list = [];
        _compactionHistory.set(sessionId, list);
    }
    list.push(entry);
    if (list.length > MAX_COMPACTION_ENTRIES) list.shift();
}
/**
 * Retorna o histórico de compaction para uma sessão.
 *
 * @param {string} sessionId
 * @returns {CompactionEntry[]}
 */
export function getCompactionHistory(sessionId) {
    return _compactionHistory.get(sessionId) ?? [];
}

/** @type {string[]} */
const _writeQueue = [];
let _flushScheduled = false;

/**
 * FINDING-P4-3 fix: flush síncrono dos eventos pendentes antes do processo encerrar. Registrado uma única vez como
 * beforeExit handler para não duplicar em múltiplos reloads.
 */
async function _flushOnExit() {
    const batch = _writeQueue.splice(0);
    if (!batch.length) return;
    try {
        await mkdir(LOGS_DIR, { recursive: true });
        await appendFile(EVENTS_FILE, batch.join(''), 'utf8');
    } catch (/** @type {any} */ e) {
        logSwallowed(e, 'event-collector.flush');
    }
}

registerShutdownHandler(
    'event-collector.flush',
    async () => {
        await _flushOnExit();
    },
    90,
);

/**
 * Agenda flush assíncrono de eventos para disco.
 *
 * @returns {void}
 */
function scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    setImmediate(async () => {
        _flushScheduled = false;
        const batch = _writeQueue.splice(0);
        if (!batch.length) return;
        try {
            await mkdir(LOGS_DIR, { recursive: true });
            // LEAK-OBS-001: rotacionar arquivo quando MAX_EVENTS_BYTES é atingido
            try {
                const { size } = await stat(EVENTS_FILE);
                if (size >= MAX_EVENTS_BYTES) {
                    await rename(EVENTS_FILE, EVENTS_FILE + '.1');
                }
            } catch (/** @type {any} */ e) {
                logSwallowed(e, 'event-collector.stat');
            }
            await appendFile(EVENTS_FILE, batch.join(''), 'utf8');
        } catch (/** @type {any} */ e) {
            logSwallowed(e, 'event-collector.persist');
        }
    });
}
/**
 * Persiste um evento em events.jsonl (filtragem por max bytes é simplificada — sem rotação aqui).
 *
 * @param {Record<string, unknown>} entry
 * @returns {void}
 */
function persistEvent(entry) {
    _writeQueue.push(JSON.stringify({ _collected: new Date().toISOString(), ...entry }) + '\n');
    scheduleFlush();
}
/**
 * @typedef {import('./metrics.js').MetricsStore} TelemetryStore
 *
 * @typedef {import('#copilot/hooks/bus').HookBus} HookBus
 *
 * @typedef {import('./metrics.js').MetricsStore} MetricsStore
 *
 * @typedef {import('./error-tracker.js').ErrorTracker} ErrorTracker
 */

/**
 * @typedef {object} EventCollectorOptions
 * @property {MetricsStore | null} [metrics] - Store de métricas para alimentar contadores e histogramas.
 * @property {ErrorTracker | null} [errorTracker] - Tracker para erros de sessão SDK.
 * @property {HookBus | null} [hookBus] - Bus para re-emitir eventos como hooks (opcional).
 * @property {boolean} [persist] - Se true, persiste eventos relevantes em events.jsonl (padrão: true).
 * @property {ReadonlySet<string> | readonly string[]} [persistTypes] - Tipos de eventos a persistir (padrão: Set
 *   canônico). Set é preferido (O(1) vs O(n)); arrays são aceitos e convertidos internamente.
 * @property {boolean} [captureUserContent] - Se true, persiste content de user.message (OFF por padrão — risco PII).
 * @property {boolean} [captureAssistantContent] - Se true, persiste conteúdo de assistant.message (OFF por padrão).
 */

/**
 * @typedef {{ toolName: string; mcpServerName: string | null; startTs: number; toolArgs: Record<string, unknown> }} PendingToolEntry
 *
 *
 * @typedef {{ turnId: string; startTs: number }} PendingTurnEntry
 */

/**
 * @typedef {object} EventCollector
 * @property {(session: import('#copilot/sdk/types').CopilotSession, sessionId: string) => (() => void)[]} attach
 *
 *   - Registra handlers na sessão e retorna lista de unsubscribers.
 */

// Fase CC: convertido de Array.freeze para Set → O(1) lookup em .has() vs O(n) em .includes().
// Remoção do duplicado 'session.workspace_file_changed' adicionado por engano na Fase BF.
const DEFAULT_PERSIST_TYPES = /** @type {ReadonlySet<string>} */ (
    Object.freeze(
        new Set([
            'tool.execution_start',
            'tool.execution_complete',
            'tool.user_requested',
            'assistant.usage',
            'assistant.turn_start',
            'assistant.turn_end',
            'assistant.message',
            'assistant.intent',
            'assistant.reasoning',
            'user.message',
            'session.start',
            'session.resume',
            'session.usage_info',
            'session.error',
            'session.truncation',
            'session.compaction_start',
            'session.compaction_complete',
            'session.tools_updated',
            'session.mcp_servers_loaded',
            'session.mode_changed',
            'session.model_change',
            'session.plan_changed',
            'session.background_tasks_changed',
            'session.workspace_file_changed',
            'session.context_changed',
            'session.handoff',
            'session.skills_loaded',
            'session.extensions_loaded',
            'session.mcp_server_status_changed',
            'session.title_changed',
            'session.info',
            'session.warning',
            'session.task_complete',
            'session.shutdown',
            'session.snapshot_rewind',
            'permission.requested',
            'permission.completed',
            'elicitation.requested',
            'elicitation.completed',
            'user_input.requested',
            'user_input.completed',
            'hook.start',
            'hook.end',
            'skill.invoked',
            'subagent.started',
            'subagent.completed',
            'subagent.failed',
            'subagent.selected',
            'subagent.deselected',
            'mcp.oauth_required',
            'mcp.oauth_completed',
            'external_tool.requested',
            'external_tool.completed',
            'command.execute',
            'command.queued',
            'command.completed',
            'exit_plan_mode.requested',
            'exit_plan_mode.completed',
            'system.message',
            'system.notification',
            'abort',
        ]),
    )
);

/**
 * Cria um EventCollector configurado.
 *
 * @example
 *     const collector = createEventCollector({ telemetry, hookBus: defaultBus });
 *     const unsubs = collector.attach(session, sessionId);
 *
 * @param {EventCollectorOptions} [opts={}] Default is `{}`
 * @returns {EventCollector}
 */
export function createEventCollector(opts = {}) {
    const {
        metrics = null,
        errorTracker = null,
        hookBus = null,
        persist = true,
        persistTypes = DEFAULT_PERSIST_TYPES,
        captureUserContent = false,
        captureAssistantContent = false,
    } = opts;

    /** @type {ReadonlySet<string>} */
    const _persistSet = persistTypes instanceof Set ? persistTypes : new Set(persistTypes);

    /** @type {Map<string, PendingToolEntry>} */
    const _pending = new Map();

    /** @type {Map<string, number>} */
    const _turnStart = new Map();

    // Injetar _recordCompaction nos session-handlers
    injectRecordCompaction(_recordCompaction);

    /**
     * Registra handlers nos eventos da sessão SDK e retorna lista de unsubscribers.
     *
     * @param {import('#copilot/sdk/types').CopilotSession} session - Sessão SDK ativa.
     * @param {string} sessionId - ID da sessão.
     * @returns {(() => void)[]} Lista de funções de unsubscribe para cleanup.
     */
    function attach(session, sessionId) {
        /** @type {import('./collectors/context.js').CollectorContext} */
        const ctx = {
            session,
            sessionId,
            metrics,
            errorTracker,
            hookBus,
            persist,
            persistSet: _persistSet,
            persistEvent,
            captureUserContent,
            captureAssistantContent,
            pending: _pending,
            turnStart: _turnStart,
        };

        const unsubs = [
            ...attachToolHandlers(ctx),
            ...attachSessionHandlers(ctx),
            ...attachAssistantHandlers(ctx),
            ...attachInteractionHandlers(ctx),
        ];

        log('DEBUG', `[event-collector] ${unsubs.length} handlers registrados para session=${sessionId}`);

        return unsubs;
    }

    return { attach };
}

/** Instância default do event collector. Configurada via `initEventCollector()`. */
let _defaultCollector = createEventCollector({ persist: true });

/**
 * Inicializa o singleton defaultCollector com métricas, errorTracker e hookBus.
 *
 * Deve ser chamado uma vez no boot do agente, antes do primeiro `.attach()`.
 *
 * @param {EventCollectorOptions} opts
 * @returns {void}
 */
export function initEventCollector(opts) {
    _defaultCollector = createEventCollector(opts);
}
/**
 * Collector singleton — usar após `initEventCollector()`.
 *
 * @type {EventCollector}
 */
export const defaultEventCollector = {
    attach: (...args) => _defaultCollector.attach(...args),
};

/** Tamanho máximo do arquivo de eventos (bytes). */
export { MAX_EVENTS_BYTES };

/**
 * Registra um handler tipado em um evento da sessão SDK usando o wrapper `onSessionEvent` do sdk/events.js. Utilitário
 * para collectors que preferem eventos tipados com validação integrada.
 *
 * @param {import('#copilot/sdk/types').CopilotSession} session - Sessão SDK ativa.
 * @param {string} eventType - Tipo de evento (e.g., 'assistant.message').
 * @param {(event: any) => void} handler - Handler do evento.
 * @returns {() => void} Função de unsubscribe.
 */
export function attachSdkEventTyped(session, eventType, handler) {
    return onSessionEvent(session, eventType, handler);
}
