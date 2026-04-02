// @ts-check
/**
 * src/copilot/agent/session-event-wirer.js
 *
 * Registra todos os listeners de eventos SDK de uma sessão Copilot, retornando as funções de unsubscribe
 * correspondentes.
 *
 * Função pura sem estado próprio — recebe `session` e um conjunto de callbacks que permitem ao AlwaysAliveAgent reagir
 * aos eventos sem acoplar este módulo ao agente.
 *
 * @module copilot/agent/session-event-wirer
 */

import { log } from '#copilot/observability/logger';
import { writeStateAsync } from './state-io.js';

/**
 * G2-PERF-02: Set de eventos SDK conhecidos como constante de módulo para evitar realocação a cada chamada de
 * `wireSessionEvents()` (ex.: reconexão após disconnect).
 *
 * @type {ReadonlySet<string>}
 */
const KNOWN_SDK_EVENTS = new Set([
    'session.compaction_start',
    'session.compaction_complete',
    'assistant.reasoning_delta',
    'session.usage_info',
    'session.mode_changed',
    'assistant.message_delta',
    'tool.execution_start',
    'tool.execution_complete',
    'assistant.usage',
]);

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * Payload genérico de eventos SDK. O SDK emite eventos com um `type` discriminant e `data` variável. Como
 * `session.on(eventName, cb)` não faz narrowing pelo tipo do evento, usamos este typedef genérico que permite acesso
 * via bracket notation em `data`.
 *
 * @typedef {object} SdkEvent
 * @property {string} [kind]
 * @property {string} [type]
 * @property {Record<string, unknown>} [data]
 */

/**
 * Callbacks repassados pelo AlwaysAliveAgent para que o wirer possa notificá-lo sem acoplamento.
 *
 * @typedef {Object} SessionWirerCallbacks
 * @property {(event: string, payload?: any) => void} emit - Emite eventos no agente
 * @property {() => import('./always-alive.js').AgentStatusSnapshot} getStatusSnapshot - Retorna snapshot atual
 * @property {(path: string) => void} onCheckpointPath - Atualiza o último caminho de checkpoint
 * @property {(contextState: { tokens: number; tokenLimit: number; utilization: number } | null) => void} onContextState
 *   - Atualiza estado do contexto
 *
 * @property {(prInfo: {
 *     model?: string;
 *     cost?: number;
 *     quotaSnapshots?: Record<string, unknown>;
 *     ts: number;
 * }) => void} onPrInfo
 *   - Atualiza info de billing
 *
 * @property {() => boolean} isProcessing - true quando status === 'processing' (para filtrar deltas)
 * @property {() => boolean} dialogLoopActive - true quando o dialog loop está ativo (para filtrar deltas de
 *   waiting_for_input)
 */

/**
 * Registra todos os listeners de eventos da sessão SDK.
 *
 * @example
 *     const unsubs = wireSessionEvents(session, false, callbacks);
 *     // cleanup: unsubs.forEach(fn => fn());
 *
 * @param {CopilotSession} session - Sessão SDK ativa
 * @param {boolean} isResumed - Se a sessão foi retomada (afeta aviso de contexto pesado)
 * @param {SessionWirerCallbacks} callbacks - Callbacks para notificar o host
 * @returns {(() => void)[]} Lista de funções de unsubscribe a chamar no cleanup
 */
export function wireSessionEvents(session, isResumed, callbacks) {
    const unsubs = [
        ..._wireCompactionEvents(session, callbacks),
        ..._wireStreamingEvents(session, callbacks),
        ..._wireTokenBudgetEvents(session, isResumed, callbacks),
        ..._wireModeAndToolEvents(session, callbacks),
        _wireCatchAll(session, callbacks),
    ];
    return unsubs;
}

// ─── Sub-funções de wireSessionEvents ────────────────────────────────────────

/**
 * Registra eventos de compaction da sessão.
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireCompactionEvents(session, { emit, getStatusSnapshot, onCheckpointPath }) {
    return [
        session.on('session.compaction_start', (/** @type {SdkEvent} */ evt) => {
            log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
            emit('session.compaction_start', evt?.data ?? {});
        }),
        session.on('session.compaction_complete', (/** @type {SdkEvent} */ evt) => {
            const data = /** @type {{ success?: boolean; checkpointPath?: string }} */ (evt?.data ?? {});
            if (data['success'] === false) {
                log('ERROR', '[AlwaysAlive] Compaction falhou. Sessão pode estar instável.');
                if (data['checkpointPath']) {
                    log(
                        'WARN',
                        `[AlwaysAlive] Checkpoint disponível: ${data['checkpointPath']}. Para recovery manual, restaure esse arquivo e reinicie.`,
                    );
                }
            } else {
                log('INFO', '[AlwaysAlive] Compaction concluída.');
            }
            if (data['checkpointPath']) {
                onCheckpointPath(data['checkpointPath']);
            }
            emit('session.compaction_complete', data);
            const snap = getStatusSnapshot();
            emit('context:compacted', {
                sessionId: snap?.sessionId ?? null,
                ts: Date.now(),
                checkpoint: data['checkpointPath'] ?? null,
            });
        }),
    ];
}

