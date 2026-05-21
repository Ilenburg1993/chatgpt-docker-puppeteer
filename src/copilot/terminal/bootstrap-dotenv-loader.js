// @ts-check
/**
 * Loader precoce de `.env.local` para o entrypoint do terminal.
 *
 * O arquivo `.env.local` é o contrato operacional do operador para BYOK e ajustes locais. No boot do terminal ele deve
 * ser carregado antes de qualquer projeção de config, mas sem sobrescrever variáveis explicitamente fornecidas pela task,
 * shell ou harness.
 *
 * @module copilot/terminal/bootstrap-dotenv-loader
 */

import { config as loadDotenv } from 'dotenv';

export const TERMINAL_DOTENV_LOCAL_PATH = '.env.local';

/**
 * @typedef {object} TerminalDotenvLoadResult
 * @property {boolean} loaded
 * @property {boolean} skipped
 * @property {boolean} missing
 * @property {string[]} keys
 * @property {string | null} error
 */

/**
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(opts: { path: string; override: boolean; quiet: boolean }) => { parsed?: Record<string, string>; error?: Error }} [options.load]
 * @param {string} [options.path]
 * @returns {TerminalDotenvLoadResult}
 */
export function loadTerminalDotenvLocal(options = {}) {
    const env = options.env ?? process.env;
    if (env['COPILOT_TERMINAL_LOAD_DOTENV_LOCAL'] === 'false') {
        return { loaded: false, skipped: true, missing: false, keys: [], error: null };
    }

    const path = options.path ?? TERMINAL_DOTENV_LOCAL_PATH;
    const load = options.load ?? loadDotenv;
    const result = load({ path, override: false, quiet: true });
    if (result.error) {
        if (/** @type {{ code?: string }} */ (result.error).code === 'ENOENT') {
            return { loaded: false, skipped: false, missing: true, keys: [], error: null };
        }
        return { loaded: false, skipped: false, missing: false, keys: [], error: result.error.message };
    }

    const keys = Object.keys(result.parsed ?? {});
    return { loaded: keys.length > 0, skipped: false, missing: false, keys, error: null };
}
