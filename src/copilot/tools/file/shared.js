// @ts-check
/**
 * src/copilot/tools/file/shared.js
 *
 * Constantes, padrões de segurança e helpers compartilhados pelas file-tools.
 *
 * @module copilot/tools/file/shared
 * @see EventBus
 */

import { WORKSPACE_ROOT as BOOT_WORKSPACE_ROOT } from '#copilot/boot';
import { DEFAULT_BLOCKED_READ_PATH_PATTERNS, evaluateIoPathPolicyAsync } from '#copilot/core';
import { isAscii, isUtf8 } from 'node:buffer';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { log } from '../logger.js';

export const execFileAsync = promisify(execFile);

/** Raiz canonica do workspace definida pelo boot. */
export const WORKSPACE_ROOT = BOOT_WORKSPACE_ROOT;

/** Limite informativo histórico de bytes para read_file_content. Não bloqueia nem trunca operações da LLM-B. */
export const MAX_CONTENT_BYTES = Number.POSITIVE_INFINITY;

/** Limite informativo histórico de bytes para search_in_files. Não bloqueia nem trunca operações da LLM-B. */
export const MAX_SEARCH_OUTPUT = Number.POSITIVE_INFINITY;

/** Limite informativo histórico de entradas para list_directory. Não bloqueia operações da LLM-B. */
export const MAX_LIST_ENTRIES = Number.POSITIVE_INFINITY;

/** Limite informativo histórico de bytes para diff_files. Não bloqueia nem trunca operações da LLM-B. */
export const MAX_DIFF_OUTPUT = Number.POSITIVE_INFINITY;

// MELHORIA-10 (fix): verificação lazy da disponibilidade de ripgrep (cache single-check)
/** @type {boolean | null} */
let _rgAvailable = null;

/**
 * Verifica se o binário `rg` (ripgrep) está disponível no PATH. O resultado é cacheado após a primeira verificação.
 *
 * @returns {Promise<boolean>}
 */
export async function isRgAvailable() {
    if (_rgAvailable !== null) return _rgAvailable;
    try {
        await execFileAsync('rg', ['--version'], { timeout: 3000 });
        _rgAvailable = true;
    } catch {
        _rgAvailable = false;
        log('WARN', '[copilot/file-tools] ripgrep (rg) não encontrado no PATH — search_in_files retornará erro.');
    }
    return _rgAvailable;
}

/**
 * Padrões de arquivos bloqueados para TODAS as operações (segredos, chaves, credenciais).
 *
 * @type {RegExp[]}
 */
export const BLOCKED_PATTERNS_SECRETS = [...DEFAULT_BLOCKED_READ_PATH_PATTERNS];

/**
 * Verifica se um caminho está dentro do workspace autorizado e não é um arquivo bloqueado.
 *
 * @param {string} filePath - Caminho absoluto ou relativo
 * @param {{ mode?: 'read' | 'write' }} [opts] - Modo de operação (default: 'write' para máxima proteção)
 * @returns {Promise<{ ok: boolean; reason?: string; resolved: string }>}
 */
export async function validatePath(filePath, opts) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return { ok: false, reason: 'Caminho inválido: path vazio.', resolved: '' };
    }
    if (filePath.includes('\u0000')) {
        return { ok: false, reason: 'Caminho inválido: contém byte nulo.', resolved: '' };
    }

    const mode = opts?.mode ?? 'write';
    const normalizedWorkspaceRoot = path.resolve(WORKSPACE_ROOT);
    const policy = await evaluateIoPathPolicyAsync(filePath, {
        workspaceRoot: normalizedWorkspaceRoot,
        mode,
    });
    if (!policy.ok) {
        return {
            ok: false,
            reason: `Acesso negado: ${policy.reason}`,
            resolved: '',
        };
    }

    return { ok: true, resolved: policy.realPath };
}

// ---------------------------------------------------------------------------
// Utilitários de Buffer (Node.js >= 19.4 — disponíveis em Node 24+)
// ---------------------------------------------------------------------------

/**
 * Reexportação de `isUtf8` do `node:buffer` para uso centralizado nas file-tools. Valida eficientemente se um
 * Buffer/Uint8Array é UTF-8 válido sem conversão. Disponível desde Node.js 19.4.0.
 *
 * @type {(input: Buffer | NodeJS.TypedArray | DataView) => boolean}
 * @see https://nodejs.org/docs/latest/api/buffer.html#bufferisutf8input
 */
export { isAscii as bufferIsAscii, isUtf8 as bufferIsUtf8 };

/**
 * Concatena um array de chunks (Buffers) com otimização: fornece `totalLength` ao `Buffer.concat` para evitar a segunda
 * passagem interna de cálculo de tamanho.
 *
 * @param {Buffer[]} chunks - Array de Buffers a concatenar
 * @returns {Buffer} Buffer concatenado
 */
export function concatChunks(chunks) {
    if (chunks.length === 0) return Buffer.alloc(0);
    if (chunks.length === 1) return chunks[0] ?? Buffer.alloc(0);
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    return Buffer.concat(chunks, totalLength);
}

/**
 * Trunca um Buffer para `maxBytes` bytes usando `subarray` (zero-copy view). Nota: `.toString('utf8')` sobre um
 * subarray que termina no meio de uma sequência multibyte emitirá U+FFFD; aceitável para mensagens de truncamento.
 *
 * @param {Buffer} buf - Buffer a truncar
 * @param {number} maxBytes - Tamanho máximo em bytes
 * @returns {Buffer} Subarray (view) do buffer original
 */
export function truncateBuffer(buf, maxBytes) {
    if (buf.length <= maxBytes) return buf;
    return buf.subarray(0, maxBytes);
}
