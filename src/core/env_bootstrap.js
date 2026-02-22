// @ts-check - Type checking rigoroso habilitado (arquivo core)
import dotenv from 'dotenv';
import fs from 'node:fs';

/**
 * Environment bootstrap (idempotent):
 * - Loads .env.local first (override=true)
 * - Loads .env second (defaults only)
 */
const BOOTSTRAP_FLAG = '__MAESTRO_ENV_BOOTSTRAPPED__';

function ensureEnvBootstrap() {
    if (globalThis[BOOTSTRAP_FLAG]) {
        return false;
    }

    const nodeEnv = String(process.env.NODE_ENV || '').trim();
    /** @type {Array<{path: string, override?: boolean}>} */
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

    globalThis[BOOTSTRAP_FLAG] = true;
    return true;
}

ensureEnvBootstrap();

export { ensureEnvBootstrap, BOOTSTRAP_FLAG };