/**
 * Registra eventos de streaming de tokens (reasoning + message delta).
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireStreamingEvents(session, { emit, isProcessing, dialogLoopActive }) {
    return [
        session.on('assistant.reasoning_delta', (/** @type {SdkEvent} */ evt) => {
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? '');
            if (chunk)
                emit('task.reasoning', {
                    chunk,
                    reasoningId: /** @type {string | null} */ (evt?.data?.['reasoningId'] ?? null),
                });
        }),
        // Streaming delta — filtra durante 'processing' e 'waiting_for_input' com dialog loop ativo
        // (G1-BUG-06: evita taskId:null no SSE durante dialog loop)
        session.on('assistant.message_delta', (/** @type {SdkEvent} */ evt) => {
            if (isProcessing() || dialogLoopActive()) return;
            const chunk = /** @type {string} */ (evt?.data?.['deltaContent'] ?? evt?.data?.['content'] ?? '');
            if (chunk) emit('task.delta', { taskId: null, chunk });
        }),
    ];
}

/**
 * Verifica uso de tokens e emite aviso quando próximo do limite.
 *
 * @param {{ currentTokens: number; tokenLimit: number }} usageData
 * @param {boolean} isResumed
 * @param {boolean} firstCheck
 * @param {(event: string, payload?: any) => void} emit
 * @returns {void}
 */
function _checkAndEmitTokenBudgetWarning({ currentTokens, tokenLimit }, isResumed, firstCheck, emit) {
    const ratio = Math.round((currentTokens / tokenLimit) * 100);
    if (firstCheck && isResumed && currentTokens / tokenLimit > 0.7) {
        log(
            'WARN',
            `[AlwaysAlive] Sessão retomada com contexto pesado (${ratio}% — ${currentTokens}/${tokenLimit}). Compaction automática pode ocorrer em breve.`,
        );
        emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio, reason: 'startup_heavy' });
    } else if (currentTokens / tokenLimit > 0.8) {
        log(
            'WARN',
            `[AlwaysAlive] Token budget em ${ratio}% (${currentTokens}/${tokenLimit}) — emitindo token_budget_warning`,
        );
        emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio });
    }
}

/**
 * Registra evento de token usage (atualiza contextState + aviso de budget).
 *
 * @param {CopilotSession} session
 * @param {boolean} isResumed
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireTokenBudgetEvents(session, isResumed, { emit, onContextState }) {
    let _firstUsageChecked = false;
    return [
        session.on('session.usage_info', (/** @type {SdkEvent} */ evt) => {
            const data = evt?.data ?? {};
            emit('session.usage', data);
            const currentTokens = /** @type {number} */ (data['currentTokens'] ?? 0);
            const tokenLimit = /** @type {number} */ (data['tokenLimit'] ?? 0);
            if (tokenLimit > 0) {
                onContextState({ tokens: currentTokens, tokenLimit, utilization: currentTokens / tokenLimit });
                _checkAndEmitTokenBudgetWarning({ currentTokens, tokenLimit }, isResumed, !_firstUsageChecked, emit);
                _firstUsageChecked = true;
            }
        }),
    ];
}

/**
 * Registra eventos de mudança de modo e execução de tools.
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {(() => void)[]}
 */
function _wireModeAndToolEvents(session, { emit, isProcessing }) {
    return [
        session.on('session.mode_changed', (/** @type {SdkEvent} */ evt) => {
            log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.['previousMode']} → ${evt?.data?.['newMode']}`);
            emit('session.mode_changed', evt?.data ?? {});
        }),
        // G2-BUG-14: tool events estavam no knownEvents mas nunca subscritos
        session.on('tool.execution_start', (/** @type {SdkEvent} */ evt) => {
            if (isProcessing()) return;
            emit('tool.execution.start', evt?.data ?? {});
        }),
        session.on('tool.execution_complete', (/** @type {SdkEvent} */ evt) => {
            if (isProcessing()) return;
            emit('tool.execution.complete', evt?.data ?? {});
        }),
    ];
}

/**
 * Catch-all para eventos não tratados explicitamente + billing (assistant.usage).
 *
 * @param {CopilotSession} session
 * @param {SessionWirerCallbacks} callbacks
 * @returns {() => void}
 */
function _wireCatchAll(session, { emit, onPrInfo }) {
    return session.on((/** @type {SdkEvent} */ evt) => {
        const kind = /** @type {string} */ (evt?.kind ?? evt?.type ?? 'unknown');
        if (kind === 'assistant.usage') {
            const data = evt?.data ?? {};
            const model = /** @type {string | undefined} */ (data['model']);
            const cost = /** @type {number | undefined} */ (data['cost']);
            const quotaSnapshots = /** @type {Record<string, unknown> | undefined} */ (data['quotaSnapshots']);
            const prInfo = {
                ts: Date.now(),
                ...(model !== undefined ? { model } : {}),
                ...(cost !== undefined ? { cost } : {}),
                ...(quotaSnapshots !== undefined ? { quotaSnapshots } : {}),
            };
            log('INFO', `[AlwaysAlive] PR consumido: model=${model ?? '?'}, cost=${cost ?? '?'}`);
            onPrInfo(prInfo);
            emit('pr.consumed', prInfo);
            writeStateAsync({
                pendingTurnConsumedPR: true,
                lastPrConsumedAt: Date.now(),
                lastPrModel: model ?? '',
                lastPrCost: cost ?? 0,
                lastQuotaSnapshots: quotaSnapshots ?? null,
            }).catch((/** @type {any} */ e) =>
                log('WARN', `[AlwaysAlive] writeState pendingTurnConsumedPR: ${e.message}`),
            );
            return;
        }
        if (!KNOWN_SDK_EVENTS.has(kind)) {
            log('DEBUG', `[AlwaysAlive] Evento SDK não tratado: kind=${kind}`);
        }
    });
}
