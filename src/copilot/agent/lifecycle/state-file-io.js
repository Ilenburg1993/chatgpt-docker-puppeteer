// @ts-check
/**
 * @module copilot/agent/lifecycle/state-file-io
 * @file Operações de filesystem cruas para o estado persistido do agent runtime.
 *
 *   Separa concerns de I/O (`mkdir/read/write/rm`) da policy semântica de estado em `state-io.js`.
 */

import { resolveHooksStateDir, resolveHooksStateFile } from '#copilot/boot';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { STATE_FILE as _STATE_FILE_ENV } from '../../config/agent.js';

/** @type {string} */
export const STATE_DIR = resolveHooksStateDir();
/** @type {string} */
export const STATE_FILE = _STATE_FILE_ENV ? resolve(_STATE_FILE_ENV) : resolveHooksStateFile('sdk-always-alive.json');

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
    await mkdir(STATE_DIR, { recursive: true });
    _stateDirReady = true;
}

/**
 * Lê o conteúdo bruto do arquivo de estado quando existir.
 *
 * @returns {Promise<string | null>}
 */
export async function readStateFileIfExists() {
    try {
        await stat(STATE_FILE);
    } catch {
        return null;
    }
    return readFile(STATE_FILE, 'utf8');
}

/**
 * Persiste payload JSON no arquivo de estado.
 *
 * @param {unknown} payload
 * @returns {Promise<void>}
 */
export async function writeStateFileJson(payload) {
    await ensureStateDirReady();
    await writeFile(STATE_FILE, JSON.stringify(payload, null, 4), 'utf8');
}

/**
 * Remove o arquivo de estado (best effort).
 *
 * @returns {Promise<void>}
 */
export async function removeStateFileIfExists() {
    await rm(STATE_FILE, { force: true });
}

/**
 * Reseta cache local de filesystem para forçar revalidação de diretório/arquivo.
 *
 * @returns {void}
 */
export function resetStateFileIoCache() {
    _stateDirReady = false;
}
