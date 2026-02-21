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

    if (fs.existsSync('.env.local')) {
        dotenv.config({ path: '.env.local', override: true, quiet: true });
    }

    dotenv.config({ quiet: true });
    globalThis[BOOTSTRAP_FLAG] = true;
    return true;
}

ensureEnvBootstrap();

export { ensureEnvBootstrap, BOOTSTRAP_FLAG };
