// @ts-check
/**
 * src/copilot/terminal/workspace-context.js
 *
 * Detecta e expõe informações sobre o workspace atual:
 *
 * - diretório de trabalho (cwd)
 * - raiz do repositório git (gitRoot)
 * - branch atual (currentBranch)
 *
 * AG.5 — workspace SessionContext
 *
 * @module copilot/terminal/workspace-context
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {Object} WorkspaceContext
 * @property {string} cwd - Diretório de trabalho atual do processo
 * @property {string | null} gitRoot - Raiz do repositório git (null se não for um repo git)
 * @property {string | null} currentBranch - Branch git atual (null se não disponível)
 */

/**
 * Executa um comando síncrono e retorna stdout, ou null em caso de erro.
 *
 * @param {string} cmd
 * @param {string} cwd
 * @returns {string | null}
 */
function tryExec(cmd, cwd) {
    try {
        return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
}

/**
 * Detecta a raiz do repositório git a partir de um diretório. Usa `git rev-parse --show-toplevel` para maior
 * confiabilidade.
 *
 * @param {string} cwd
 * @returns {string | null}
 */
function detectGitRoot(cwd) {
    // Verificação rápida antes de invocar git
    if (!existsSync(join(cwd, '.git')) && !tryExec('git rev-parse --git-dir', cwd)) {
        return null;
    }
    return tryExec('git rev-parse --show-toplevel', cwd);
}

/**
 * Retorna o contexto do workspace atual.
 *
 * RF-054: resultado cacheado por `CONTEXT_CACHE_TTL_MS` para evitar overhead de `execSync` em chamadas repetidas (ex: a
 * cada turno do REPL). Cache é invalidado automaticamente por TTL.
 *
 * @returns {WorkspaceContext}
 */

/** @type {number} */
const CONTEXT_CACHE_TTL_MS = 30_000;

/** @type {{ context: WorkspaceContext; expiresAt: number } | null} */
let _contextCache = null;

export function getWorkspaceContext() {
    const now = Date.now();
    if (_contextCache && _contextCache.expiresAt > now) {
        return _contextCache.context;
    }
    const cwd = process.env['COPILOT_WORKING_DIRECTORY'] ?? process.cwd();
    const gitRoot = detectGitRoot(cwd);
    const currentBranch = gitRoot ? tryExec('git rev-parse --abbrev-ref HEAD', gitRoot) : null;
    const context = { cwd, gitRoot, currentBranch };
    _contextCache = { context, expiresAt: now + CONTEXT_CACHE_TTL_MS };
    return context;
}
