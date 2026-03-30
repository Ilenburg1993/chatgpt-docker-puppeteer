// @ts-check
/**
 * src/copilot/terminal/commands/gh.js
 *
 * Comando /gh do REPL terminal LLM-B. Subcomandos: issue, pr, run/ci, release, search, status, api
 *
 * @module copilot/terminal/commands/gh
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
} from '../../bridges/gh-bridge.js';

/**
 * @typedef {object} SessionContext
 * @property {(text: string) => void} println
 */

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
        println('\x1b[90m  Buscando issues…\x1b[0m');
        const issueResult = await listIssues({ state: /** @type {any} */ (stateArg), label }).catch(() => ({
            items: [],
            hasMore: false,
            page: 1,
            perPage: 15,
        }));
        const issues = issueResult.items;
        if (!issues.length) {
            println('\x1b[90m  Nenhuma issue encontrada.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mIssues\x1b[0m \x1b[90m(${stateArg})\x1b[0m`);
        println(formatIssueList(issues));
        return;
    }

    if (action === 'create') {
        const title = args.slice(2).join(' ');
        if (!title) {
            println('\x1b[90m  Uso: /gh issue create <título>\x1b[0m');
            return;
        }
        println('\x1b[90m  Criando issue…\x1b[0m');
        const result = await createIssue(title, '').catch(() => null);
        if (result?.url) println(`\x1b[32m  ✓ Issue criada: ${result.url}\x1b[0m`);
        else println('\x1b[31m  Falha ao criar issue.\x1b[0m');
        return;
    }

    if (action === 'close') {
        const n = Number(args[2]);
        if (!n) {
            println('\x1b[90m  Uso: /gh issue close <número>\x1b[0m');
            return;
        }
        const ok = await closeIssue(n).catch(() => false);
        println(ok ? `\x1b[32m  ✓ Issue #${n} fechada.\x1b[0m` : `\x1b[31m  Falha ao fechar #${n}.\x1b[0m`);
        return;
    }

    if (action === 'comment') {
        const n = Number(args[2]);
        const body = args.slice(3).join(' ');
        if (!n || !body) {
            println('\x1b[90m  Uso: /gh issue comment <n> <texto>\x1b[0m');
            return;
        }
        const ok = await commentIssue(n, body).catch(() => false);
        println(ok ? `\x1b[32m  ✓ Comentário adicionado em #${n}.\x1b[0m` : `\x1b[31m  Falha ao comentar.\x1b[0m`);
        return;
    }

    // action = número → ver detalhes
    const n = Number(action);
    if (n) {
        println('\x1b[90m  Buscando issue…\x1b[0m');
        const issue = await viewIssue(n).catch(() => null);
        if (!issue) {
            println(`\x1b[31m  Issue #${n} não encontrada.\x1b[0m`);
            return;
        }
        println(`\n  \x1b[36m#${issue.number}\x1b[0m \x1b[1m${issue.title}\x1b[0m  \x1b[90m[${issue.state}]\x1b[0m`);
        println(`  URL: \x1b[34m${issue.url}\x1b[0m`);
        if (issue.labels?.length) println(`  Labels: ${issue.labels.map((l) => l.name).join(', ')}`);
        println(`  Autor: ${issue.author?.login}  ·  Comentários: ${issue.comments}`);
        if (issue.body) {
            println('  ─────────────────────────────────────────────');
            for (const line of issue.body.slice(0, 800).split('\n')) println(`  ${line}`);
            if (issue.body.length > 800) println('  \x1b[90m…(truncado)\x1b[0m');
        }
        println('');
        return;
    }

    println('\x1b[90m  Uso: /gh issue [list|<n>|create|close|comment] [args…]\x1b[0m');
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
        println('\x1b[90m  Buscando PRs…\x1b[0m');
        const prResult = await listPrs({ state: /** @type {any} */ (stateArg) }).catch(() => ({
            items: [],
            hasMore: false,
            page: 1,
            perPage: 15,
        }));
        const prs = prResult.items;
        if (!prs.length) {
            println('\x1b[90m  Nenhum PR encontrado.\x1b[0m');
            return;
        }
        println(`\n  \x1b[36mPull Requests\x1b[0m \x1b[90m(${stateArg})\x1b[0m`);
        println(formatPrList(prs));
        return;
    }

    if (action === 'diff') {
        const n = Number(args[2]);
        if (!n) {
            println('\x1b[90m  Uso: /gh pr diff <número>\x1b[0m');
            return;
        }
        println('\x1b[90m  Buscando diff…\x1b[0m');
        const diff = await diffPr(n).catch(() => '');
        if (!diff) {
            println(`\x1b[90m  Sem diff para PR #${n}.\x1b[0m`);
            return;
        }
        const lines = diff.split('\n').slice(0, 120);
        for (const l of lines) {
            if (l.startsWith('+')) println(`\x1b[32m  ${l}\x1b[0m`);
            else if (l.startsWith('-')) println(`\x1b[31m  ${l}\x1b[0m`);
            else println(`  ${l}`);
        }
        if (diff.split('\n').length > 120) println('  \x1b[90m…(diff truncado a 120 linhas)\x1b[0m');
        return;
    }

    // action = número
    const n = Number(action);
    if (n) {
        println('\x1b[90m  Buscando PR…\x1b[0m');
        const pr = await viewPr(n).catch(() => null);
        if (!pr) {
            println(`\x1b[31m  PR #${n} não encontrado.\x1b[0m`);
            return;
        }
        const draftTag = pr.isDraft ? '\x1b[33m[DRAFT]\x1b[0m ' : '';
        println(`\n  \x1b[36m#${pr.number}\x1b[0m ${draftTag}\x1b[1m${pr.title}\x1b[0m  \x1b[90m[${pr.state}]\x1b[0m`);
        println(`  Branch: ${pr.headRefName}  ·  Autor: ${pr.author?.login}`);
        println(`  URL: \x1b[34m${pr.url}\x1b[0m`);
        if (pr.body) {
            println('  ─────────────────────────────────────────────');
            for (const line of pr.body.slice(0, 600).split('\n')) println(`  ${line}`);
        }
        println('');
        return;
    }

    println('\x1b[90m  Uso: /gh pr [list|<n>|diff <n>] [args…]\x1b[0m');
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
        println('\x1b[90m  Buscando CI runs…\x1b[0m');
        const runResult = await listRuns({ limit }).catch(() => ({
            items: [],
            hasMore: false,
            page: 1,
            perPage: 10,
        }));
        const runs = runResult.items;
        if (!runs.length) {
            println('\x1b[90m  Nenhum run encontrado.\x1b[0m');
            return;
        }
        println('\n  \x1b[36mCI Runs\x1b[0m');
        println(formatRunList(runs));
        return;
    }

    const runId = action;
    if (runId && runId !== 'list') {
        println('\x1b[90m  Buscando run…\x1b[0m');
        const run = /** @type {any} */ (await viewRun(runId).catch(() => null));
        if (!run) {
            println(`\x1b[31m  Run "${runId}" não encontrado.\x1b[0m`);
            return;
        }
        println(`\n  \x1b[36mRun #${run.databaseId ?? runId}\x1b[0m  ${run.displayTitle ?? run.name}`);
        println(`  Status: ${run.status}  ·  Conclusão: ${run.conclusion ?? '…'}`);
        println(`  Branch: ${run.headBranch}  ·  Workflow: ${run.workflowName}`);
        println(`  URL: \x1b[34m${run.url}\x1b[0m`);
        println('');
        return;
    }

    println('\x1b[90m  Uso: /gh run [list|<runId>]\x1b[0m');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function handleRelease(println) {
    println('\x1b[90m  Buscando releases…\x1b[0m');
    const releases = await listReleases().catch(() => []);
    if (!releases.length) {
        println('\x1b[90m  Nenhuma release encontrada.\x1b[0m');
        return;
    }
    println('\n  \x1b[36mReleases\x1b[0m');
    println(formatReleaseList(releases));
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handleSearch(println, args) {
    const query = args.slice(1).join(' ');
    if (!query) {
        println('\x1b[90m  Uso: /gh search <query>\x1b[0m');
        return;
    }
    println('\x1b[90m  Buscando…\x1b[0m');
    const results = await searchIssues(query, { limit: 10 }).catch(() => []);
    if (!results.length) {
        println('\x1b[90m  Nenhum resultado.\x1b[0m');
        return;
    }
    println(`\n  \x1b[36mResultados para:\x1b[0m "${query}"`);
    for (const r of /** @type {any[]} */ (results)) {
        const typeLabel = r.isPullRequest ? '\x1b[34mPR\x1b[0m' : '\x1b[36missue\x1b[0m';
        println(`  ${typeLabel}  #${r.number}  ${r.title}  \x1b[90m[${r.state}]\x1b[0m`);
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @returns {Promise<void>}
 */
async function handleStatus(println) {
    println('\x1b[90m  Verificando status gh…\x1b[0m');
    const status = await ghGetStatus().catch(() => null);
    if (!status) {
        println('\x1b[90m  Status gh não disponível.\x1b[0m');
        return;
    }
    println(`\n  \x1b[36mGitHub Status\x1b[0m\n  ${status}\n`);
}

/**
 * @param {(text: string) => void} println
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function handleApi(println, args) {
    const endpoint = args[1];
    if (!endpoint) {
        println('\x1b[90m  Uso: /gh api <endpoint>  ex: /gh api /user\x1b[0m');
        return;
    }
    println('\x1b[90m  Chamando gh api…\x1b[0m');
    const data = await ghRawApi(endpoint).catch(() => null);
    if (data === null) {
        println('\x1b[31m  Falha na chamada a gh api.\x1b[0m');
        return;
    }
    const out = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    for (const line of out.split('\n').slice(0, 80)) println(`  ${line}`);
    if (out.split('\n').length > 80) println('  \x1b[90m…(truncado)\x1b[0m');
}

/** @param {(text: string) => void} println */
function printHelp(println) {
    println(`
  \x1b[36m/gh — GitHub CLI\x1b[0m
  ─────────────────────────────────────────────────────────────────
  \x1b[33m/gh issue list [open|closed|all] [label]\x1b[0m  — lista issues
  \x1b[33m/gh issue <n>\x1b[0m                             — detalhe de issue
  \x1b[33m/gh issue create <título>\x1b[0m                 — cria issue
  \x1b[33m/gh issue close <n>\x1b[0m                       — fecha issue
  \x1b[33m/gh issue comment <n> <texto>\x1b[0m             — comenta issue
  \x1b[33m/gh pr list [open|closed|merged]\x1b[0m          — lista PRs
  \x1b[33m/gh pr <n>\x1b[0m                                — detalhe de PR
  \x1b[33m/gh pr diff <n>\x1b[0m                           — diff de PR
  \x1b[33m/gh run list [limit]\x1b[0m                      — lista CI runs
  \x1b[33m/gh run <id>\x1b[0m                              — detalhe de run
  \x1b[33m/gh release list\x1b[0m                          — lista releases
  \x1b[33m/gh search <query>\x1b[0m                        — busca issues/prs
  \x1b[33m/gh status\x1b[0m                                — status geral da conta
  \x1b[33m/gh api <endpoint>\x1b[0m                        — chamada raw à API
  ─────────────────────────────────────────────────────────────────
`);
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
