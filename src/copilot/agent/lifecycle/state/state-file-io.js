// @ts-check
/**
 * @module copilot/agent/lifecycle/state/state-file-io
 * @file Operações de filesystem cruas para o estado persistido do agent runtime.
 *
 *   Separa concerns de I/O (`mkdir/read/write/rm`) da policy semântica de estado em `state-io.js`.
 */

import { resolveHooksStateDir, resolveHooksStateFile } from '#copilot/boot';
import { STATE_FILE as _STATE_FILE_ENV } from '#copilot/config/agent';
import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { dirname, resolve } from 'node:path';

/** @type {string} */
export const STATE_FILE = _STATE_FILE_ENV ? resolve(_STATE_FILE_ENV) : resolveHooksStateFile('sdk-always-alive.json');
/** @type {string} */
export const STATE_DIR = _STATE_FILE_ENV ? dirname(STATE_FILE) : resolveHooksStateDir();

const STATE_FS = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'agent.lifecycle.state-file-io',
        exactPaths: [STATE_DIR, STATE_FILE],
        operations: ['mkdir', 'stat', 'read', 'write', 'delete'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);

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
    await STATE_FS.mkdirPath(STATE_DIR, {
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
        const stats = (await STATE_FS.lstatPath(STATE_FILE)).stats;
        if (!stats.isFile() || stats.isSymbolicLink()) return null;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ERR_CONFIGURED_FS_SYMLINK') throw error;
        return null;
    }
    return (await STATE_FS.readTextFresh(STATE_FILE)).content;
}

/**
 * @param {string} filePath
 * @param {string} content
 * @param {{ mode: number }} options
 */
async function writeStateFileAtomicConfigured(filePath, content, options) {
    await STATE_FS.writeFileAtomic(filePath, content, options);
}

/** @type {(filePath: string, content: string, options: { mode: number }) => Promise<void>} */
let stateFileWriter = writeStateFileAtomicConfigured;

export const stateFileIoTestHarness = Object.freeze({
    /**
     * @param {(filePath: string, content: string, options: { mode: number }) => Promise<void>} writer
     */
    setStateFileWriter(writer) {
        stateFileWriter = writer;
    },
    resetStateFileWriter() {
        stateFileWriter = writeStateFileAtomicConfigured;
    },
    writeStateFileAtomicConfigured,
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
    await STATE_FS.deleteFile(STATE_FILE, {
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
