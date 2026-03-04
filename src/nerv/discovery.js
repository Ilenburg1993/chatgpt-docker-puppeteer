// @ts-check
import { log } from '#core/logger';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';

/**
 * Publica evento SERVER_READY para descoberta de serviço.
 *
 * **Side-effects:** Envia evento via NERV ou registra estado (modo legado).
 * **Semântica:** Sinaliza que servidor está pronto para aceitar conexões.
 * **Unidades:** Timeout em milissegundos.
 *
 * @param {any} [nerv] - Instância NERV para publicação (opcional)
 * @param {Record<string, any>} [payload={}] - Payload adicional do evento
 * @returns {Promise<object|null>} Envelope enviado ou null se falhar
 */
async function publishServerReady(nerv, payload = {}) {
    // Prefer NERV when available
    if (nerv) {
        try {
            return await HighLevelNERV.sendEvent(nerv, ActorRole.SERVER, ActionCode.SERVER_READY, payload);
        } catch (err) {
            const _e = /** @type {any} */ (err);
                        log('WARN', `[DISCOVERY] Falha ao publicar SERVER_READY via NERV: ${_e.message}`);
        }
    }

    // Final behavior: no file-based fallback. Discovery is NERV-first only.
    log('DEBUG', '[DISCOVERY] publishServerReady no-op (NERV ausente) — file fallback REMOVED');
    return null;
}

/**
 * Remove publicação de SERVER_READY (modo legado).
 *
 * **Side-effects:** Remove arquivo de estado legado se existir.
 * **Semântica:** Limpa sinal de prontidão do servidor.
 * **Unidades:** N/A
 *
 * @returns {boolean} True se arquivo foi removido, false caso contrário
 */
function unpublishServerReady() {
    log('DEBUG', '[DISCOVERY] unpublishServerReady no-op (file fallback REMOVED)');
    return false;
}

/**
 * Aguarda o primeiro evento SERVER_READY via NERV.
 *
 * **Side-effects:** Registra listener temporário no NERV, configura timeout.
 * **Semântica:** Promise que resolve quando servidor sinaliza prontidão.
 * **Unidades:** timeoutMs em milissegundos (padrão 10000).
 *
 * @param {any} nerv - Instância NERV com método onEvent
 * @param {Record<string, any>} [options={}] - Opções de configuração
 * @returns {Promise<object>} Payload do envelope SERVER_READY
 * @throws {Error} Se NERV não tem onEvent ou timeout expirar
 */
function waitForServerReady(nerv, { timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!nerv || typeof nerv.onEvent !== 'function') {
            return reject(new Error('NERV instance with onEvent required'));
        }

        /** @type {any} */
        let unsub = null;
        const timer = setTimeout(() => {
            if (typeof unsub === 'function') unsub();
            reject(new Error('Timeout waiting for SERVER_READY'));
        }, timeoutMs);

        try {
            unsub = nerv.onEvent((/** @type {any} */ envelope) => {
                try {
                    const action = envelope && envelope.type && envelope.type.action_code;
                    if (action === ActionCode.SERVER_READY) {
                        clearTimeout(timer);
                        if (typeof unsub === 'function') unsub();
                        resolve(envelope.payload || envelope);
                    }
                } catch (_) {
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
 * Escuta continuamente eventos SERVER_READY e chama handler.
 *
 * **Side-effects:** Registra listener permanente no NERV.
 * **Semântica:** Observador contínuo de eventos de prontidão do servidor.
 * **Unidades:** N/A
 *
 * @param {any} nerv - Instância NERV com método onEvent
 * @param {function(object): void} handler - Callback invocado para cada SERVER_READY
 * @returns {function(): void} Função de unsubscribe para remover listener
 * @throws {Error} Se NERV não tem onEvent ou handler não é função
 */
function listenForServerReady(nerv, handler) {
    if (!nerv || typeof nerv.onEvent !== 'function') {
        throw new Error('NERV instance with onEvent required');
    }
    if (typeof handler !== 'function') throw new Error('handler must be a function');

    const unsub = nerv.onEvent((/** @type {any} */ envelope) => {
        try {
            const action = envelope && envelope.type && envelope.type.action_code;
            if (action === ActionCode.SERVER_READY) {
                handler(envelope.payload || envelope);
            }
        } catch (_) {
            // ignore
        }
    });

    return unsub;
}

export { listenForServerReady, publishServerReady, unpublishServerReady, waitForServerReady };
