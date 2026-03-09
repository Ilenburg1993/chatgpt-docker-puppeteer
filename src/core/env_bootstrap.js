// @ts-check - Type checking rigoroso habilitado (arquivo core)
import dotenv from 'dotenv';
import fs from 'node:fs';

/**
 * Environment bootstrap (idempotent):
 *
 * - Loads .env first (defaults only)
 * - Then overlays .env.${NODE_ENV}, .env.local and .env.${NODE_ENV}.local
 * - Later files win when the same key is defined multiple times
 */
const BOOTSTRAP_FLAG = '__MAESTRO_ENV_BOOTSTRAPPED__';

/**
 * Executa bootstrap idempotente de variáveis de ambiente (`.env*`) e higieniza flags de cor.
 *
 * @returns {boolean} `true` quando bootstrap ocorre nesta chamada; `false` quando já estava aplicado.
 */
function ensureEnvBootstrap() {
    if (/** @type {Record<string, unknown>} */ (globalThis)[BOOTSTRAP_FLAG]) {
        return false;
    }

    const nodeEnv = String(process.env.NODE_ENV || '').trim();
    /** @type {{ path: string; override?: boolean }[]} */
    const loadOrder = [
        { path: '.env' },
        ...(nodeEnv ? [{ path: `.env.${nodeEnv}`, override: true }] : []),
        { path: '.env.local', override: true },
        ...(nodeEnv ? [{ path: `.env.${nodeEnv}.local`, override: true }] : []),
    ];

    for (const entry of loadOrder) {
        if (!fs.existsSync(entry.path)) {
            continue;
        }
        dotenv.config({
            path: entry.path,
            override: Boolean(entry.override),
            quiet: true,
        });
    }

    // Evita warning recorrente do Node quando NO_COLOR e FORCE_COLOR coexistem.
    if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
        delete process.env.NO_COLOR;
    }

    /** @type {Record<string, unknown>} */ (globalThis)[BOOTSTRAP_FLAG] = true;
    return true;
}

ensureEnvBootstrap();

export { BOOTSTRAP_FLAG, ensureEnvBootstrap };
