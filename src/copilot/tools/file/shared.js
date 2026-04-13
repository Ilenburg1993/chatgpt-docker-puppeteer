// @ts-check
/**
 * src/copilot/tools/file/shared.js
 *
 * Constantes, padrões de segurança e helpers compartilhados pelas file-tools.
 *
 * @module copilot/tools/file/shared
 * @see EventBus
 */

import { log } from '../logger.js';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

/** Raiz do workspace derivada do meta.url (resolve para /workspaces/...) */
export const WORKSPACE_ROOT = new URL('../../../..', import.meta.url).pathname;

/** Limite máximo de bytes retornados por read_file_content */
export const MAX_CONTENT_BYTES = 80_000;

/** Limite máximo de bytes retornados por search_in_file */
export const MAX_SEARCH_OUTPUT = 20_000;

/** Limite máximo de entradas retornadas por list_directory */
export const MAX_LIST_ENTRIES = 500;

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
    const mode = opts?.mode ?? 'write';
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(WORKSPACE_ROOT, filePath);

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

    const relativeToWorkspace = path.relative(WORKSPACE_ROOT, realResolved);

    // Impede traversal fora do workspace
    if (relativeToWorkspace.startsWith('..')) {
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
