// @ts-check
/**
 * Porta baixa para subprocessos de busca local.
 *
 * Mantém a engine canônica afastada dos detalhes de `child_process` e concentra
 * caches de disponibilidade/execução usados por adapters como rg e grep.
 *
 * @module copilot/infra/io/search/subprocess
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** @type {boolean | null} */
let _rgAvailable = null;

/**
 * @typedef {object} SearchSubprocessOptions
 * @property {string | undefined} [cwd]
 * @property {number} [timeout]
 * @property {number} [maxBuffer]
 * @property {AbortSignal} [signal]
 */

/**
 * Executa um binário de busca com argumentos já normalizados pelo adapter chamador.
 *
 * @param {string} file
 * @param {readonly string[]} args
 * @param {SearchSubprocessOptions} [options]
 * @returns {Promise<{ stdout: string; stderr: string }>}
 */
export async function execSearchFile(file, args, options = {}) {
    return execFileAsync(file, [...args], options);
}

/**
 * Verifica e cacheia a disponibilidade de ripgrep no ambiente atual.
 *
 * @returns {Promise<boolean>}
 */
export async function isRipgrepAvailable() {
    if (_rgAvailable !== null) return _rgAvailable;
    try {
        await execSearchFile('rg', ['--version'], { timeout: 3000 });
        _rgAvailable = true;
    } catch {
        _rgAvailable = false;
    }
    return _rgAvailable;
}

/**
 * Auxiliar de teste para cenários que precisam reavaliar o binário no mesmo processo.
 *
 * @returns {void}
 */
export function resetSearchSubprocessCacheForTest() {
    _rgAvailable = null;
}
