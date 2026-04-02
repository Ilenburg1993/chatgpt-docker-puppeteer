// @ts-check
/**
 * src/copilot/bridges/gh/prs.js
 *
 * GitHub CLI bridge — operações de Pull Requests.
 *
 * @module copilot/bridges/gh/prs
 */

import { calcFetchLimit, fmtDate, repoArgs, runGh, runGhJson, slicePage } from './shared.js';

/**
 * @typedef {object} PrItem
 * @property {number} number
 * @property {string} title
 * @property {string} state
 * @property {string} headRefName
 * @property {{ login: string }} author
 * @property {boolean} isDraft
 * @property {string} createdAt
 * @property {string} mergeable
 */

/**
 * @typedef {object} PrDetail
 * @property {number} number
 * @property {string} title
 * @property {string} body
 * @property {string} state
 * @property {string} headRefName
 * @property {{ login: string }} author
 * @property {string} url
 * @property {boolean} isDraft
 * @property {any[]} statusCheckRollup
 */

/**
 * Lista pull requests.
 *
 * @param {object} [opts]
 * @param {'open' | 'closed' | 'merged' | 'all'} [opts.state]
 * @param {number} [opts.limit]
 * @param {number} [opts.page]
 * @param {number} [opts.perPage]
 * @returns {Promise<{ items: PrItem[]; hasMore: boolean; page: number; perPage: number }>}
 */
export async function listPrs(opts = {}) {
    const { state = 'open', page = 1, perPage } = opts;
    const pageSize = Math.min(perPage ?? opts.limit ?? 15, 100);
    const pager = { page, pageSize };
    const args = [
        'pr',
        'list',
        '--json',
        'number,title,state,headRefName,author,isDraft,createdAt,mergeable',
        '--limit',
        String(calcFetchLimit(pager)),
        '--state',
        state,
        ...repoArgs(),
    ];
    try {
        const all = /** @type {PrItem[]} */ ((await runGhJson(args)) ?? []);
        return slicePage(all, pager);
    } catch {
        return { items: [], hasMore: false, page, perPage: pageSize };
    }
}

/**
 * Visualiza um PR completo.
 *
 * @param {number} number
 * @returns {Promise<PrDetail | null>}
 */
export async function viewPr(number) {
    try {
        return await runGhJson([
            'pr',
            'view',
            String(number),
            '--json',
            'number,title,body,state,headRefName,author,isDraft,url,statusCheckRollup,reviews,mergeable',
            ...repoArgs(),
        ]);
    } catch {
        return null;
    }
}

/**
 * Retorna o diff de um PR como texto.
 *
 * @param {number} number
 * @returns {Promise<string>}
 */
export async function diffPr(number) {
    try {
        return await runGh(['pr', 'diff', String(number), ...repoArgs()]);
    } catch {
        return '';
    }
}

/**
 * Faz merge de um PR.
 *
 * @param {number} number
 * @param {object} [opts]
 * @param {'merge' | 'squash' | 'rebase'} [opts.method]
 * @returns {Promise<boolean>}
 */
export async function mergePr(number, opts = {}) {
    const { method = 'merge' } = opts;
    try {
        const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge';
        await runGh(['pr', 'merge', String(number), flag, '--yes', ...repoArgs()]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Formata lista de PRs em string legível para o terminal.
 *
 * @param {PrItem[]} prs
 * @returns {string}
 */
export function formatPrList(prs) {
    if (!prs.length) return '  (nenhum PR encontrado)';
    const lines = prs.map((pr) => {
        const draft = pr.isDraft ? ' [rascunho]' : '';
        const state = pr.state === 'open' ? '\x1b[32mopen\x1b[0m' : '\x1b[35m' + pr.state + '\x1b[0m';
        const date = fmtDate(pr.createdAt);
        const author = pr.author?.login ?? '?';
        return `  #${String(pr.number).padEnd(5)} [${state}]  ${pr.title.substring(0, 45)}${draft}  ←${pr.headRefName}  ${author}  ${date}`;
    });
    return lines.join('\n');
}
