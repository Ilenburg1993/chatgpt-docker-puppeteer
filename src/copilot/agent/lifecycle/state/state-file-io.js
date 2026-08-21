// @ts-check
/**
 * @module copilot/agent/lifecycle/state/state-file-io
 * @file Operações de filesystem cruas para o estado persistido do agent runtime.
 *
 *   Separa concerns de I/O (`mkdir/read/write/rm`) da policy semântica de estado em `state-io.js`.
 */

import { resolveHooksStateDir, resolveHooksStateFile } from '#copilot/boot';
import { STATE_FILE as _STATE_FILE_ENV } from '#copilot/config/agent';
import {
    deleteFileTrusted,
    lstatPathTrusted,
    mkdirPathTrusted,
    readTextFreshTrusted,
    writeFileAtomicTrusted,
} from '#copilot/infra/public/filesystem/trusted';
import { dirname, resolve } from 'node:path';

/** @type {string} */
export const STATE_FILE = _STATE_FILE_ENV ? resolve(_STATE_FILE_ENV) : resolveHooksStateFile('sdk-always-alive.json');
/** @type {string} */
export const STATE_DIR = _STATE_FILE_ENV ? dirname(STATE_FILE) : resolveHooksStateDir();

/** @type {boolean} */
let _stateDirReady = false;

/**
 * Garante que o diretório do estado exista antes de operações de escrita.
 *
 * @returns {Promise<void>}
 */
export async function ensureStateDirReady() {
    if (_stateDirReady) {
        return;
    }
    await mkdirPathTrusted(STATE_DIR, {
        caller: 'agent.lifecycle.state-file-io',
        recursive: true,
        mode: 0o700,
    });
    _stateDirReady = true;
}

/**
 * Lê o conteúdo bruto do arquivo de estado quando existir.
 *
 * @returns {Promise<string | null>}
 */
export async function readStateFileIfExists() {
    try {
        const stats = (await lstatPathTrusted(STATE_FILE, { caller: 'agent.lifecycle.state-file-io' })).stats;
        if (!stats.isFile() || stats.isSymbolicLink()) return null;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
        return null;
    }
    return (await readTextFreshTrusted(STATE_FILE, { caller: 'agent.lifecycle.state-file-io' })).content;
}

/**
 * @param {string} filePath
 * @param {string} content
 * @param {{ mode: number }} options
 */
async function writeStateFileAtomicTrusted(filePath, content, options) {
    await writeFileAtomicTrusted(filePath, content, { ...options, caller: 'agent.lifecycle.state-file-io' });
}

/** @type {(filePath: string, content: string, options: { mode: number }) => Promise<void>} */
let stateFileWriter = writeStateFileAtomicTrusted;

export const stateFileIoTestHarness = Object.freeze({
    /**
     * @param {(filePath: string, content: string, options: { mode: number }) => Promise<void>} writer
     */
    setStateFileWriter(writer) {
        stateFileWriter = writer;
    },
    resetStateFileWriter() {
        stateFileWriter = writeStateFileAtomicTrusted;
    },
    writeStateFileAtomicTrusted,
});

/**
 * Persiste payload JSON no arquivo de estado.
 *
 * @param {unknown} payload
 * @returns {Promise<void>}
 */
export async function writeStateFileJson(payload) {
    await ensureStateDirReady();
    await stateFileWriter(STATE_FILE, `${JSON.stringify(payload, null, 4)}\n`, { mode: 0o600 });
}

/**
 * Remove o arquivo de estado (best effort).
 *
 * @returns {Promise<void>}
 */
export async function removeStateFileIfExists() {
    await deleteFileTrusted(STATE_FILE, {
        caller: 'agent.lifecycle.state-file-io',
        ignoreMissing: true,
    });
}

/**
 * Reseta cache local de filesystem para forçar revalidação de diretório/arquivo.
 *
 * @returns {void}
 */
export function resetStateFileIoCache() {
    _stateDirReady = false;
}
