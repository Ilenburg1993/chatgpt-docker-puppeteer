// @ts-check
/**
 * src/copilot/terminal/commands/gh.js
 *
 * Comando /gh do REPL terminal LLM-B. Subcomandos: issue, pr, run/ci, release, search, status, api
 *
 * @module copilot/terminal/commands/gh
 * @see EventBus
 */

import {
    closeIssue,
    commentIssue,
    createIssue,
    diffPr,
    formatIssueList,
    formatPrList,
    formatReleaseList,
    formatRunList,
    getStatus as ghGetStatus,
    rawApi as ghRawApi,
    listIssues,
    listPrs,
    listReleases,
    listRuns,
    searchIssues,
    viewIssue,
    viewPr,
    viewRun,
} from '#copilot/bridges';
import {
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeRows,
    terminalThemeText,
} from '../state/index.js';

/**
 * @typedef {object} SessionContext
 * @property {(text: string) => void} println
 */

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeGhTerminalOutput(text) {
    return text
        .replace(ANSI_ESCAPE_PATTERN, '')
        .replace(/\[DRAFT\]/gu, 'Rascunho')
        .replace(/[ \t]+\n/gu, '\n');
}

/**
 * @param {(text: string) => void} println
 * @param {string} text
 * @returns {void}
 */
function printGhBridgeOutput(println, text) {
    println(normalizeGhTerminalOutput(text));
}

/**
 * @param {(text: string) => void} println
 * @param {string} text
 * @returns {void}
 */
function printGhStatus(println, text) {
    println(terminalThemeRow('GitHub', text, { role: 'muted' }));
}

/**
 * @param {(text: string) => void} println
 * @param {string} usage
 * @returns {void}
 */
function printGhUsage(println, usage) {
    println(terminalThemeRow('Uso', usage, { role: 'command' }));
}

/**
 * @param {(text: string) => void} println
 * @param {string} title
 * @param {Array<string | null | undefined | false>} [details=[]]
 * @returns {void}
 */
function printGhSection(println, title, details = []) {
    println('');
    println(terminalThemeHeadline('tool', title, details));
}

/**
 * @param {(text: string) => void} println
 * @param {string} label
 * @param {string} value
 * @param {import('../state/ui-theme.js').TerminalThemeRole} [role='muted']
 * @returns {void}
 */
function printGhRow(println, label, value, role = 'muted') {
    println(terminalThemeRow(label, value, { role }));
}

