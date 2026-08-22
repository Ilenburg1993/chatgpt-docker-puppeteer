// @ts-check
/**
 * Environment lookup helpers for infra configuration.
 *
 * Value coercion itself lives in `config-values.js` so option objects and environment-backed settings share semantics.
 *
 * @module copilot/infra/platform/env
 */

import { booleanValueOr } from './config-values.js';

/**
 * Read a boolean from an arbitrary ProcessEnv using canonical true/false tokens.
 *
 * @param {string} key
 * @param {boolean} fallback
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @returns {boolean}
 */
export function readEnvBoolean(key, fallback, env) {
    return booleanValueOr(env[key], fallback);
}

/**
 * Lê inteiro positivo de um snapshot de ambiente explícito, retornando fallback para valores ausentes ou inválidos.
 *
 * @param {string} key
 * @param {number} fallback
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @returns {number}
 */
export function readEnvPositiveInt(key, fallback, env) {
    const raw = env[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Lê inteiro não negativo de um snapshot de ambiente explícito, aceitando zero como override explícito.
 *
 * @param {string} key
 * @param {number} fallback
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @returns {number}
 */
export function readEnvNonNegativeInt(key, fallback, env) {
    const raw = env[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/**
 * Lê inteiro maior ou igual a um limite mínimo, retornando fallback para valores ausentes ou inválidos.
 *
 * @param {string} key
 * @param {number} fallback
 * @param {number} minimum
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} env
 * @returns {number}
 */
export function readEnvIntAtLeast(key, fallback, minimum, env) {
    const raw = env[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}
