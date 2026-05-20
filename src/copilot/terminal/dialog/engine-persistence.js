// @ts-check
/**
 * src/copilot/terminal/dialog/engine-persistence.js
 *
 * Persistência de turnos do dialog engine no ConversationHub (writeTurn + notificações pendentes). Extraído de
 * engine.js (F102) para reduzir complexidade.
 *
 * @module copilot/terminal/dialog/engine-persistence
 * @see EventBus
 */

import { emitNerv } from '#copilot/bridges';
import { toError } from '#copilot/core';
import { log } from '#copilot/observability';
import {
    isTerminalHubReady,
    notifyTerminalHubTurn,
    readTerminalHubStore,
    readTerminalHubTurn,
} from '../frontend/gateways/index.js';

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
    if (!isTerminalHubReady() || _pendingNotifications.length === 0) return 0;
    let drained = 0;
    while (_pendingNotifications.length > 0) {
        const n = /**
         * @type {{
         *     hubSessionId: string;
         *     userTurn: { turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number; source?: string };
         *     llmBTurn: { turnId: number; content: string; turnNumber: number; durationMs: number };
         * }}
         */ (_pendingNotifications.shift());
        try {
            notifyTerminalHubTurn(n.hubSessionId, n.userTurn, n.llmBTurn);
            drained++;
        } catch (err) {
            log('WARN', `[dialog] drainPendingNotifications falhou: ${toError(err).message}`);
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
 * @param {Record<string, unknown> | null} [replyMetadata]
 * @returns {Promise<void>}
 */
export async function persistTurnToHub(hubSessionId, message, reply, actor, durationMs, replyMetadata = null) {
    const store = readTerminalHubStore();
    /** @type {'user' | 'llm_a'} */
    const senderRole = actor === 'llm-a' ? 'llm_a' : 'user';
    const msgTurnId = await store.writeTurn(hubSessionId, {
        role: senderRole,
        content: message,
    });
    const replyTurnId = await store.writeTurn(hubSessionId, {
        role: 'llm_b',
        content: reply,
        durationMs,
        ...(replyMetadata ? { metadata: replyMetadata } : {}),
    });

    if (isTerminalHubReady()) {
        try {
            const msgTurn = readTerminalHubTurn(msgTurnId);
            const replyTurn = readTerminalHubTurn(replyTurnId);
            const msgTurnNumber = typeof msgTurn?.['turn_number'] === 'number' ? msgTurn['turn_number'] : 0;
            const replyTurnNumber = typeof replyTurn?.['turn_number'] === 'number' ? replyTurn['turn_number'] : 0;
            notifyTerminalHubTurn(
                hubSessionId,
                {
                    turnId: msgTurnId,
                    role: senderRole,
                    content: message,
                    turnNumber: msgTurnNumber,
                },
                {
                    turnId: replyTurnId,
                    content: reply,
                    turnNumber: replyTurnNumber,
                    durationMs,
                },
            );
        } catch (hubErr) {
            _persistenceFailureCount++;
            log('DEBUG', `[dialog] notifyTerminalTurn falhou (enfileirado): ${toError(hubErr).message}`);
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
    const msgTurn = readTerminalHubTurn(msgTurnId);
    const replyTurn = readTerminalHubTurn(replyTurnId);
    const msgTurnNumber = typeof msgTurn?.['turn_number'] === 'number' ? msgTurn['turn_number'] : 0;
    const replyTurnNumber = typeof replyTurn?.['turn_number'] === 'number' ? replyTurn['turn_number'] : 0;
    _pendingNotifications.push({
        hubSessionId,
        userTurn: {
            turnId: msgTurnId,
            role: senderRole,
            content: message,
            turnNumber: msgTurnNumber,
        },
        llmBTurn: {
            turnId: replyTurnId,
            content: reply,
            turnNumber: replyTurnNumber,
            durationMs,
        },
    });
}
