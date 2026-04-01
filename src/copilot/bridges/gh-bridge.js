// @ts-check
/**
 * @module copilot/gh-bridge
 * @file GitHub CLI Bridge — encapsula chamadas ao `gh` CLI.
 *
 *   Usa `execFile` (não `exec`) para evitar shell injection. Retorna objetos JS estruturados para uso no terminal REPL e
 *   HTTP endpoints.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Timeout padrão para chamadas ao gh CLI (ms). */
const DEFAULT_TIMEOUT_MS = parseInt(process.env['LLM_B_GH_TIMEOUT_MS'] ?? '15000', 10);

/** Repo padrão override (ex: "owner/repo"). Auto-detect se vazio. */
const ENV_REPO = process.env['LLM_B_GH_DEFAULT_REPO'] ?? '';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Executa gh CLI com args, retorna stdout como string.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.lenient] - se true, retorna string vazia em caso de erro
 * @returns {Promise<string>}
 */
async function runGh(args, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { stdout } = await execFileAsync('gh', args, {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024, // 4 MB
    });
    return stdout.trim();
}

/**
 * Executa gh CLI e parseia saída como JSON.
 *
 * @param {string[]} args
 * @param {object} [opts]
 * @returns {Promise<any>}
 */
async function runGhJson(args, opts = {}) {
    const raw = await runGh(args, opts);
    if (!raw) return null;
    return JSON.parse(raw);
}

/**
 * Formata data ISO para string legível relativa ou absoluta.
 *
 * @param {string} isoDate
 * @returns {string}
 */
function fmtDate(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `há ${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `há ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `há ${days}d`;
    return d.toLocaleDateString('pt-BR');
}

/**
 * Retorna ícone ANSI colorido de status de CI run.
 *
 * @param {string} status
 * @param {string | null} conclusion
 * @returns {string}
 */
function runIcon(status, conclusion) {
    if (status === 'completed') {
        if (conclusion === 'success') return '✅';
        if (conclusion === 'failure') return '❌';
        if (conclusion === 'cancelled') return '🚫';
        if (conclusion === 'skipped') return '⏭️';
        if (conclusion === 'timed_out') return '⏱️';
        return '⚠️';
    }
    if (status === 'in_progress') return '⏳';
    if (status === 'queued') return '🔲';
    return '❓';
}

/**
 * Extrai args de repo se ENV_REPO estiver definido.
 *
 * @returns {string[]}
 */
function repoArgs() {
    return ENV_REPO ? ['--repo', ENV_REPO] : [];
}

/**
 * Aplica paginação client-side sobre um array já carregado do gh CLI. Padroniza o cálculo de fetchLimit, offset e
 * hasMore nos três listadores.
 *
 * @template T
 * @param {T[]} all - Array completo retornado pelo gh CLI
 * @param {{ page: number; pageSize: number }} pager
 * @returns {{ items: T[]; hasMore: boolean; page: number; perPage: number }}
 */
function slicePage(all, { page, pageSize }) {
    const offset = (page - 1) * pageSize;
    return {
        items: all.slice(offset, offset + pageSize),
        hasMore: all.length > offset + pageSize,
        page,
        perPage: pageSize,
    };
}

/**
 * Calcula o limite de busca para paginação client-side. Busca um item a mais (pageSize * page + 1) para detectar
 * hasMore.
 *
 * @param {{ page: number; pageSize: number }} pager
 * @returns {number}
 */
function calcFetchLimit({ page, pageSize }) {
    return Math.min(pageSize * page + 1, 1000);
}

// ---------------------------------------------------------------------------
// Repo info
// ---------------------------------------------------------------------------

/**
 * Detecta o repo padrão via `gh repo view`.
 *
 * @returns {Promise<string>} owner/repo ou string vazia se falhar
 */
export async function getDefaultRepo() {
    try {
        const data = await runGhJson(['repo', 'view', '--json', 'nameWithOwner', ...repoArgs()]);
        return data?.nameWithOwner ?? '';
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

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
 * Lista issues do repositório.
 *
 * GAP-N11/UPG-N21 (fix): suporte a paginação via page+perPage; retorna hasMore.
 *
 * @param {object} [opts]
 * @param {'open' | 'closed' | 'all'} [opts.state]
 * @param {string} [opts.label]
 * @param {number} [opts.limit]
 * @param {number} [opts.page] - Página (1-based). Requer perPage.
 * @param {number} [opts.perPage] - Itens por página (default: 15, max: 100).
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

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

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
 * Lista pull requests.
 *
 * @param {object} [opts]
 * @param {'open' | 'closed' | 'merged' | 'all'} [opts.state]
 * @param {number} [opts.limit]
 * @param {number} [opts.page] - Página (1-based).
 * @param {number} [opts.perPage] - Itens por página (default: 15, max: 100).
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

// ---------------------------------------------------------------------------
// Actions / CI Runs
// ---------------------------------------------------------------------------

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
 * @param {number} [opts.page] - Página (1-based).
 * @param {number} [opts.perPage] - Itens por página (default: 15, max: 100).
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
        return await runGhJson([
            'run',
            'view',
            String(runId),
            '--json',
            'name,status,conclusion,jobs,url,event,headBranch,createdAt',
            ...repoArgs(),
        ]);
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
 * @param {number} [opts.maxAttempts] - Limite de polls (default: 360 ≈ 30 min a 5 s/poll)
 * @returns {Promise<object | null>} run final, ou null se timeout/não encontrado
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

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

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
        return (
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
        return await runGhJson([
            'release',
            'view',
            tag,
            '--json',
            'tagName,name,body,publishedAt,assets',
            ...repoArgs(),
        ]);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

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
        return (
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

// ---------------------------------------------------------------------------
// Status / Notifications
// ---------------------------------------------------------------------------

/**
 * Retorna notificações do GitHub. Pode retornar null se o token não tiver permissão (403).
 *
 * @returns {Promise<string | null>}
 */
export async function getStatus() {
    try {
        const out = await runGh(['status'], { lenient: true });
        return out || null;
    } catch (err) {
        // Gracefully handle 403 / no permission
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('403') || msg.includes('Unauthorized') || msg.includes('scope')) {
            return 'NOTIF_403';
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Raw API
// ---------------------------------------------------------------------------

/**
 * Faz chamada direta ao GitHub API via `gh api`.
 *
 * @param {string} endpoint - ex: "/repos/{owner}/{repo}/issues"
 * @param {object} [opts]
 * @param {'GET' | 'POST' | 'PATCH' | 'DELETE'} [opts.method]
 * @param {object} [opts.body]
 * @returns {Promise<any>}
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
        return await runGhJson(args);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Formatters (para uso no REPL)
// ---------------------------------------------------------------------------

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

/**
 * Formata lista de releases em string legível para o terminal.
 *
 * @param {object[]} releases
 * @returns {string}
 */
export function formatReleaseList(releases) {
    if (!releases.length) return '  (nenhuma release encontrada)';
    const lines = /** @type {any[]} */ (releases).map((r) => {
        const pre = r.isPrerelease ? ' [pre]' : '';
        const date = fmtDate(r.publishedAt);
        return `  ${r.tagName}${pre}  ${r.name ?? ''}  ${date}`;
    });
    return lines.join('\n');
}

export { fmtDate, runIcon };
