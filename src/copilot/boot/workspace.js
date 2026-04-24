// @ts-check
/**
 * src/copilot/boot/workspace.js
 *
 * Descoberta canonica do workspace operacional do Copilot local.
 *
 * @module copilot/boot/workspace
 */

import * as childProcess from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export const COPILOT_PACKAGE_ROOT = resolve(import.meta.dirname, '../../..');

export const COPILOT_SOURCE_ROOT = resolve(COPILOT_PACKAGE_ROOT, 'src', 'copilot');

/** @type {number} */
const CONTEXT_CACHE_TTL_MS = 30_000;

/** @type {{ context: WorkspaceContext; expiresAt: number } | null} */
let _contextCache = null;

/**
 * @typedef {Object} WorkspaceContext
 * @property {string} cwd
 * @property {string | null} gitRoot
 * @property {string | null} currentBranch
 */

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeWorkspaceInput(value) {
    const raw = value && value.trim() ? value.trim() : COPILOT_PACKAGE_ROOT;
    return resolve(raw);
}

/**
 * @param {string | undefined} [input]
 * @returns {string}
 */
export function resolveBootWorkspaceRoot(input = process.env['COPILOT_WORKING_DIRECTORY']) {
    return normalizeWorkspaceInput(input);
}

export const WORKSPACE_ROOT = resolveBootWorkspaceRoot();

/**
 * @param {...string} segments
 * @returns {string}
 */
export function resolveWorkspacePath(...segments) {
    return resolve(WORKSPACE_ROOT, ...segments);
}

/**
 * @returns {string}
 */
export function resolveHooksStateDir() {
    return resolveWorkspacePath('.github', 'hooks', 'state');
}

/**
 * @param {string} name
 * @returns {string}
 */
export function resolveHooksStateFile(name) {
    return resolve(resolveHooksStateDir(), name);
}

/**
 * @param {string} name
 * @returns {string}
 */
export function resolvePersistentConfigFile(name) {
    return resolveWorkspacePath(name);
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string | null}
 */
function tryExec(bin, args, cwd) {
    try {
        if (typeof childProcess.execFileSync !== 'function') return null;
        return childProcess
            .execFileSync(bin, args, {
                cwd,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 5000,
            })
            .trim();
    } catch {
        return null;
    }
}

/**
 * @param {string} cwd
 * @returns {string | null}
 */
function detectGitRoot(cwd) {
    let dir = cwd;
    for (let i = 0; i < 30; i++) {
        if (existsSync(join(dir, '.git'))) return tryExec('git', ['rev-parse', '--show-toplevel'], cwd);
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * @returns {WorkspaceContext}
 */
export function getWorkspaceContext() {
    const now = Date.now();
    if (_contextCache && _contextCache.expiresAt > now) return _contextCache.context;

    const cwd = WORKSPACE_ROOT;
    const gitRoot = detectGitRoot(cwd);
    const currentBranch = gitRoot ? tryExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot) : null;
    const context = { cwd, gitRoot, currentBranch };
    _contextCache = { context, expiresAt: now + CONTEXT_CACHE_TTL_MS };
    return context;
}

/**
 * @param {string} bin
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
async function tryExecAsync(bin, args, cwd) {
    try {
        if (typeof childProcess.execFile !== 'function') return null;
        const execFileAsync = promisify(childProcess.execFile);
        const { stdout } = await execFileAsync(bin, args, { cwd, timeout: 5000 });
        return stdout.trim();
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<WorkspaceContext>}
 */
export async function getWorkspaceContextAsync() {
    const now = Date.now();
    if (_contextCache && _contextCache.expiresAt > now) return _contextCache.context;

    const cwd = WORKSPACE_ROOT;
    const gitRoot = detectGitRoot(cwd);
    const currentBranch = gitRoot ? await tryExecAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot) : null;
    const context = { cwd, gitRoot, currentBranch };
    _contextCache = { context, expiresAt: now + CONTEXT_CACHE_TTL_MS };
    return context;
}
