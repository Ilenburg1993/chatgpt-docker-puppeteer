// @ts-check
/**
 * Helpers de ambiente compartilhados pela infra.
 *
 * @module copilot/infra/shared/env
 */

/**
 * Lê inteiro positivo de `process.env`, retornando fallback para valores ausentes ou inválidos.
 *
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
export function readEnvPositiveInt(key, fallback) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
