// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do repositório — exportada para testes que precisam de caminhos absolutos. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Helper utilities for kernel integration tests TODO: Implement actual test helpers
 *
 * @returns {Record<string, unknown>}
 */
export function createMockKernel() {
    return {};
}

/**
 * Função exportada: sleep.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escreve uma tarefa no arquivo de fila para testes.
 *
 * @param {Record<string, unknown>} _data
 * @returns {void}
 */
export function writeTask(_data) {
    // stub — implementação real requer integração com infra/queue
}

/**
 * Lê uma tarefa do arquivo de fila para testes.
 *
 * @param {string} _taskId
 * @returns {any}
 */
export function readTask(_taskId) {
    return null;
}

/**
 * Inicia o agente para testes de integração.
 *
 * @param {number} [_timeoutMs]
 * @returns {{ ready: Promise<void>; proc: any }}
 */
export function startAgent(_timeoutMs) {
    return { ready: Promise.resolve(), proc: null };
}

/**
 * Para o agente após testes de integração.
 *
 * @param {any} [_proc]
 * @returns {void}
 */
export function stopAgent(_proc) {
    // stub
}

/**
 * Aguarda até que a condição retorne verdadeiro ou até o timeout.
 *
 * @param {() => boolean | null | undefined | Promise<boolean | null | undefined>} _condition
 * @param {number} [_timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function waitForCondition(_condition, _timeoutMs = 5000) {
    return false;
}

/**
 * Remove o arquivo de lock de execução para testes.
 *
 * @returns {void}
 */
export function removeRunLock() {
    // stub
}

/**
 * Lê as últimas N linhas do log global para testes.
 *
 * @param {number} [_lines]
 * @returns {string[]}
 */
export function readLatestGlobalLogTail(_lines = 10) {
    return [];
}
