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
import { isAscii, isUtf8 } from 'node:buffer';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { log } from '../logger.js';

export const execFileAsync = promisify(execFile);

/** Raiz canonica do workspace definida pelo boot. */
export const WORKSPACE_ROOT = BOOT_WORKSPACE_ROOT;

/** Limite máximo de bytes retornados por read_file_content */
export const MAX_CONTENT_BYTES = 80_000;

/** Limite máximo de bytes retornados por search_in_file */
export const MAX_SEARCH_OUTPUT = 20_000;

/** Limite máximo de entradas retornadas por list_directory */
export const MAX_LIST_ENTRIES = 500;

/** Limite máximo de bytes para diffs retornados por diff_files. */
export const MAX_DIFF_OUTPUT = 64_000;

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
    /\.env$/i,
    /\.env\./i,
    /\.pem$/i,
    /\.key$/i,
    /secret/i,
    /\.passwd$/i,
    /credentials/i,
    /\.pfx$/i,
    /\.p12$/i,
    /id_rsa/i,
    /id_ed25519/i,
    /\.npmrc$/i,
    /\.netrc$/i,
];

/**
 * Padrões adicionais bloqueados apenas para operações de ESCRITA (executáveis que não devem ser criados/sobrescritos).
 *
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS_WRITE_ONLY = [
    /\.exe$/i,
    /\.bat$/i,
    /\.cmd$/i,
    /\.sh$/i,
    /\.ps1$/i,
    /\.msi$/i,
    /\.dll$/i,
    /\.so$/i,
    /\.dylib$/i,
];

/**
 * Todos os padrões bloqueados (secrets + executáveis) — para operações de escrita.
 *
 * @type {RegExp[]}
 */
const BLOCKED_PATTERNS = [...BLOCKED_PATTERNS_SECRETS, ...BLOCKED_PATTERNS_WRITE_ONLY];

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
    const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(normalizedWorkspaceRoot, filePath);

    // SEC-04 / BUG-H06 (fix): resolver symlinks antes de verificar containment.
    // F3.4 (BUG-MOD-08): usar realpath assíncrono para não bloquear o event loop.
    let realResolved = resolved;
    try {
        realResolved = await fs.promises.realpath(resolved);
    } catch {
        try {
            const parentDir = await fs.promises.realpath(path.dirname(resolved));
            realResolved = path.join(parentDir, path.basename(resolved));
        } catch {
            // Diretório pai também não existe; usar o caminho resolvido normalmente
        }
    }

    const relativeToWorkspace = path.relative(normalizedWorkspaceRoot, realResolved);

    // Impede traversal fora do workspace
    if (relativeToWorkspace.startsWith('..') || path.isAbsolute(relativeToWorkspace)) {
        return { ok: false, reason: `Acesso negado: caminho fora do workspace (${realResolved})`, resolved };
    }

    // Impede acesso a arquivos bloqueados
    const patterns = mode === 'read' ? BLOCKED_PATTERNS_SECRETS : BLOCKED_PATTERNS;
    const basename = path.basename(resolved);
    for (const pattern of patterns) {
        if (pattern.test(basename)) {
            return { ok: false, reason: `Acesso negado: arquivo protegido (${basename})`, resolved };
        }
    }

    return { ok: true, resolved };
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
