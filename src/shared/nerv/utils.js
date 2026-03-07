// @ts-check - Type checking rigoroso habilitado (arquivo core)
/* ==========================================================================
   src/shared/nerv/utils.js
   NERV Utilities
   Audit Level: 900 — Sovereign NERV Utils

   Responsabilidade:
   - Utilitários para validação e manipulação de instâncias NERV
   - Funções helper para verificação de estado do NERV
   - Validações de segurança antes de operações NERV

   Princípios:
   - Validação defensiva antes de qualquer operação NERV
   - Fail-fast se NERV estiver em estado inválido
   - Logging estruturado para debugging
========================================================================== */

import { log } from '#core/logger';

/**
 * @typedef {object} NERVLike
 * @property {(event: string, handler: (payload: unknown) => void) => void} onEvent
 * @property {(actor: string, action: string, payload?: Record<string, unknown>) => unknown|Promise<unknown>} sendEvent
 * @property {object} [state]
 */

/**
 * @typedef {object} NERVEventPayload
 */

/**
 * @typedef {object} IsValidNERVNerv
 * @property {*} _ Propriedades definidas em runtime.
 */
/**
 * Valida se uma instância NERV é válida e segura para uso
 * @param {IsValidNERVNerv} [nerv] - Instância do NERV a validar
 * @returns {boolean} true se o NERV é válido, false caso contrário
 */
export function isValidNERV(/** @type {any} */ nerv) {
    try {
        // Verificações básicas de tipo e estrutura
        if (!nerv || typeof nerv !== 'object') {
            log('DEBUG', '[NERV_UTILS] NERV instance is null, undefined, or not an object');
            return false;
        }

        // Verificações de métodos obrigatórios
        const requiredMethods = ['onEvent', 'sendEvent'];
        for (const method of requiredMethods) {
            if (typeof nerv[method] !== 'function') {
                log('WARN', `[NERV_UTILS] NERV instance missing required method: ${method}`);
                return false;
            }
        }

        // Verificação adicional de propriedades de estado (se existirem)
        if (nerv.state && typeof nerv.state !== 'object') {
            log('WARN', '[NERV_UTILS] NERV state property exists but is not an object');
            return false;
        }

        log('DEBUG', '[NERV_UTILS] NERV instance validation passed');
        return true;
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('ERROR', `[NERV_UTILS] Error validating NERV instance: ${_ce.message}`);
        return false;
    }
}

/**
 * Executa uma operação NERV com validação prévia
 * @template T
 * @param {NERVLike} nerv - Instância do NERV
 * @param {string} operation - Nome da operação para logging
 * @param {() => T|Promise<T>} operationFn - Função que executa a operação
 * @returns {Promise<T>} Resultado da operação ou throws se NERV inválido
 */
export async function safeNERVOperation(
    /** @type {any} */ nerv,
    /** @type {any} */ operation,
    /** @type {any} */ operationFn
) {
    if (!isValidNERV(nerv)) {
        const error = new Error(`[NERV_UTILS] Cannot execute ${operation}: NERV instance is invalid`);
        log('ERROR', error.message);
        throw error;
    }

    try {
        log('DEBUG', `[NERV_UTILS] Executing safe NERV operation: ${operation}`);
        return await operationFn();
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        log('ERROR', `[NERV_UTILS] Error in NERV operation ${operation}: ${_ce.message}`);
        throw _ce;
    }
}

/**
 * Wrapper para nerv.onEvent com validação
 * @param {NERVLike} nerv - Instância do NERV
 * @param {string} event - Nome do evento
 * @param {(payload: unknown) => void} handler - Handler do evento
 * @returns {Promise<boolean>} true se registrado com sucesso
 */
export async function safeOnEvent(/** @type {any} */ nerv, /** @type {any} */ event, /** @type {any} */ handler) {
    return safeNERVOperation(nerv, `onEvent(${event})`, () => {
        nerv.onEvent(event, handler);
        return true;
    });
}

/**
 * Wrapper para nerv.sendEvent com validação
 * @param {NERVLike} nerv - Instância do NERV
 * @param {string} actor - Ator que envia o evento
 * @param {string} action - Ação do evento
 * @param {NERVEventPayload} [payload={}] - Payload do evento
 * @returns {Promise<unknown>} Resultado do sendEvent
 */
export async function safeSendEvent(
    /** @type {any} */ nerv,
    /** @type {any} */ actor,
    /** @type {any} */ action,
    /** @type {any} */ payload = {}
) {
    return safeNERVOperation(nerv, `sendEvent(${actor}, ${action})`, () => {
        return nerv.sendEvent(actor, action, payload);
    });
}
