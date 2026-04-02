// @ts-check
/**
 * src/copilot/bridges/gh/issues.js
 *
 * GitHub CLI bridge — operações de issues.
 *
 * @module copilot/bridges/gh/issues
 */

import { calcFetchLimit, fmtDate, repoArgs, runGh, runGhJson, slicePage } from './shared.js';

/**
 * @typedef {object} IssueItem
 * @property {number} number
 * @property {string} title
 * @property {string} state
 * @property {{ name: string }[]} labels
 * @property {{ login: string }} author
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} IssueDetail
 * @property {number} number
 * @property {string} title
 * @property {string} body
 * @property {string} state
 * @property {{ name: string }[]} labels
 * @property {{ login: string }} author
 * @property {string} url
 * @property {number} comments
 */

/**
 * Lista issues do repositório.
 *
 * @param {object} [opts]
 * @param {'open' | 'closed' | 'all'} [opts.state]
 * @param {string} [opts.label]
 * @param {number} [opts.limit]
 * @param {number} [opts.page]
 * @param {number} [opts.perPage]
 * @returns {Promise<{ items: IssueItem[]; hasMore: boolean; page: number; perPage: number }>}
 */
export async function listIssues(opts = {}) {
    const { state = 'open', label, page = 1, perPage } = opts;
    const pageSize = Math.min(perPage ?? opts.limit ?? 15, 100);
    const pager = { page, pageSize };
    const args = [
        'issue',
        'list',
        '--json',
        'number,title,state,labels,author,createdAt,updatedAt',
        '--limit',
        String(calcFetchLimit(pager)),
        '--state',
        state,
        ...repoArgs(),
    ];
    if (label) args.push('--label', label);
    try {
        const all = /** @type {IssueItem[]} */ ((await runGhJson(args)) ?? []);
        return slicePage(all, pager);
    } catch {
        return { items: [], hasMore: false, page, perPage: pageSize };
    }
}

/**
 * Visualiza uma issue completa.
 *
 * @param {number} number
 * @returns {Promise<IssueDetail | null>}
 */
export async function viewIssue(number) {
    try {
        return await runGhJson([
            'issue',
            'view',
            String(number),
            '--json',
            'number,title,body,state,labels,author,comments,url,createdAt',
            ...repoArgs(),
        ]);
    } catch {
        return null;
    }
}

/**
 * Cria uma issue.
 *
 * @param {string} title
 * @param {string} body
 * @param {object} [opts]
 * @param {string[]} [opts.labels]
 * @param {string[]} [opts.assignees]
 * @returns {Promise<{ url: string } | null>}
 */
export async function createIssue(title, body, opts = {}) {
    const { labels = [], assignees = [] } = opts;
    const args = ['issue', 'create', '--title', title, '--body', body, '--json', 'url', ...repoArgs()];
    for (const l of labels) args.push('--label', l);
    for (const a of assignees) args.push('--assignee', a);
    try {
        return await runGhJson(args);
    } catch {
        return null;
    }
}

/**
 * Fecha uma issue.
 *
 * @param {number} number
 * @param {'completed' | 'not planned'} [reason]
 * @returns {Promise<boolean>}
 */
export async function closeIssue(number, reason = 'completed') {
    try {
        await runGh(['issue', 'close', String(number), '--reason', reason, ...repoArgs()]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Adiciona comentário em uma issue.
 *
 * @param {number} number
 * @param {string} body
 * @returns {Promise<boolean>}
 */
export async function commentIssue(number, body) {
    try {
        await runGh(['issue', 'comment', String(number), '--body', body, ...repoArgs()]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Busca issues/PRs pelo texto.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<object[]>}
 */
export async function searchIssues(query, opts = {}) {
    const { limit = 15 } = opts;
    try {
        return (
            (await runGhJson([
                'search',
                'issues',
                query,
                '--json',
                'number,title,repository,state,url,author,createdAt',
                '--limit',
                String(limit),
                ...repoArgs(),
            ])) ?? []
        );
    } catch {
        return [];
    }
}

/**
 * Formata lista de issues em string legível para o terminal.
 *
 * @param {IssueItem[]} issues
 * @returns {string}
 */
export function formatIssueList(issues) {
    if (!issues.length) return '  (nenhuma issue encontrada)';
    const lines = issues.map((i) => {
        const labelStr = i.labels?.map((l) => `[${l.name}]`).join(' ') ?? '';
        const author = i.author?.login ?? '?';
        const date = fmtDate(i.updatedAt ?? i.createdAt);
        const state = i.state === 'open' ? '\x1b[32mopen\x1b[0m' : '\x1b[31mclosed\x1b[0m';
        return `  #${String(i.number).padEnd(5)} [${state}]  ${i.title.substring(0, 50)}  ${labelStr}  por ${author}  ${date}`;
    });
    return lines.join('\n');
}
