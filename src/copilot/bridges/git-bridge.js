// @ts-check
/**
 * @module copilot/git-bridge
 * @file Git Bridge — encapsula chamadas ao `git` CLI.
 *
 *   Usa `execFile` para evitar shell injection. Retorna objetos JS estruturados para uso no terminal REPL e HTTP
 *   endpoints.
 * @see module:copilot/tools/git-tools
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Diretório raiz do projeto para executar git. */
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Executa git com args a partir da raiz do projeto.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>}
 */
async function runGit(args, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 10000;
    const { stdout } = await execFileAsync('git', args, {
        cwd: PROJECT_ROOT,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * @typedef {object} StatusEntry
 * @property {string} xy - 2-char git status code (ex: "M ", " M", "??")
 * @property {string} path - caminho do arquivo
 * @property {string} label - descrição legível
 * @property {string} color - código ANSI de cor
 */

/**
 * @typedef {object} LogEntry
 * @property {string} hash
 * @property {string} abbrevHash
 * @property {string} authorName
 * @property {string} authorDate
 * @property {string} subject
 * @property {string} refNames
 */

/**
 * @typedef {object} BranchEntry
 * @property {string} name
 * @property {boolean} current
 * @property {string} [upstream]
 * @property {string} [lastCommit]
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Mapeia código de status git para label e cor ANSI. @type {Record<string, {label: string; color: string}>} */
const STATUS_MAP = /** @type {Record<string, { label: string; color: string }>} */ ({
    M: { label: 'modificado', color: '\x1b[33m' },
    A: { label: 'adicionado', color: '\x1b[32m' },
    D: { label: 'deletado', color: '\x1b[31m' },
    R: { label: 'renomeado', color: '\x1b[36m' },
    C: { label: 'copiado', color: '\x1b[36m' },
    U: { label: 'conflito', color: '\x1b[35m' },
    '?': { label: 'não rastreado', color: '\x1b[90m' },
    '!': { label: 'ignorado', color: '\x1b[90m' },
});

/**
 * Retorna descrição e cor para código de status.
 *
 * @param {string} code
 * @returns {{ label: string; color: string }}
 */
function statusInfo(code) {
    return STATUS_MAP[code] ?? { label: code, color: '\x1b[0m' };
}

/**
 * Retorna os arquivos modificados/staged/untracked do working tree.
 *
 * @returns {Promise<StatusEntry[]>}
 */
export async function gitStatus() {
    try {
        const out = await runGit(['status', '--porcelain=v1', '-u']);
        if (!out) return [];
        return out
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const xy = line.substring(0, 2);
                const filePath = line.substring(3).trim();
                const staged = statusInfo((xy[0] ?? ' ').trim() || ' ');
                const unstaged = statusInfo((xy[1] ?? ' ').trim() || ' ');
                const label = xy[0] !== ' ' && xy[0] !== '?' ? `staged:${staged.label}` : `unstaged:${unstaged.label}`;
                const color = xy[0] !== ' ' && xy[0] !== '?' ? staged.color : unstaged.color;
                return { xy, path: filePath, label, color };
            });
    } catch {
        return [];
    }
}

/**
 * Formata lista de status em string colorida para o terminal.
 *
 * @param {StatusEntry[]} entries
 * @returns {string}
 */
export function formatStatus(entries) {
    if (!entries.length) return '  working tree limpo ✅';
    return entries
        .map((e) => `  ${e.color}${e.xy}\x1b[0m  ${e.path.padEnd(50)}  \x1b[90m(${e.label})\x1b[0m`)
        .join('\n');
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/**
 * Retorna log de commits recentes.
 *
 * @param {object} [opts]
 * @param {number} [opts.n]
 * @param {boolean} [opts.oneline]
 * @returns {Promise<LogEntry[]>}
 */
export async function gitLog(opts = {}) {
    const { n = 10, oneline = false } = opts;
    const format = oneline ? '%H\x1f%h\x1f%an\x1f%ar\x1f%s' : '%H\x1f%h\x1f%an\x1f%ar\x1f%s\x1f%D';
    try {
        const out = await runGit(['log', `--pretty=format:${format}`, `-${n}`]);
        if (!out) return [];
        return out
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('\x1f');
                const hash = parts[0] ?? '';
                const abbrevHash = parts[1] ?? '';
                const authorName = parts[2] ?? '';
                const authorDate = parts[3] ?? '';
                const subject = parts[4] ?? '';
                const refNames = parts[5] ?? '';
                return { hash, abbrevHash, authorName, authorDate, subject, refNames };
            });
    } catch {
        return [];
    }
}

/**
 * Formata log de commits para o terminal.
 *
 * @param {LogEntry[]} entries
 * @param {boolean} [oneline]
 * @returns {string}
 */
