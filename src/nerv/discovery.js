import { log } from '#core/logger';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';

/**
 * Publica SERVER_READY.
 * - Tenta usar NERV quando `nerv` é passado.
 * - Caso contrário, se `ENABLE_STATE_FILE=true`, grava arquivo de estado legado (compat).
 */
function publishServerReady(nerv, payload = {}) {
    // Prefer NERV when available
    if (nerv) {
        try {
            return HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
        } catch (err) {
            log('WARN', `[DISCOVERY] Falha ao publicar SERVER_READY via NERV: ${err.message}`);
        }
    }

    // Final behavior: no file-based fallback. Discovery is NERV-first only.
    log('DEBUG', '[DISCOVERY] publishServerReady no-op (NERV ausente) — file fallback REMOVED');
    return null;
}

/**
 * Remove publicação legacy (apenas limpa arquivo se ENABLE_STATE_FILE=true).
 */
function unpublishServerReady() {
    log('DEBUG', '[DISCOVERY] unpublishServerReady no-op (file fallback REMOVED)');
    return false;
}

/**
 * Aguarda o primeiro evento SERVER_READY via NERV.
 * Retorna uma Promise que resolve com o payload do envelope.
 */
function waitForServerReady(nerv, { timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!nerv || typeof nerv.onEvent !== 'function') {
            return reject(new Error('NERV instance with onEvent required'));
        }

        let unsub = null;
        const timer = setTimeout(() => {
            if (typeof unsub === 'function') unsub();
            reject(new Error('Timeout waiting for SERVER_READY'));
        }, timeoutMs);

        try {
            unsub = nerv.onEvent(envelope => {
                try {
                    const action = envelope && envelope.type && envelope.type.action_code;
                    if (action === ActionCode.SERVER_READY) {
                        clearTimeout(timer);
                        if (typeof unsub === 'function') unsub();
                        resolve(envelope.payload || envelope);
                    }
                } catch (err) {
                    // ignore malformed envelopes
                }
            });
        } catch (err) {
            clearTimeout(timer);
            reject(err);
        }
    });
}

/**
 * Escuta continuamente eventos SERVER_READY e chama handler(envelope.payload).
 * Retorna uma função de unsubscribe.
 */
function listenForServerReady(nerv, handler) {
    if (!nerv || typeof nerv.onEvent !== 'function') {
        throw new Error('NERV instance with onEvent required');
    }
    if (typeof handler !== 'function') throw new Error('handler must be a function');

    const unsub = nerv.onEvent(envelope => {
        try {
            const action = envelope && envelope.type && envelope.type.action_code;
            if (action === ActionCode.SERVER_READY) {
                handler(envelope.payload || envelope);
            }
        } catch (err) {
            // ignore
        }
    });

    return unsub;
}

export { publishServerReady, unpublishServerReady, waitForServerReady, listenForServerReady };
