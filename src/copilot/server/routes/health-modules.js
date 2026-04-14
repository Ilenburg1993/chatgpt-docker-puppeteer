// @ts-check
/**
 * src/copilot/server/routes/health-modules.js — Agregador de health checks por domínio.
 *
 * Onda 5.9: cada módulo principal pode exportar `healthCheck()` via seu barrel. Este router agrega os resultados em GET
 * /health/modules.
 *
 * @module copilot/server/routes/health-modules
 */

import { Router } from 'express';
import { toError } from '../../core/error-handlers.js';

/**
 * @typedef {object} ModuleHealthResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {Record<string, unknown>} [details]
 */

/**
 * @typedef {object} ModuleHealthEntry
 * @property {string} name
 * @property {() => ModuleHealthResult | Promise<ModuleHealthResult>} check
 */

/** @type {ModuleHealthEntry[]} */
const registry = [];

/**
 * Registra um health check de módulo.
 *
 * @param {string} name - Nome do módulo (ex: 'agent', 'db').
 * @param {() => ModuleHealthResult | Promise<ModuleHealthResult>} check
 */
export function registerModuleHealth(name, check) {
    registry.push({ name, check });
}

/**
 * Cria router com GET /health/modules que agrega todos os health checks registrados.
 *
 * @returns {import('express').Router}
 */
export function createHealthModulesRouter() {
    const router = Router();

    router.get('/health/modules', async (_req, res) => {
        /** @type {Record<string, ModuleHealthResult>} */
        const results = {};
        let allOk = true;

        const checks = registry.map(async (entry) => {
            try {
                const result = await entry.check();
                results[entry.name] = result;
                if (!result.ok) allOk = false;
            } catch (e) {
                results[entry.name] = { ok: false, error: toError(e).message };
                allOk = false;
            }
        });

        await Promise.allSettled(checks);

        res.status(allOk ? 200 : 503).json({
            ok: allOk,
            modules: results,
            checkedAt: new Date().toISOString(),
        });
    });

    return router;
}
