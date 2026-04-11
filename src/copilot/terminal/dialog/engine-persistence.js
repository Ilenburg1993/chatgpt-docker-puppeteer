// @ts-check
/**
 * src/copilot/terminal/dialog/engine-persistence.js
 *
 * Persistência de turnos do dialog engine no ConversationHub (writeTurn + notificações pendentes). Extraído de
 * engine.js (F102) para reduzir complexidade.
 *
 * @module copilot/terminal/dialog/engine-persistence
 */

import { emitNerv } from '#copilot/bridges';
import { conversationHub } from '#copilot/services';
import { log } from '#copilot/observability';

/** @type {{ hubSessionId: string; userTurn: object; llmBTurn: object }[]} */
const _pendingNotifications = [];

const MAX_PENDING_NOTIFICATIONS = 50;

let _persistenceFailureCount = 0;

/**
 * Drena notificações pendentes acumuladas durante indisponibilidade do Hub.
 *
 * @returns {number} Quantidade de notificações drenadas com sucesso
 */
export function drainPendingNotifications() {
    if (!conversationHub.isReady || _pendingNotifications.length === 0) return 0;
    let drained = 0;
    while (_pendingNotifications.length > 0) {
        const n = /** @type {{ hubSessionId: string; userTurn: any; llmBTurn: any }} */ (_pendingNotifications.shift());
        try {
            conversationHub.notifyTerminalTurn(n.hubSessionId, n.userTurn, n.llmBTurn);
            drained++;
        } catch (/** @type {any} */ err) {
            log('WARN', `[dialog] drainPendingNotifications falhou: ${err.message}`);
            _pendingNotifications.unshift(n);
            break;
        }
    }
    if (drained) log('INFO', `[dialog] ${drained} notificações pendentes drenadas com sucesso`);
    return drained;
}

/**
 * Retorna a contagem de falhas de persistência desde o início da sessão.
 *
 * @returns {number}
 */
export function getPersistenceFailureCount() {
    return _persistenceFailureCount;
}

/**
 * Persiste um turno (mensagem + resposta) no ConversationHub e emite notificações.
 *
 * @param {string} hubSessionId
 * @param {string} message
 * @param {string} reply
 * @param {string} actor
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
export async function persistTurnToHub(hubSessionId, message, reply, actor, durationMs) {
    /** @type {'user' | 'llm_a'} */
    const senderRole = actor === 'llm-a' ? 'llm_a' : 'user';
    const msgTurnId = await conversationHub.store.writeTurn(hubSessionId, {
        role: senderRole,
        content: message,
    });
    const replyTurnId = await conversationHub.store.writeTurn(hubSessionId, {
        role: 'llm_b',
        content: reply,
        durationMs,
    });

    if (conversationHub.isReady) {
        try {
            const msgTurn = conversationHub.store.getTurn(msgTurnId);
            const replyTurn = conversationHub.store.getTurn(replyTurnId);
            conversationHub.notifyTerminalTurn(
                hubSessionId,
                {
                    turnId: msgTurnId,
                    role: senderRole,
                    content: message,
                    turnNumber: msgTurn?.turn_number ?? 0,
                },
                {
                    turnId: replyTurnId,
                    content: reply,
                    turnNumber: replyTurn?.turn_number ?? 0,
                    durationMs,
                },
            );
        } catch (/** @type {any} */ hubErr) {
            _persistenceFailureCount++;
            log('DEBUG', `[dialog] notifyTerminalTurn falhou (enfileirado): ${hubErr.message}`);
            _enqueuePendingNotification(hubSessionId, msgTurnId, replyTurnId, senderRole, message, reply, durationMs);
        }
    } else {
        _enqueuePendingNotification(hubSessionId, msgTurnId, replyTurnId, senderRole, message, reply, durationMs);
    }

    emitNerv('copilot:turn:sent', {
        hubSessionId,
        turnId: msgTurnId,
        role: senderRole,
        contentLen: message.length,
    });
    emitNerv('copilot:turn:complete', {
        hubSessionId,
        turnId: replyTurnId,
        role: 'llm_b',
        contentLen: reply.length,
        durationMs,
    });
}

/**
 * @param {string} hubSessionId
 * @param {number} msgTurnId
 * @param {number} replyTurnId
 * @param {'user' | 'llm_a'} senderRole
 * @param {string} message
 * @param {string} reply
 * @param {number} durationMs
 */
function _enqueuePendingNotification(hubSessionId, msgTurnId, replyTurnId, senderRole, message, reply, durationMs) {
    if (_pendingNotifications.length >= MAX_PENDING_NOTIFICATIONS) return;
    const msgTurn = conversationHub.store.getTurn(msgTurnId);
    const replyTurn = conversationHub.store.getTurn(replyTurnId);
    _pendingNotifications.push({
        hubSessionId,
        userTurn: {
            turnId: msgTurnId,
            role: senderRole,
            content: message,
            turnNumber: msgTurn?.turn_number ?? 0,
        },
        llmBTurn: {
            turnId: replyTurnId,
            content: reply,
            turnNumber: replyTurn?.turn_number ?? 0,
            durationMs,
        },
    });
}
