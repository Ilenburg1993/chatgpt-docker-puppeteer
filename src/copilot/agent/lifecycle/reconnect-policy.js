// @ts-check
/**
 * src/copilot/agent/lifecycle/reconnect-policy.js
 *
 * Política de reconexão com backoff exponencial + jitter para o AlwaysAliveAgent.
 *
 * Função pura sem estado próprio — recebe callbacks do host (AlwaysAliveAgent) para as operações de side-effect (emit,
 * initSession, dialogLoop). Testável de forma independente.
 *
 * @module copilot/agent/lifecycle/reconnect-policy
 * @see EventBus
 */

import { isFatalError, toError } from '#copilot/core';
import { log, startSpan } from '#copilot/observability';

/**
 * @typedef {Object} ReconnectCallbacks
 * @property {(event: string, payload?: unknown) => void} emit - Emite eventos no host
 * @property {(
 *     client: import('#copilot/sdk/types').CopilotClient,
 * ) => Promise<{ session: import('@github/copilot-sdk').CopilotSession; isResumed: boolean }>} initSession
 *   - Reinicializa a sessão SDK
 *
 * @property {{ active: boolean; notifyReconnect: () => void }} dialogLoop - Handle do dialog loop
 * @property {(unsubs: (() => void)[]) => void} clearSessionEventUnsubs - Limpa os unsubscribers da sessão anterior
 * @property {(client: import('#copilot/sdk/types').CopilotClient) => void} [updateClient] - F42.5: atualiza referência
 *   do client no host após criar novo
 * @property {() => import('#copilot/sdk/types').CopilotClient} [createClient] - F42.5: factory para criar novo
 *   CopilotClient
 */

/**
 * Tenta reconectar ao SDK com backoff exponencial e jitter.
 *
 * Algoritmo de delay: `base * 2^(attempt-1) + jitter(0..base)`.
 *
 * @example
 *     const ok = await tryReconnect(err, client, 'running', callbacks);
 *
 * @param {Error} originalError - Erro original que desencadeou a reconexão
 * @param {import('#copilot/sdk/types').CopilotClient} client - Cliente SDK ativo (`CopilotClient`)
 * @param {string} currentStatus - Status atual do agente (retorna false se `'stopped'`)
 * @param {ReconnectCallbacks} callbacks - Callbacks de side-effect do host
 * @param {{
 *     maxAttempts?: number;
 *     baseDelayMs?: number;
 *     jitterFn?: () => number;
 *     sessionLog?: (msg: string) => Promise<void>;
 * }} [opts]
 *   - Opções de tuning
 *
 * @returns {Promise<boolean>} `true` se reconexão bem-sucedida, `false` se esgotado
 */
export async function tryReconnect(originalError, client, currentStatus, callbacks, opts = {}) {
    // G1-DX-03: jitterFn injetável para testes determinísticos (default: Math.random).
    const { maxAttempts = 5, baseDelayMs = 1_000, jitterFn = Math.random, sessionLog } = opts;
    const { emit, initSession, dialogLoop, clearSessionEventUnsubs, updateClient, createClient } = callbacks;

    // Só tenta reconectar se o cliente ainda existe e o agente não foi parado.
    if (!client || currentStatus === 'stopped') return false;

    log('WARN', `[AlwaysAlive] Erro de sessão detectado: ${originalError.message}. Iniciando reconexão...`);

    clearSessionEventUnsubs([]);

    // F68.3: Span OTEL para toda a operação de reconexão
    return startSpan(
        'copilot.reconnect',
        { sessionId: '', model: '', extra: { maxAttempts, error: originalError.message } },
        async () => {
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
                        } catch (stopErr) {
                            log(
                                'WARN',
                                `[AlwaysAlive] client.stop() antes de reconexão falhou (ignorado): ${toError(stopErr).message}`,
                            );
                        }
                    }

                    // F42.5 (BUG-SD-002 fix): criar um novo CopilotClient a cada tentativa de reconexão
                    // em vez de reutilizar o client parado — o SDK pode não suportar reutilização após stop().
                    let activeClient = client;
                    if (typeof createClient === 'function') {
                        activeClient = createClient();
                        if (typeof updateClient === 'function') {
                            updateClient(activeClient);
                        }
                    }

                    const { session, isResumed } = await initSession(activeClient);

                    // M-01 (PARTE-8): health check pós-reconexão — valida que o transport está funcional
                    // antes de declarar sucesso, evitando falso-positivo com pipe quebrado.
                    if (typeof activeClient.ping === 'function') {
                        try {
                            await activeClient.ping();
                        } catch (pingErr) {
                            log(
                                'WARN',
                                `[AlwaysAlive] ping() pós-reconexão falhou: ${toError(pingErr).message} — tentativa descartada`,
                            );
                            throw pingErr; // força retry na próxima iteração
                        }
                    }

                    log(
                        'INFO',
                        `[AlwaysAlive] Reconexão bem-sucedida na tentativa ${attempt}. SessionId: ${session.sessionId}`,
                    );
                    // M-05 (PARTE-8): registrar reconexão no timeline SDK para debug
                    await sessionLog?.(
                        `[reconnect-policy] Reconexão bem-sucedida na tentativa ${attempt}/${maxAttempts}`,
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
                } catch (reconnectError) {
                    log('WARN', `[AlwaysAlive] Tentativa ${attempt} falhou: ${toError(reconnectError).message}`);
                    // F149: se o erro é fatal (CircuitOpenError, SESSION_FATAL, etc.), não vale insistir
                    if (isFatalError(reconnectError)) {
                        log('ERROR', '[AlwaysAlive] Erro fatal detectado durante reconexão — abortando retry loop.');
                        break;
                    }
                }
            }

            log('ERROR', `[AlwaysAlive] Reconexão esgotada após ${maxAttempts} tentativas. Emitindo session.fatal.`);
            emit('session.fatal', { originalError: originalError.message, attempts: maxAttempts });
            return false;
        },
    );
}
