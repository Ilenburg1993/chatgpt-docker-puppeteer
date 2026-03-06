// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizePath(/** @type {any} */ value) {
    if (!value) return null;
    try {
        return resolve(String(value));
    } catch {
        return null;
    }
}

/**
 * Lê flag booleana de environment com parsing resiliente.
 *
 * @param {unknown} value
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
function parseEnvFlag(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
}

function resolveEntrypointFile(/** @type {any} */ importMetaUrl) {
    try {
        return normalizePath(fileURLToPath(importMetaUrl));
    } catch {
        return null;
    }
}

/**
 * Detecta execução direta do arquivo atual (entrypoint real via CLI/Node).
 *
 * @param {string} importMetaUrl
 * @param {string|null|undefined} [argvFile=process.argv[1]]
 * @returns {boolean}
 */
function isDirectEntryExecution(importMetaUrl, argvFile = process.argv[1]) {
    const entryFile = resolveEntrypointFile(importMetaUrl);
    const argvPath = normalizePath(argvFile);
    if (!entryFile || !argvPath) return false;
    return argvPath === entryFile;
}

/**
 * Detecta quando o PM2 está executando exatamente este arquivo como script principal.
 *
 * @param {string} importMetaUrl
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {boolean}
 */
function isPm2ExecPathMatch(importMetaUrl, env = process.env) {
    const entryFile = resolveEntrypointFile(importMetaUrl);
    if (!entryFile) return false;
    const pmExecPath = normalizePath(env.pm_exec_path || env.PM2_EXEC_PATH || '');
    if (!pmExecPath) return false;
    return pmExecPath === entryFile;
}

/**
 * @typedef {object} ShouldAutobootEntrypointOptions
 * @property {string} importMetaUrl
 * @property {NodeJS.ProcessEnv} env
 * @property {string|null} explicitAutostartEnv
 * @property {boolean} allowPm2ExecPathMatch
 */
/**
 * Decide se o entrypoint deve auto-bootstrap no import atual.
 *
 * @param {ShouldAutobootEntrypointOptions} options
 * @returns {boolean}
 */
function shouldAutobootEntrypoint({
    importMetaUrl,
    env = process.env,
    explicitAutostartEnv = null,
    allowPm2ExecPathMatch = false,
}) {
    if (isDirectEntryExecution(importMetaUrl, process.argv[1])) {
        return true;
    }

    if (allowPm2ExecPathMatch && isPm2ExecPathMatch(importMetaUrl, env)) {
        return true;
    }

    if (explicitAutostartEnv) {
        return parseEnvFlag(env[explicitAutostartEnv], false);
    }

    return false;
}

export { isDirectEntryExecution, isPm2ExecPathMatch, parseEnvFlag, shouldAutobootEntrypoint };
