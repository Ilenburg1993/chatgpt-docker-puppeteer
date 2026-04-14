// @ts-check
/**
 * src/copilot/bridges/gh/ci.js
 *
 * GitHub CLI bridge — operações de CI/Actions runs.
 *
 * @module copilot/bridges/gh/ci
 * @see EventBus
 */

import { calcFetchLimit, fmtDate, repoArgs, runGh, runGhJson, runIcon, slicePage } from './shared.js';

/**
 * @typedef {object} RunItem
 * @property {number} databaseId
 * @property {string} name
 * @property {string} status
 * @property {string | null} conclusion
 * @property {string} event
 * @property {string} createdAt
 * @property {string} headBranch
 */

/**
 * Lista runs de CI recentes.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {string} [opts.branch]
 * @param {number} [opts.page]
 * @param {number} [opts.perPage]
 * @returns {Promise<{ items: RunItem[]; hasMore: boolean; page: number; perPage: number }>}
 */
export async function listRuns(opts = {}) {
    const { branch, page = 1, perPage } = opts;
    const pageSize = Math.min(perPage ?? opts.limit ?? 10, 100);
    const pager = { page, pageSize };
    const args = [
        'run',
        'list',
        '--json',
        'databaseId,name,status,conclusion,event,createdAt,headBranch',
        '--limit',
        String(calcFetchLimit(pager)),
        ...repoArgs(),
    ];
    if (branch) args.push('--branch', branch);
    try {
        const all = /** @type {RunItem[]} */ ((await runGhJson(args)) ?? []);
        return slicePage(all, pager);
    } catch {
        return { items: [], hasMore: false, page, perPage: pageSize };
    }
}

/**
 * Visualiza um run de CI.
 *
 * @param {string | number} runId
 * @returns {Promise<object | null>}
 */
export async function viewRun(runId) {
    try {
        return /** @type {object | null} */ (
            await runGhJson([
                'run',
                'view',
                String(runId),
                '--json',
                'name,status,conclusion,jobs,url,event,headBranch,createdAt',
                ...repoArgs(),
            ])
        );
    } catch {
        return null;
    }
}

/**
 * Observa um run de CI via polling até concluir.
 *
 * @param {string | number} runId
 * @param {(run: RunItem) => void} onUpdate - callback chamado a cada poll
 * @param {object} [opts]
 * @param {number} [opts.intervalMs]
 * @param {number} [opts.maxAttempts]
 * @returns {Promise<object | null>}
 */
export async function watchRun(runId, onUpdate, opts = {}) {
    const { intervalMs = 5000, maxAttempts = 360 } = opts;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const run = /** @type {RunItem | null} */ (await viewRun(runId));
        if (!run) return null;
        onUpdate(run);
        if (run.status === 'completed') return run;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

/**
 * Cancela um run de CI.
 *
 * @param {string | number} runId
 * @returns {Promise<boolean>}
 */
export async function cancelRun(runId) {
    try {
        await runGh(['run', 'cancel', String(runId), ...repoArgs()]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Re-executa um run de CI.
 *
 * @param {string | number} runId
 * @returns {Promise<boolean>}
 */
export async function rerunRun(runId) {
    try {
        await runGh(['run', 'rerun', String(runId), ...repoArgs()]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Formata lista de runs de CI em string legível para o terminal.
 *
 * @param {RunItem[]} runs
 * @returns {string}
 */
export function formatRunList(runs) {
    if (!runs.length) return '  (nenhum run encontrado)';
    const lines = runs.map((r) => {
        const icon = runIcon(r.status, r.conclusion);
        const date = fmtDate(r.createdAt);
        return `  ${icon} #${String(r.databaseId).padEnd(8)} ${r.name?.substring(0, 25) ?? '?'}  ${r.event}→${r.headBranch}  ${date}`;
    });
    return lines.join('\n');
}
