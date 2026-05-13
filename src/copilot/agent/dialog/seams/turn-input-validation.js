// @ts-check
/**
 * @module copilot/agent/dialog/seams/turn-input-validation
 * @file Validação e normalização de inputs de turno: eventos, erros, snapshots de protocolo.
 *
 *   Responsabilidade: garantir que dados de entrada/saída de turno sejam válidos e tipados antes de processamento
 *   principal.
 */

import { EMITTER_TURN_END } from '#copilot/events';
import { DialogProtocol } from '#copilot/dialog';

/**
 * @param {string} message
 * @returns {Error}
 */
export function createAbortError(message) {
    if (typeof DOMException === 'function') {
        return new DOMException(message, 'AbortError');
    }
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

/**
 * Normaliza evento de reply recebido do SDK.
 *
 * @param {unknown} evt
 * @returns {{ reply: string }}
 */
export function normalizeReplyEvent(evt) {
    if (!evt || typeof evt !== 'object') {
        return { reply: '' };
    }
    const reply = Reflect.get(evt, 'reply');
    return { reply: typeof reply === 'string' ? reply : '' };
}

/**
 * Normaliza evento de stop recebido do SDK.
 *
 * @param {unknown} evt
 * @returns {{ authorized?: boolean; reason?: string }}
 */
export function normalizeStopEvent(evt) {
    if (!evt || typeof evt !== 'object') {
        return {};
    }
    const authorized = Reflect.get(evt, 'authorized');
    const reason = Reflect.get(evt, 'reason');
    return {
        ...(typeof authorized === 'boolean' ? { authorized } : {}),
        ...(typeof reason === 'string' ? { reason } : {}),
    };
}

/**
 * Normaliza evento de message do assistente.
 *
 * @param {unknown} evt
 * @returns {{ content: string; ts: number | null }}
 */
export function normalizeAssistantMessageEvent(evt) {
    if (!evt || typeof evt !== 'object') {
        return { content: '', ts: null };
    }
    const content = Reflect.get(evt, 'content');
    const ts = Reflect.get(evt, 'ts');
    return {
        content: typeof content === 'string' ? content : '',
        ts: typeof ts === 'number' ? ts : null,
    };
}

/**
 * Normaliza candidato de reply do assistente usando protocol semantics.
 *
 * Regra: se é classificado como 'reply', extrai e valida; se é 'ready' ou 'stopped', descarta; caso contrário, passa
 * como-é.
 *
 * @param {string} content
 * @returns {string | null}
 */
export function normalizeAssistantReplyCandidate(content) {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const kind = DialogProtocol.classify(trimmed);
    if (kind === 'reply') {
        return DialogProtocol.extractReply(trimmed) || null;
    }
    if (kind === 'ready' || kind === 'stopped') {
        return null;
    }
    return trimmed;
}

/**
 * Lê snapshot de pergunta pendente protocolada do host para validação de estado.
 *
 * @param {import('../../types.js').DialogTurnHost} host
 * @returns {{ kind: 'reply' | 'ready' | 'stopped'; question: string; reply?: string } | null}
 */
export function readPendingProtocolSnapshot(host) {
    if (typeof host.getPendingQuestionSnapshot !== 'function') {
        return null;
    }
    const pending = host.getPendingQuestionSnapshot();
    if (!pending?.protocolControlled || typeof pending.question !== 'string') {
        return null;
    }
    if (pending.kind === 'reply') {
        const reply = DialogProtocol.extractReply(pending.question);
        if (reply) {
            return { kind: 'reply', question: pending.question, reply };
        }
    }
    if (pending.kind === 'ready' || pending.kind === 'stopped') {
        return { kind: pending.kind, question: pending.question };
    }
    return null;
}

/**
 * Finaliza e emite evento de fim de turno com métricas.
 *
 * @param {number} turnStart
 * @param {string} reply
 * @param {{
 *     emit: (event: string, payload: object) => void;
 *     metrics: { recordDialogTurn: (durationMs: number, success: boolean) => void };
 * }} input
 * @returns {void}
 */
export function finalizeTurnReply(turnStart, reply, input) {
    const durationMs = Date.now() - turnStart;
    input.emit(EMITTER_TURN_END, { reply: reply.slice(0, 120), durationMs });
    input.metrics.recordDialogTurn(durationMs, true);
}
