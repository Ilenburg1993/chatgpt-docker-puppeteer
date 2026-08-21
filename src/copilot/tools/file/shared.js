// @ts-check
import {
    WORKSPACE_ROOT as BOOT_WORKSPACE_ROOT,
    getApplicationInfraRuntime,
    getApplicationWorkspaceInfra,
} from '#copilot/boot';
import { DEFAULT_BLOCKED_READ_PATH_PATTERNS } from '#copilot/core';
import { hasNullByte } from '#copilot/infra/public/policy';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../infra/logger.js';
/**
 * src/copilot/tools/file/shared.js
 *
 * Constantes, padrões de segurança e helpers compartilhados pelas file-tools.
 *
 * @module copilot/tools/file/shared
 * @see EventBus
 */

import {
    bufferIsAscii,
    bufferIsUtf8,
    concatBufferViews,
    truncateBufferView,
    truncateUtf8String,
} from '#copilot/infra/public/platform/buffer';

export const execFileAsync = promisify(execFile);

/** Raiz canonica do workspace definida pelo boot. */
export const WORKSPACE_ROOT = BOOT_WORKSPACE_ROOT;

/** Canonical path authority shared by all file-tool fast paths in this workspace. */
export const WORKSPACE_INFRA = getApplicationWorkspaceInfra(WORKSPACE_ROOT);
export const WORKSPACE_PATH_AUTHORITY = WORKSPACE_INFRA.authority;
/** Workspace-bound IO facade composed once for all file tools. */
export const WORKSPACE_IO = WORKSPACE_INFRA.io;
/** Workspace-bound indexing facade composed once for all file tools. */
export const WORKSPACE_INDEXING = WORKSPACE_INFRA.indexing;
/** Runtime-owned mutation audit used by all file-tool mutation envelopes. */
export const WORKSPACE_MUTATION_AUDIT = getApplicationInfraRuntime().mutationAudit;
/** Immutable rollback policy captured by the canonical application InfraRuntime. */
export const WORKSPACE_ROLLBACK_POLICY = getApplicationInfraRuntime().config.rollback;

const FILE_TOOL_LIMIT_ENV_KEYS = /** @type {const} */ ({
    maxContentBytes: 'COPILOT_FILE_TOOLS_MAX_CONTENT_BYTES',
    maxSearchOutputBytes: 'COPILOT_FILE_TOOLS_MAX_SEARCH_OUTPUT_BYTES',
    maxListEntries: 'COPILOT_FILE_TOOLS_MAX_LIST_ENTRIES',
    maxDiffOutputBytes: 'COPILOT_FILE_TOOLS_MAX_DIFF_OUTPUT_BYTES',
});

const FILE_TOOL_LIMIT_DEFAULTS = Object.freeze({
    maxContentBytes: 2 * 1024 * 1024,
    maxSearchOutputBytes: 2 * 1024 * 1024,
    maxListEntries: 2000,
    maxDiffOutputBytes: 2 * 1024 * 1024,
});

/**
 * @param {string} envKey
 * @param {number} defaultValue
 * @returns {number}
 */
