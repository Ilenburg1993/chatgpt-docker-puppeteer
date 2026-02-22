// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizePath(value) {
    if (!value) return null;
    try {
        return resolve(String(value));
    } catch {
        return null;
    }
}

function parseEnvFlag(value, fallback = false) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
}

function resolveEntrypointFile(importMetaUrl) {
    try {
        return normalizePath(fileURLToPath(importMetaUrl));
    } catch {
        return null;
    }
}

function isDirectEntryExecution(importMetaUrl, argvFile = process.argv[1]) {
    const entryFile = resolveEntrypointFile(importMetaUrl);
    const argvPath = normalizePath(argvFile);
    if (!entryFile || !argvPath) return false;
    return argvPath === entryFile;
}

function isPm2ExecPathMatch(importMetaUrl, env = process.env) {
    const entryFile = resolveEntrypointFile(importMetaUrl);
    if (!entryFile) return false;
    const pmExecPath = normalizePath(env.pm_exec_path || env.PM2_EXEC_PATH || '');
    if (!pmExecPath) return false;
    return pmExecPath === entryFile;
}

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
