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
import { log } from '../infra/logger.js';

export const execFileAsync = promisify(execFile);

/** Raiz canonica do workspace definida pelo boot. */
export const WORKSPACE_ROOT = BOOT_WORKSPACE_ROOT;

const FILE_TOOL_LIMIT_ENV_KEYS = /** @type {const} */ ({
    maxContentBytes: 'COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES',
    maxSearchOutputBytes: 'COPILOT_FILE_TOOLS_MAX_SEARCH_OUTPUT_BYTES',
    maxListEntries: 'COPILOT_FILE_TOOLS_MAX_LIST_ENTRIES',
    maxDiffOutputBytes: 'COPILOT_FILE_TOOLS_MAX_DIFF_OUTPUT_BYTES',
});

/**
 * @param {string} envKey
 * @returns {number}
 */
function readConfiguredLimitFromEnv(envKey) {
    const raw = process.env[envKey];
    if (raw === undefined || raw.trim() === '') return Number.POSITIVE_INFINITY;
    const normalized = raw.trim().toLowerCase();
    if (
        normalized === 'infinity' ||
        normalized === 'inf' ||
        normalized === 'unbounded' ||
        normalized === 'unlimited' ||
        normalized === 'none'
    ) {
        return Number.POSITIVE_INFINITY;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Política efetiva de saída das file tools.
 *
 * Defaults permanecem unbounded para manter o princípio LLM-B first; operadores podem ativar limites finitos via ENV
 * quando desejarem uma política mais conservadora.
 */
export const FILE_TOOLS_OUTPUT_POLICY = Object.freeze({
    maxContentBytes: readConfiguredLimitFromEnv(FILE_TOOL_LIMIT_ENV_KEYS.maxContentBytes),
    maxSearchOutputBytes: readConfiguredLimitFromEnv(FILE_TOOL_LIMIT_ENV_KEYS.maxSearchOutputBytes),
    maxListEntries: readConfiguredLimitFromEnv(FILE_TOOL_LIMIT_ENV_KEYS.maxListEntries),
    maxDiffOutputBytes: readConfiguredLimitFromEnv(FILE_TOOL_LIMIT_ENV_KEYS.maxDiffOutputBytes),
});

/**
 * Limite efetivo de bytes para read_file_content.
 *
 * Default: `Infinity` (sem truncamento). Quando configurado via ENV para valor finito, a tool trunca a saída de forma
 * explícita e observável.
 */
export const MAX_CONTENT_BYTES = FILE_TOOLS_OUTPUT_POLICY.maxContentBytes;

/** Limite efetivo de bytes para search_in_files / workspace_symbol_search. Default: `Infinity`. */
export const MAX_SEARCH_OUTPUT = FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes;

/** Limite efetivo de entradas para list_directory. Default: `Infinity`. */
export const MAX_LIST_ENTRIES = FILE_TOOLS_OUTPUT_POLICY.maxListEntries;

/** Limite efetivo de bytes para diff_files. Default: `Infinity`. */
export const MAX_DIFF_OUTPUT = FILE_TOOLS_OUTPUT_POLICY.maxDiffOutputBytes;

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
export const BLOCKED_PATTERNS_SECRETS = [
    ...(Array.isArray(DEFAULT_BLOCKED_READ_PATH_PATTERNS) ? DEFAULT_BLOCKED_READ_PATH_PATTERNS : []),
];

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

/**
 * Trunca texto UTF-8 de forma segura quando uma política finita estiver ativa.
 *
 * @param {string} text
 * @param {number} maxBytes
 * @param {string} [notice]
 * @returns {{ text: string; truncated: boolean; originalBytes: number; limitBytes: number | null }}
 */
export function truncateUtf8Text(text, maxBytes, notice) {
    const normalized = String(text ?? '');
    const originalBytes = Buffer.byteLength(normalized, 'utf8');
    if (!Number.isFinite(maxBytes) || maxBytes <= 0 || originalBytes <= maxBytes) {
        return {
            text: normalized,
            truncated: false,
            originalBytes,
            limitBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : null,
        };
    }

    const bytes = Buffer.from(normalized, 'utf8').subarray(0, maxBytes);
    const safe = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\uFFFD+$/, '');
    const suffix = notice && notice.trim() ? notice : '\n\n⚠️ [output truncated by file-tools policy]';
    return {
        text: `${safe}${suffix}`,
        truncated: true,
        originalBytes,
        limitBytes: maxBytes,
    };
}

/**
 * Aplica limite finito de entries de forma explícita.
 *
 * @template T
 * @param {T[]} entries
 * @param {number} maxEntries
 * @returns {{ entries: T[]; truncated: boolean; totalEntries: number; limitEntries: number | null }}
 */
export function applyEntryLimit(entries, maxEntries) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const totalEntries = safeEntries.length;
    if (!Number.isFinite(maxEntries) || maxEntries <= 0 || totalEntries <= maxEntries) {
        return {
            entries: safeEntries,
            truncated: false,
            totalEntries,
            limitEntries: Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : null,
        };
    }
    return {
        entries: safeEntries.slice(0, maxEntries),
        truncated: true,
        totalEntries,
        limitEntries: maxEntries,
    };
}
