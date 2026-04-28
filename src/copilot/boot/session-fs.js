// @ts-check
/**
 * src/copilot/boot/session-fs.js
 *
 * Contrato canônico de boot para a capability SessionFs do SDK. Mantém a leitura de env/paths em camada baixa para que
 * `sdk/` e consumers de observabilidade/boot compartilhem a mesma decisão arquitetural.
 *
 * @module copilot/boot/session-fs
 */

import { resolve } from 'node:path';
import { WORKSPACE_ROOT, resolveWorkspacePath } from './workspace.js';

export const DEFAULT_SESSION_FS_STATE_PATH = '.copilot/session-state';
export const DEFAULT_SESSION_FS_ROOT_DIR = '.copilot/sdk-session-fs';

export const SESSION_FS_ENV_KEYS = Object.freeze([
    'COPILOT_SDK_SESSION_FS_ENABLED',
    'COPILOT_SDK_SESSION_STATE_PATH',
    'COPILOT_SDK_SESSION_FS_CONVENTIONS',
    'COPILOT_SDK_SESSION_FS_ROOT',
    'COPILOT_SDK_SESSION_IDLE_TIMEOUT_SECONDS',
]);

/**
 * @param {string} key
 * @param {boolean} fallback
 * @returns {boolean}
 */
function envBool(key, fallback) {
    const value = process.env[key];
    if (value === undefined || value === '') return fallback;
    return value === 'true' || value === '1';
}

/**
 * @param {string} key
 * @returns {number | null}
 */
function envIntOpt(key) {
    const value = process.env[key];
    if (value === undefined || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * @param {string | undefined} value
 * @returns {'windows' | 'posix'}
 */
function normalizeConventions(value) {
    if (value === 'windows' || value === 'posix') return value;
    return process.platform === 'win32' ? 'windows' : 'posix';
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function normalizeSessionStatePath(value) {
    if (!value || !value.trim()) return DEFAULT_SESSION_FS_STATE_PATH;
    const normalized = value.trim().replace(/\\/gu, '/');
    if (normalized.startsWith('/')) return DEFAULT_SESSION_FS_STATE_PATH;
    if (/^[a-zA-Z]:\//u.test(normalized)) return DEFAULT_SESSION_FS_STATE_PATH;
    if (normalized.split('/').some((segment) => segment === '..')) return DEFAULT_SESSION_FS_STATE_PATH;
    return normalized;
}

/**
 * @returns {string}
 */
export function resolveSessionFsStorageRoot() {
    const customRoot = process.env['COPILOT_SDK_SESSION_FS_ROOT'];
    if (!customRoot || !customRoot.trim()) {
        return resolveWorkspacePath(DEFAULT_SESSION_FS_ROOT_DIR);
    }
    return resolve(customRoot.trim());
}

/**
 * @returns {{
 *     enabled: boolean;
 *     initialCwd: string;
 *     sessionStatePath: string;
 *     conventions: 'windows' | 'posix';
 *     storageRootDir: string;
 *     sessionIdleTimeoutSeconds: number | null;
 * }}
 */
export function readCopilotSessionFsBootConfig() {
    return {
        enabled: envBool('COPILOT_SDK_SESSION_FS_ENABLED', false),
        initialCwd: WORKSPACE_ROOT,
        sessionStatePath: normalizeSessionStatePath(process.env['COPILOT_SDK_SESSION_STATE_PATH']),
        conventions: normalizeConventions(process.env['COPILOT_SDK_SESSION_FS_CONVENTIONS']),
        storageRootDir: resolveSessionFsStorageRoot(),
        sessionIdleTimeoutSeconds: envIntOpt('COPILOT_SDK_SESSION_IDLE_TIMEOUT_SECONDS'),
    };
}
