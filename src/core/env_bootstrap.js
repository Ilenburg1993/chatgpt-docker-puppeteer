// @ts-check - Type checking rigoroso habilitado (arquivo core)
import dotenv from 'dotenv';
import fs from 'node:fs';

/**
 * Environment bootstrap (idempotent):
 * - Loads .env.local first (override=true)
 * - Loads .env second (defaults only)
 */
const BOOTSTRAP_FLAG = '__MAESTRO_ENV_BOOTSTRAPPED__';

if (!globalThis[BOOTSTRAP_FLAG]) {
    if (fs.existsSync('.env.local')) {
        dotenv.config({ path: '.env.local', override: true });
    }

    dotenv.config();
    globalThis[BOOTSTRAP_FLAG] = true;
}

