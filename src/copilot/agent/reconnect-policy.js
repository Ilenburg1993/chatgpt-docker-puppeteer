// @ts-check
/**
 * src/copilot/agent/reconnect-policy.js
 *
 * Política de reconexão com backoff exponencial + jitter para o AlwaysAliveAgent.
 *
 * Função pura sem estado próprio — recebe callbacks do host (AlwaysAliveAgent) para as operações de side-effect (emit,
 * initSession, dialogLoop). Testável de forma independente.
 *
 * @module copilot/agent/reconnect-policy
 */

import { log } from '#core/logger';

/**
 * @typedef {Object} ReconnectCallbacks
 * @property {(event: string, payload?: any) => void} emit - Emite eventos no host
 * @property {(client: any) => Promise<{ session: any; isResumed: boolean }>} initSession - Reinicializa a sessão SDK
 * @property {{ active: boolean; notifyReconnect: () => void }} dialogLoop - Handle do dialog loop
 * @property {(unsubs: (() => void)[]) => void} clearSessionEventUnsubs - Limpa os unsubscribers da sessão anterior
 */

/**
 * Tenta reconectar ao SDK com backoff exponencial e jitter.
 *
 * Algoritmo de delay: `base * 2^(attempt-1) + jitter(0..base)`.
 *
 * @param {Error} originalError - Erro original que desencadeou a reconexão
 * @param {any} client - Cliente SDK ativo (`CopilotClient`)
 * @param {string} currentStatus - Status atual do agente (retorna false se `'stopped'`)
 * @param {ReconnectCallbacks} callbacks - Callbacks de side-effect do host
 * @param {{ maxAttempts?: number; baseDelayMs?: number; jitterFn?: () => number }} [opts] - Opções de tuning
 * @returns {Promise<boolean>} `true` se reconexão bem-sucedida, `false` se esgotado
 */
export async function tryReconnect(originalError, client, currentStatus, callbacks, opts = {}) {
    // G1-DX-03: jitterFn injetável para testes determinísticos (default: Math.random).
    const { maxAttempts = 5, baseDelayMs = 1_000, jitterFn = Math.random } = opts;
    const { emit, initSession, dialogLoop, clearSessionEventUnsubs } = callbacks;

    // Só tenta reconectar se o cliente ainda existe e o agente não foi parado.
    if (!client || currentStatus === 'stopped') return false;

    log('WARN', `[AlwaysAlive] Erro de sessão detectado: ${originalError.message}. Iniciando reconexão...`);

    clearSessionEventUnsubs([]);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Backoff exponencial com jitter: delay = base * 2^(attempt-1) + jitter(0..base)
        // G2-ARCH-09: cap no máximo de 30s para evitar esperas excessivas
        const raw = baseDelayMs * Math.pow(2, attempt - 1) + jitterFn() * baseDelayMs;
        const delay = Math.min(raw, 30_000);
        log('INFO', `[AlwaysAlive] Reconexão tentativa ${attempt}/${maxAttempts} em ${Math.round(delay)}ms...`);
        emit('status', `reconnecting:${attempt}/${maxAttempts}`);

        await new Promise((r) => setTimeout(r, delay));

        try {
            // G2-BUG-07: parar o client antes de reinicializar para evitar listeners duplicados
            // e recursos pendurados da sessão anterior.
            if (typeof client.stop === 'function') {
                try {
                    await client.stop();
                } catch (/** @type {any} */ stopErr) {
                    log('WARN', `[AlwaysAlive] client.stop() antes de reconexão falhou (ignorado): ${stopErr.message}`);
                }
            }
            const { session, isResumed } = await initSession(client);
            log(
                'INFO',
                `[AlwaysAlive] Reconexão bem-sucedida na tentativa ${attempt}. SessionId: ${session.sessionId}`,
            );
            emit('ready', { sessionId: session.sessionId, isResumed, reconnected: true });

            if (dialogLoop.active) {
                log(
                    'INFO',
                    '[AlwaysAlive] Reconexão com dialog loop ativo — emitindo dialog.stopped para restart automático.',
                );
                dialogLoop.notifyReconnect();
                emit('dialog.stopped', { reason: 'reconnect_restart', authorized: false });
            } else {
                log(
                    'INFO',
                    '[AlwaysAlive] Reconexão com dialog loop inativo. Aguardando terminal/dialog.js retomar via ensureDialogLoop.',
                );
            }
            return true;
        } catch (/** @type {any} */ reconnectError) {
            log('WARN', `[AlwaysAlive] Tentativa ${attempt} falhou: ${reconnectError.message}`);
        }
    }

    log('ERROR', `[AlwaysAlive] Reconexão esgotada após ${maxAttempts} tentativas. Emitindo session.fatal.`);
    emit('session.fatal', { originalError: originalError.message, attempts: maxAttempts });
    return false;
}