// ─── Subcommand handlers ─────────────────────────────────────────────────────

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handleIssue(println, args) {
    const action = args[1]?.toLowerCase() ?? 'list';

    if (action === 'list' || action === 'ls') {
        const stateArg = args[2] ?? 'open';
        const label = args[3];
        printGhStatus(println, 'buscando issues');
        const issueResult = await listIssues({
            state: /** @type {'open' | 'closed' | 'all'} */ (stateArg),
            label,
        }).catch(() => ({
            items: [],
            hasMore: false,
            page: 1,
            perPage: 15,
        }));
        const issues = issueResult.items;
        if (!issues.length) {
            printGhRow(println, 'Issues', 'nenhuma encontrada');
            return;
        }
        printGhSection(println, 'Issues', [stateArg]);
        printGhBridgeOutput(println, formatIssueList(issues));
        return;
    }

    if (action === 'create') {
        const title = args.slice(2).join(' ');
        if (!title) {
            printGhUsage(println, '/gh issue create <título>');
            return;
        }
        printGhStatus(println, 'criando issue');
        const result = await createIssue(title, '').catch(() => null);
        if (result?.url) printGhRow(println, 'Issue', `criada · ${result.url}`, 'success');
        else printGhRow(println, 'Issue', 'falha ao criar', 'error');
        return;
    }

    if (action === 'close') {
        const n = Number(args[2]);
        if (!n) {
            printGhUsage(println, '/gh issue close <número>');
            return;
        }
        const ok = await closeIssue(n).catch(() => false);
        printGhRow(println, 'Issue', ok ? `#${n} fechada` : `falha ao fechar #${n}`, ok ? 'success' : 'error');
        return;
    }

    if (action === 'comment') {
        const n = Number(args[2]);
        const body = args.slice(3).join(' ');
        if (!n || !body) {
            printGhUsage(println, '/gh issue comment <n> <texto>');
            return;
        }
        const ok = await commentIssue(n, body).catch(() => false);
        printGhRow(println, 'Comentário', ok ? `adicionado em #${n}` : 'falha ao comentar', ok ? 'success' : 'error');
        return;
    }

    // action = número → ver detalhes
    const n = Number(action);
    if (n) {
        printGhStatus(println, 'buscando issue');
        const issue = await viewIssue(n).catch(() => null);
        if (!issue) {
            printGhRow(println, 'Issue', `#${n} não encontrada`, 'error');
            return;
        }
        printGhSection(println, `Issue #${issue.number}`, [issue.state]);
        printGhRow(println, 'Título', issue.title, 'accent');
        printGhRow(println, 'URL', issue.url, 'command');
        if (issue.labels?.length) printGhRow(println, 'Labels', issue.labels.map((l) => l.name).join(', '));
        printGhRow(println, 'Resumo', `autor ${issue.author?.login ?? '-'} · comentários ${issue.comments ?? 0}`);
        if (issue.body) {
            println(terminalThemeDivider(45));
            for (const line of issue.body.slice(0, 800).split('\n')) println(`  ${line}`);
            if (issue.body.length > 800) printGhRow(println, 'Prévia', 'truncada em 800 caracteres');
        }
        println('');
        return;
    }

    printGhUsage(println, '/gh issue [list|<n>|create|close|comment] [args…]');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handlePr(println, args) {
    const action = args[1]?.toLowerCase() ?? 'list';

    if (action === 'list' || action === 'ls') {
        const stateArg = args[2] ?? 'open';
        printGhStatus(println, 'buscando PRs');
        const prResult = await listPrs({ state: /** @type {'open' | 'closed' | 'merged' | 'all'} */ (stateArg) }).catch(
            () => ({
                items: [],
                hasMore: false,
                page: 1,
                perPage: 15,
            }),
        );
        const prs = prResult.items;
        if (!prs.length) {
            printGhRow(println, 'PRs', 'nenhum encontrado');
            return;
        }
        printGhSection(println, 'Pull Requests', [stateArg]);
        printGhBridgeOutput(println, formatPrList(prs));
        return;
    }

    if (action === 'diff') {
        const n = Number(args[2]);
        if (!n) {
            printGhUsage(println, '/gh pr diff <número>');
            return;
        }
        printGhStatus(println, 'buscando diff');
        const diff = await diffPr(n).catch(() => '');
        if (!diff) {
            printGhRow(println, 'Diff', `sem alterações para PR #${n}`);
            return;
        }
        const lines = diff.split('\n').slice(0, 120);
        for (const l of lines) {
            if (l.startsWith('+')) println(`  ${terminalThemeText('success', l)}`);
            else if (l.startsWith('-')) println(`  ${terminalThemeText('error', l)}`);
            else println(`  ${l}`);
        }
        if (diff.split('\n').length > 120) printGhRow(println, 'Diff', 'truncado em 120 linhas');
        return;
    }

    // action = número
    const n = Number(action);
    if (n) {
        printGhStatus(println, 'buscando PR');
        const pr = await viewPr(n).catch(() => null);
        if (!pr) {
            printGhRow(println, 'PR', `#${n} não encontrado`, 'error');
            return;
        }
        const draftTag = pr.isDraft ? 'Rascunho ' : '';
        printGhSection(println, `PR #${pr.number}`, [pr.state, pr.isDraft ? 'rascunho' : null]);
        printGhRow(println, 'Título', `${draftTag}${pr.title}`, 'accent');
        printGhRow(println, 'Branch', `${pr.headRefName} · autor ${pr.author?.login ?? '-'}`);
        printGhRow(println, 'URL', pr.url, 'command');
        if (pr.body) {
            println(terminalThemeDivider(45));
            for (const line of pr.body.slice(0, 600).split('\n')) println(`  ${line}`);
        }
        println('');
        return;
    }

    printGhUsage(println, '/gh pr [list|<n>|diff <n>] [args…]');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handleRun(println, args) {
    const action = args[1]?.toLowerCase() ?? 'list';

    if (action === 'list' || action === 'ls') {
        const limit = Number(args[2]) || 10;
        printGhStatus(println, 'buscando execuções de CI');
        const runResult = await listRuns({ limit }).catch(() => ({
            items: [],
            hasMore: false,
            page: 1,
            perPage: 10,
        }));
        const runs = runResult.items;
        if (!runs.length) {
            printGhRow(println, 'CI', 'nenhuma execução encontrada');
            return;
        }
        printGhSection(println, 'Execuções de CI');
        printGhBridgeOutput(println, formatRunList(runs));
        return;
    }

    const runId = action;
    if (runId && runId !== 'list') {
        printGhStatus(println, 'buscando execução de CI');
        const run = /** @type {Record<string, unknown> | null} */ (await viewRun(runId).catch(() => null));
        if (!run) {
            printGhRow(println, 'CI', `execução ${runId} não encontrada`, 'error');
            return;
        }
        printGhSection(println, `CI #${run['databaseId'] ?? runId}`);
        printGhRow(println, 'Título', String(run['displayTitle'] ?? run['name'] ?? '-'), 'accent');
        printGhRow(println, 'Estado', `${run['status'] ?? '-'} · conclusão ${run['conclusion'] ?? 'pendente'}`);
        printGhRow(println, 'Origem', `${run['headBranch'] ?? '-'} · workflow ${run['workflowName'] ?? '-'}`);
        printGhRow(println, 'URL', String(run['url'] ?? '-'), 'command');
        println('');
        return;
    }

    printGhUsage(println, '/gh run [list|<runId>]');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function handleRelease(println) {
    printGhStatus(println, 'buscando releases');
    const releases = await listReleases().catch(() => []);
    if (!releases.length) {
        printGhRow(println, 'Releases', 'nenhuma encontrada');
        return;
    }
    printGhSection(println, 'Releases');
    printGhBridgeOutput(println, formatReleaseList(releases));
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handleSearch(println, args) {
    const query = args.slice(1).join(' ');
    if (!query) {
        printGhUsage(println, '/gh search <query>');
        return;
    }
    printGhStatus(println, 'buscando');
    const results = await searchIssues(query, { limit: 10 }).catch(() => []);
    if (!results.length) {
        printGhRow(println, 'Busca', 'nenhum resultado');
        return;
    }
    printGhSection(println, 'Resultados GitHub', [query]);
    for (const r of /** @type {Record<string, unknown>[]} */ (results)) {
        const typeLabel = r['isPullRequest'] ? 'PR' : 'Issue';
        printGhRow(println, typeLabel, `#${r['number']} · ${r['title']} · ${r['state']}`);
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function handleStatus(println) {
    printGhStatus(println, 'verificando status');
    const status = await ghGetStatus().catch(() => null);
    if (!status) {
        printGhRow(println, 'Status', 'não disponível');
        return;
    }
    printGhSection(println, 'Status GitHub');
    printGhBridgeOutput(println, String(status));
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handleApi(println, args) {
    const endpoint = args[1];
    if (!endpoint) {
        printGhUsage(println, '/gh api <endpoint>  ex: /gh api /user');
        return;
    }
    printGhStatus(println, 'chamando gh api');
    const data = await ghRawApi(endpoint).catch(() => null);
    if (data === null) {
        printGhRow(println, 'GitHub API', 'falha na chamada', 'error');
        return;
    }
    const out = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    for (const line of out.split('\n').slice(0, 80)) println(`  ${line}`);
    if (out.split('\n').length > 80) printGhRow(println, 'GitHub API', 'truncado em 80 linhas');
}

/** @param {(text: string) => void} println */
function printHelp(println) {
    println('');
    println(terminalThemeHeadline('tool', '/gh', ['GitHub operacional']));
    println(terminalThemeDivider(64));
    println(
        terminalThemeRows(
            'Issues',
            [
                '/gh issue list [open|closed|all] [label] · lista issues',
                '/gh issue <n> · detalhe de issue',
                '/gh issue create <título> · cria issue',
                '/gh issue close <n> · fecha issue',
                '/gh issue comment <n> <texto> · comenta issue',
            ],
            { role: 'command' },
        ),
    );
    println(
        terminalThemeRows(
            'PRs',
            ['/gh pr list [open|closed|merged] · lista PRs', '/gh pr <n> · detalhe', '/gh pr diff <n> · diff'],
            { role: 'command' },
        ),
    );
    println(
        terminalThemeRows(
            'CI/API',
            [
                '/gh run list [limit] · lista CI',
                '/gh run <id> · detalhe de execução',
                '/gh release list · lista releases',
                '/gh search <query> · busca issues/PRs',
                '/gh status · status da conta',
                '/gh api <endpoint> · chamada raw',
            ],
            { role: 'command' },
        ),
    );
    println(terminalThemeDivider(64));
    println('');
}

// ─── Dispatch table ──────────────────────────────────────────────────────────

/** @type {Record<string, (println: (text: string) => void, args: string[]) => Promise<void>>} */
const SUBCOMMAND_HANDLERS = {
    issue: handleIssue,
    issues: handleIssue,
    pr: handlePr,
    prs: handlePr,
    run: handleRun,
    runs: handleRun,
    ci: handleRun,
    release: (println) => handleRelease(println),
    releases: (println) => handleRelease(println),
    search: handleSearch,
    status: (println) => handleStatus(println),
    st: (println) => handleStatus(println),
    api: handleApi,
};

/**
 * Handler do comando /gh <subcomando> [args…].
 *
 * Subcomandos: issue [list|<n>|create|close|comment], pr [list|<n>|diff <n>], run|ci [list|<id>], release [list],
 * search <query>, status, api <endpoint>
 *
 * @param {SessionContext} ctx
 * @param {string[]} args - Argumentos após "/gh"
 * @returns {Promise<void>}
 */
export async function cmdGh({ println }, args) {
    const sub = args[0]?.toLowerCase() ?? '';
    const handler = SUBCOMMAND_HANDLERS[sub];
    if (handler) {
        await handler(println, args);
        return;
    }
    printHelp(println);
}

export const __test__ = {
    normalizeGhTerminalOutput,
};
