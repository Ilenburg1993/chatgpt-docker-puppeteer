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

import { log } from '#core/logger';
import { writeStateAsync } from './state-io.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
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
 */

/**
 * Registra todos os listeners de eventos da sessão SDK.
 *
 * @param {CopilotSession} session - Sessão SDK ativa
 * @param {boolean} isResumed - Se a sessão foi retomada (afeta aviso de contexto pesado)
 * @param {SessionWirerCallbacks} callbacks - Callbacks para notificar o host
 * @returns {(() => void)[]} Lista de funções de unsubscribe a chamar no cleanup
 */
export function wireSessionEvents(session, isResumed, callbacks) {
    const { emit, getStatusSnapshot, onCheckpointPath, onContextState, onPrInfo, isProcessing } = callbacks;

    /** @type {(() => void)[]} */
    const unsubs = [];

    // Compaction start
    unsubs.push(
        session.on('session.compaction_start', (/** @type {any} */ evt) => {
            log('INFO', '[AlwaysAlive] Compaction iniciada (sessão infinita).');
            emit('session.compaction_start', evt?.data ?? {});
        }),
    );

    // Compaction complete — detecta falha, captura checkpointPath para recovery.
    unsubs.push(
        session.on('session.compaction_complete', (/** @type {any} */ evt) => {
            const data = evt?.data ?? {};
            if (data.success === false) {
                log('ERROR', '[AlwaysAlive] Compaction falhou. Sessão pode estar instável.');
                if (data.checkpointPath) {
                    log(
                        'WARN',
                        `[AlwaysAlive] Checkpoint disponível: ${data.checkpointPath}. Para recovery manual, restaure esse arquivo e reinicie.`,
                    );
                }
            } else {
                log('INFO', '[AlwaysAlive] Compaction concluída.');
            }
            if (data.checkpointPath) {
                onCheckpointPath(data.checkpointPath);
            }
            emit('session.compaction_complete', data);
            const snap = getStatusSnapshot();
            emit('context:compacted', {
                sessionId: snap?.sessionId ?? null,
                ts: Date.now(),
                checkpoint: data.checkpointPath ?? null,
            });
        }),
    );

    // Reasoning tokens (o3/o4-mini extended thinking)
    unsubs.push(
        session.on('assistant.reasoning_delta', (/** @type {any} */ evt) => {
            const chunk = evt?.data?.deltaContent ?? '';
            if (chunk) emit('task.reasoning', { chunk, reasoningId: evt?.data?.reasoningId ?? null });
        }),
    );

    // Streaming delta apenas quando dialog loop está ativo (status !== 'processing').
    unsubs.push(
        session.on('assistant.message_delta', (/** @type {any} */ evt) => {
            if (isProcessing()) return;
            const chunk = evt?.data?.deltaContent ?? evt?.data?.content ?? '';
            if (chunk) emit('task.delta', { taskId: null, chunk });
        }),
    );

    // Token usage e janela de contexto — atualiza contextState e emite avisos.
    let _firstUsageChecked = false;
    unsubs.push(
        session.on('session.usage_info', (/** @type {any} */ evt) => {
            const data = evt?.data ?? {};
            emit('session.usage', data);
            const { currentTokens, tokenLimit } = data;
            if (tokenLimit > 0) {
                const ratio = Math.round((currentTokens / tokenLimit) * 100);
                onContextState({
                    tokens: currentTokens,
                    tokenLimit,
                    utilization: currentTokens / tokenLimit,
                });
                if (!_firstUsageChecked && isResumed && currentTokens / tokenLimit > 0.7) {
                    log(
                        'WARN',
                        `[AlwaysAlive] Sessão retomada com contexto pesado (${ratio}% — ${currentTokens}/${tokenLimit}). Compaction automática pode ocorrer em breve.`,
                    );
                    emit('session.token_budget_warning', {
                        currentTokens,
                        tokenLimit,
                        ratio,
                        reason: 'startup_heavy',
                    });
                }
                _firstUsageChecked = true;
                if (currentTokens / tokenLimit > 0.8) {
                    log(
                        'WARN',
                        `[AlwaysAlive] Token budget em ${ratio}% (${currentTokens}/${tokenLimit}) — emitindo token_budget_warning`,
                    );
                    emit('session.token_budget_warning', { currentTokens, tokenLimit, ratio });
                }
            }
        }),
    );

    // Mudança de modo (plan ↔ act ↔ interactive)
    unsubs.push(
        session.on('session.mode_changed', (/** @type {any} */ evt) => {
            log('INFO', `[AlwaysAlive] Modo mudou: ${evt?.data?.previousMode} → ${evt?.data?.newMode}`);
            emit('session.mode_changed', evt?.data ?? {});
        }),
    );

    // Catch-all para eventos do SDK não tratados explicitamente + billing (assistant.usage).
    /** @type {Set<string>} */
    const knownEvents = new Set([
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
    unsubs.push(
        session.on((/** @type {any} */ evt) => {
            const kind = evt?.kind ?? evt?.type ?? 'unknown';
            if (kind === 'assistant.usage') {
                const data = evt?.data ?? {};
                const { model, cost, quotaSnapshots } = data;
                log('INFO', `[AlwaysAlive] PR consumido: model=${model ?? '?'}, cost=${cost ?? '?'}`);
                onPrInfo({ model, cost, quotaSnapshots, ts: Date.now() });
                emit('pr.consumed', { model, cost, quotaSnapshots, ts: Date.now() });
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
            if (!knownEvents.has(kind)) {
                log('DEBUG', `[AlwaysAlive] Evento SDK não tratado: kind=${kind}`);
            }
        }),
    );

    return unsubs;
}