function readConfiguredLimitFromEnv(envKey, defaultValue) {
    const raw = process.env[envKey];
    if (raw === undefined || raw.trim() === '') return defaultValue;
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
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

/**
 * Política efetiva de saída das file tools.
 *
 * Defaults são altos porém finitos (paginados por padrão); operadores podem ajustar via ENV.
 */
export const FILE_TOOLS_OUTPUT_POLICY = Object.freeze({
    maxContentBytes: readConfiguredLimitFromEnv(
        FILE_TOOL_LIMIT_ENV_KEYS.maxContentBytes,
        FILE_TOOL_LIMIT_DEFAULTS.maxContentBytes,
    ),
    maxSearchOutputBytes: readConfiguredLimitFromEnv(
        FILE_TOOL_LIMIT_ENV_KEYS.maxSearchOutputBytes,
        FILE_TOOL_LIMIT_DEFAULTS.maxSearchOutputBytes,
    ),
    maxListEntries: readConfiguredLimitFromEnv(
        FILE_TOOL_LIMIT_ENV_KEYS.maxListEntries,
        FILE_TOOL_LIMIT_DEFAULTS.maxListEntries,
    ),
    maxDiffOutputBytes: readConfiguredLimitFromEnv(
        FILE_TOOL_LIMIT_ENV_KEYS.maxDiffOutputBytes,
        FILE_TOOL_LIMIT_DEFAULTS.maxDiffOutputBytes,
    ),
});

/**
 * Limite efetivo de bytes para read_file_content.
 *
 * Default: alto e finito (paginado por padrão). Pode ser ajustado por ENV.
 */
export const MAX_CONTENT_BYTES = FILE_TOOLS_OUTPUT_POLICY.maxContentBytes;

/** Limite efetivo de bytes para search_in_files / workspace_symbol_search. */
export const MAX_SEARCH_OUTPUT = FILE_TOOLS_OUTPUT_POLICY.maxSearchOutputBytes;

/** Limite efetivo de entradas para list_directory. */
export const MAX_LIST_ENTRIES = FILE_TOOLS_OUTPUT_POLICY.maxListEntries;

/** Limite efetivo de bytes para diff_files. */
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
 * Reusable capabilities are issued only by the canonical WorkspacePathAuthority. Callers never receive or invoke a raw
 * capability constructor.
 *
 * @param {string} filePath - Caminho absoluto ou relativo
 * @param {{ mode?: 'read' | 'write'; issueReadCapability?: boolean; issueMutableCapability?: boolean }} [opts] - Modo
 *   de operação; capabilities exigem opt-in explícito.
 * @returns {Promise<{
 *     ok: boolean;
 *     reason?: string;
 *     resolved: string;
 *     validatedReadPath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedReadWorkspacePath;
 *     validatedWritePath?: import('#copilot/infra/public/composition/workspace/authority').ValidatedMutableWorkspacePath;
 * }>}
 */
export async function validatePath(filePath, opts) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return { ok: false, reason: 'Caminho inválido: path vazio.', resolved: '' };
    }
    if (hasNullByte(filePath)) {
        return { ok: false, reason: 'Caminho inválido: contém byte nulo.', resolved: '' };
    }

    const mode = opts?.mode ?? 'write';
    try {
        if (mode === 'read' && opts?.issueReadCapability === true) {
            const validatedReadPath = await WORKSPACE_PATH_AUTHORITY.authorizeRead(filePath, 'read');
            return { ok: true, resolved: validatedReadPath.realPath, validatedReadPath };
        }
        if (mode !== 'read' && opts?.issueMutableCapability === true) {
            const validatedWritePath = await WORKSPACE_PATH_AUTHORITY.authorizeMutation(filePath, 'write');
            return { ok: true, resolved: validatedWritePath.realPath, validatedWritePath };
        }
        return { ok: true, resolved: await WORKSPACE_PATH_AUTHORITY.resolvePath(filePath, mode) };
    } catch (error) {
        const policyError = /** @type {Error & { policyReason?: string }} */ (error);
        return {
            ok: false,
            reason: `Acesso negado: ${policyError.policyReason ?? policyError.message}`,
            resolved: '',
        };
    }
}

// ---------------------------------------------------------------------------
// Utilitários de Buffer (Node.js >= 19.4 — disponíveis em Node 24+)
// ---------------------------------------------------------------------------

/**
 * Reexportação da facade pública de Buffer da infra para uso centralizado nas file-tools.
 *
 * @type {(input: Buffer | NodeJS.TypedArray | DataView) => boolean}
 * @see https://nodejs.org/docs/latest/api/buffer.html#bufferisutf8input
 */
export { bufferIsAscii, bufferIsUtf8 };

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
    return concatBufferViews(chunks, totalLength);
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
    return truncateBufferView(buf, maxBytes);
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
    const truncated = truncateUtf8String(normalized, maxBytes);
    if (!truncated.truncated) return truncated;
    const suffix = notice && notice.trim() ? notice : '\n\n⚠️ [output truncated by file-tools policy]';
    return {
        text: `${truncated.text}${suffix}`,
        truncated: true,
        originalBytes: truncated.originalBytes,
        limitBytes: truncated.limitBytes,
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

/**
 * Aplica janela de entries com cursor numérico estável.
 *
 * @template T
 * @param {T[]} entries
 * @param {{ maxEntries?: number; cursor?: string | number | null; fallbackMaxEntries?: number }} options
 * @returns {{
 *     entries: T[];
 *     truncated: boolean;
 *     totalEntries: number;
 *     limitEntries: number | null;
 *     cursorOffset: number;
 *     nextCursor: string | null;
 * }}
 */
export function applyEntryWindow(entries, options = {}) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const totalEntries = safeEntries.length;
    const requestedLimit = Number(options.maxEntries ?? options.fallbackMaxEntries);
    const limitEntries = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : null;
    const requestedOffset = Number(options.cursor ?? 0);
    const cursorOffset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset) : 0;
    if (limitEntries === null) {
        return {
            entries: safeEntries.slice(cursorOffset),
            truncated: false,
            totalEntries,
            limitEntries,
            cursorOffset,
            nextCursor: null,
        };
    }
    const endOffset = cursorOffset + limitEntries;
    return {
        entries: safeEntries.slice(cursorOffset, endOffset),
        truncated: endOffset < totalEntries,
        totalEntries,
        limitEntries,
        cursorOffset,
        nextCursor: endOffset < totalEntries ? String(endOffset) : null,
    };
}