export function formatLog(entries, oneline = false) {
    if (!entries.length) return '  (sem commits)';
    return entries
        .map((e) => {
            const refs = e.refNames ? `\x1b[33m (${e.refNames})\x1b[0m` : '';
            if (oneline) {
                return `  \x1b[33m${e.abbrevHash}\x1b[0m  ${e.subject.substring(0, 70)}  \x1b[90m${e.authorDate}\x1b[0m`;
            }
            return `  \x1b[33m${e.abbrevHash}\x1b[0m${refs}  \x1b[1m${e.subject.substring(0, 60)}\x1b[0m\n        \x1b[90m${e.authorName}  ·  ${e.authorDate}\x1b[0m`;
        })
        .join('\n');
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Retorna diff do working tree ou staged.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.staged]
 * @param {string} [opts.file]
 * @returns {Promise<string>}
 */
export async function gitDiff(opts = {}) {
    const { staged = false, file } = opts;
    const args = ['diff'];
    if (staged) args.push('--staged');
    if (file) args.push('--', file);
    try {
        return await runGit(args);
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

/**
 * Lista branches locais.
 *
 * @returns {Promise<BranchEntry[]>}
 */
export async function gitBranch() {
    try {
        const out = await runGit([
            'branch',
            '-v',
            '--format=%(HEAD)\x1f%(refname:short)\x1f%(upstream:short)\x1f%(subject)',
        ]);
        if (!out) return [];
        return out
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('\x1f');
                const head = parts[0] ?? '';
                const name = parts[1] ?? '';
                const upstreamRaw = parts[2] ?? '';
                const lastCommitRaw = parts[3] ?? '';
                /** @type {BranchEntry} */
                const entry = { name, current: head === '*' };
                if (upstreamRaw) entry.upstream = upstreamRaw;
                if (lastCommitRaw) entry.lastCommit = lastCommitRaw;
                return entry;
            });
    } catch {
        return [];
    }
}

/**
 * Formata lista de branches para o terminal.
 *
 * @param {BranchEntry[]} branches
 * @returns {string}
 */
export function formatBranch(branches) {
    if (!branches.length) return '  (nenhuma branch)';
    return branches
        .map((b) => {
            const mark = b.current ? '\x1b[32m*\x1b[0m' : ' ';
            const name = b.current ? `\x1b[32m${b.name}\x1b[0m` : b.name;
            const up = b.upstream ? `\x1b[90m → ${b.upstream}\x1b[0m` : '';
            return `  ${mark} ${name}${up}`;
        })
        .join('\n');
}

/**
 * Cria uma nova branch.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function gitCreateBranch(name) {
    try {
        await runGit(['checkout', '-b', name]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Troca para uma branch existente.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function gitCheckout(name) {
    try {
        await runGit(['checkout', name]);
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Pull / Push
// ---------------------------------------------------------------------------

/**
 * Executa git pull.
 *
 * @returns {Promise<string>}
 */
export async function gitPull() {
    try {
        return await runGit(['pull', '--ff-only'], { timeoutMs: 30000 });
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * Executa git push.
 *
 * @param {object} [opts]
 * @param {string} [opts.remote]
 * @param {string} [opts.branch]
 * @returns {Promise<string>}
 */
export async function gitPush(opts = {}) {
    const { remote = 'origin', branch } = opts;
    const args = ['push', remote];
    if (branch) args.push(branch);
    try {
        return await runGit(args, { timeoutMs: 30000 });
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

// ---------------------------------------------------------------------------
// Add / Commit / Stash
// ---------------------------------------------------------------------------

/**
 * Adiciona arquivos ao staging.
 *
 * @param {string[]} paths
 * @returns {Promise<boolean>}
 */
export async function gitAdd(paths) {
    try {
        await runGit(['add', '--', ...paths]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Faz commit com mensagem.
 *
 * @param {string} message
 * @returns {Promise<string>} hash abreviado do commit ou mensagem de erro
 */
export async function gitCommit(message) {
    try {
        const out = await runGit(['commit', '-m', message]);
        // Extrair hash abreviado da saída do commit
        const match = out.match(/\b([0-9a-f]{7,})\b/);
        return match?.[1] ?? out.split('\n')[0] ?? out;
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * Operações de stash.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.pop] - se true, executa stash pop; senão stash push
 * @param {string} [opts.message]
 * @returns {Promise<string>}
 */
export async function gitStash(opts = {}) {
    const { pop = false, message } = opts;
    try {
        if (pop) return await runGit(['stash', 'pop']);
        const args = ['stash', 'push'];
        if (message) args.push('-m', message);
        return await runGit(args);
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

/**
 * Lista stash entries.
 *
 * @returns {Promise<string>}
 */
export async function gitStashList() {
    try {
        return await runGit(['stash', 'list']);
    } catch {
        return '';
    }
}
