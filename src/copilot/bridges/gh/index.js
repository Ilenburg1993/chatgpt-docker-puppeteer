// @ts-check
/**
 * src/copilot/bridges/gh/index.js
 *
 * Barrel re-export do GitHub CLI bridge + funções utilitárias que não pertencem a domínio específico.
 *
 * @module copilot/bridges/gh
 * @see EventBus
 */

import { toError } from '#copilot/core/error-handlers';
import { fmtDate, repoArgs, runGh, runGhJson } from './shared.js';

// Re-export domínios
export { cancelRun, formatRunList, listRuns, rerunRun, viewRun, watchRun } from './ci.js';
export {
    closeIssue,
    commentIssue,
    createIssue,
    formatIssueList,
    listIssues,
    searchIssues,
    viewIssue,
} from './issues.js';
export { diffPr, formatPrList, listPrs, mergePr, viewPr } from './prs.js';
export { fmtDate, runIcon } from './shared.js';

// ─── Funções utilitárias (repo, status, releases, search, raw API) ───────────

/**
 * Detecta o repo padrão via `gh repo view`.
 *
 * @returns {Promise<string>} owner/repo ou string vazia se falhar
 */
export async function getDefaultRepo() {
    try {
        const data = /** @type {{ nameWithOwner?: string } | null} */ (
            await runGhJson(['repo', 'view', '--json', 'nameWithOwner', ...repoArgs()])
        );
        return data?.nameWithOwner ?? '';
    } catch {
        return '';
    }
}

/**
 * Retorna notificações do GitHub.
 *
 * @returns {Promise<string | null>}
 */
export async function getStatus() {
    try {
        const out = await runGh(['status'], { lenient: true });
        return out || null;
    } catch (err) {
        const msg = toError(err).message;
        if (msg.includes('403') || msg.includes('Unauthorized') || msg.includes('scope')) {
            return 'NOTIF_403';
        }
        return null;
    }
}

/**
 * Faz chamada direta ao GitHub API via `gh api`.
 *
 * @param {string} endpoint
 * @param {object} [opts]
 * @param {'GET' | 'POST' | 'PATCH' | 'DELETE'} [opts.method]
 * @param {object} [opts.body]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function rawApi(endpoint, opts = {}) {
    const { method = 'GET', body } = opts;
    const args = ['api', endpoint, '--method', method];
    if (body) {
        for (const [k, v] of Object.entries(body)) {
            args.push('--field', `${k}=${String(v)}`);
        }
    }
    try {
        return /** @type {Record<string, unknown> | null} */ (await runGhJson(args));
    } catch {
        return null;
    }
}

/**
 * Lista releases recentes.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<object[]>}
 */
export async function listReleases(opts = {}) {
    const { limit = 10 } = opts;
    try {
        return /** @type {object[]} */ (
            (await runGhJson([
                'release',
                'list',
                '--json',
                'tagName,name,isPrerelease,publishedAt',
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
 * Visualiza uma release por tag.
 *
 * @param {string} tag
 * @returns {Promise<object | null>}
 */
export async function viewRelease(tag) {
    try {
        return /** @type {object | null} */ (
            await runGhJson(['release', 'view', tag, '--json', 'tagName,name,body,publishedAt,assets', ...repoArgs()])
        );
    } catch {
        return null;
    }
}

/**
 * Busca código no repositório.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<object[]>}
 */
export async function searchCode(query, opts = {}) {
    const { limit = 10 } = opts;
    try {
        return /** @type {object[]} */ (
            (await runGhJson([
                'search',
                'code',
                query,
                '--json',
                'path,repository,textMatches',
                '--limit',
                String(limit),
            ])) ?? []
        );
    } catch {
        return [];
    }
}

/**
 * Formata lista de releases em string legível para o terminal.
 *
 * @param {object[]} releases
 * @returns {string}
 */
export function formatReleaseList(releases) {
    if (!releases.length) return '  (nenhuma release encontrada)';
    const lines = releases.map((r) => {
        const release = /** @type {Record<string, unknown>} */ (r);
        const pre = release['isPrerelease'] ? ' [pre]' : '';
        const date = fmtDate(/** @type {string} */ (release['publishedAt'] ?? ''));
        return `  ${String(release['tagName'] ?? '')}${pre}  ${String(release['name'] ?? '')}  ${date}`;
    });
    return lines.join('\n');
}
