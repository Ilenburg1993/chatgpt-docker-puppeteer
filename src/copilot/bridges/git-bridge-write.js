// @ts-check
/**
 * src/copilot/bridges/git-bridge-write.js
 *
 * Git Bridge — operacoes de escrita: createBranch, checkout, pull, push, add, commit, stash.
 *
 * @module copilot/bridges/git-bridge-write
 * @see EventBus
 */

import { toError, container } from '#copilot/core';
import { METRICS_STORE, startSpanImmediate } from '#copilot/observability';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Diretório raiz do projeto para executar git. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT_DEFAULT_TIMEOUT_MS = 10_000;
const GIT_LONG_TIMEOUT_MS = 30_000;

/**
 * Executa git com args a partir da raiz do projeto.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>}
 */
async function runGit(args, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
    const method = args[0] ?? 'unknown';
    const span = startSpanImmediate('copilot.bridge.git', {
        bridge_type: 'git',
        method,
    });
    const t0 = Date.now();
    try {
        const { stdout } = await execFileAsync('git', args, {
            cwd: PROJECT_ROOT,
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024,
        });
        const elapsed = Date.now() - t0;
        span?.setAttribute('duration_ms', elapsed);
        span?.setAttribute('status_code', 0);
        span?.setStatus({ code: 1 });
        container.resolve(METRICS_STORE).recordToolCall(`bridge.git.${method}`, elapsed, true);
        return stdout.trim();
    } catch (err) {
        const elapsed = Date.now() - t0;
        span?.setAttribute('duration_ms', elapsed);
        span?.setAttribute('status_code', 2);
        span?.setStatus({ code: 2, message: toError(err).message });
        span?.recordException(err);
        container.resolve(METRICS_STORE).recordToolCall(`bridge.git.${method}`, elapsed, false);
        container.resolve(METRICS_STORE).recordCounter('copilot.bridge.errors_total');
        throw err;
    } finally {
        span?.end();
    }
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * @typedef {object} StatusEntry
 * @property {string} xy - 2-char git status code (ex: "M ", " M", "??")
 * @property {string} path - caminho do arquivo
 * @property {string} label - descrição legível
 * @property {string} color - código ANSI de cor
 */

/**
 * @typedef {object} LogEntry
 * @property {string} hash
 * @property {string} abbrevHash
 * @property {string} authorName
 * @property {string} authorDate
 * @property {string} subject
 * @property {string} refNames
 */

/**
 * @typedef {object} BranchEntry
 * @property {string} name
 * @property {boolean} current
 * @property {string} [upstream]
 * @property {string} [lastCommit]
 */

/**
 * Cria uma nova branch.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function gitCreateBranch(name) {
    try {
        await runGit(['checkout', '-b', name]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Troca para uma branch existente.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function gitCheckout(name) {
    try {
        await runGit(['checkout', name]);
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Pull / Push
// ---------------------------------------------------------------------------

/**
 * Executa git pull.
 *
 * @returns {Promise<string>}
 */
export async function gitPull() {
    try {
        return await runGit(['pull', '--ff-only'], { timeoutMs: GIT_LONG_TIMEOUT_MS });
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * Executa git push.
 *
 * @param {object} [opts]
 * @param {string} [opts.remote]
 * @param {string} [opts.branch]
 * @returns {Promise<string>}
 */
export async function gitPush(opts = {}) {
    const { remote = 'origin', branch } = opts;
    const args = ['push', remote];
    if (branch) args.push(branch);
    try {
        return await runGit(args, { timeoutMs: GIT_LONG_TIMEOUT_MS });
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

// ---------------------------------------------------------------------------
// Add / Commit / Stash
// ---------------------------------------------------------------------------

/**
 * Adiciona arquivos ao staging.
 *
 * @param {string[]} paths
 * @returns {Promise<boolean>}
 */
export async function gitAdd(paths) {
    try {
        await runGit(['add', '--', ...paths]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Faz commit com mensagem.
 *
 * @param {string} message
 * @returns {Promise<string>} hash abreviado do commit ou mensagem de erro
 */
export async function gitCommit(message) {
    try {
        const out = await runGit(['commit', '-m', message]);
        // Extrair hash abreviado da saída do commit
        const match = out.match(/\b([0-9a-f]{7,})\b/);
        return match?.[1] ?? out.split('\n')[0] ?? out;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * Operações de stash.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.pop] - se true, executa stash pop; senão stash push
 * @param {string} [opts.message]
 * @returns {Promise<string>}
 */
export async function gitStash(opts = {}) {
    const { pop = false, message } = opts;
    try {
        if (pop) return await runGit(['stash', 'pop']);
        const args = ['stash', 'push'];
        if (message) args.push('-m', message);
        return await runGit(args);
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * Lista stash entries.
 *
 * @returns {Promise<string>}
 */
export async function gitStashList() {
    try {
        return await runGit(['stash', 'list']);
    } catch {
        return '';
    }
}
