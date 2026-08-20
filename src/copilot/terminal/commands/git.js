// @ts-check
/**
 * src/copilot/terminal/commands/git.js
 *
 * Comando /git do REPL terminal LLM-B. Subcomandos: status, log, diff, branch, pull, stash
 *
 * @module copilot/terminal/commands/git
 * @see EventBus
 */

import {
    gitBranch,
    gitDiff,
    gitLog,
    gitPull,
    gitStash,
    gitStashList,
    gitStatus,
} from '#copilot/bridges';
import {
    renderTerminalDiffPreview,
    renderTerminalPreviewSummary,
    terminalPreviewSummaryRole,
} from '../capabilities/index.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeWrappedRow } from '../state/index.js';

/**
 * @typedef {object} SessionContext
 * @property {(text: string) => void} println
 */

/** @type {Record<string, string>} */
const GIT_STATUS_LABELS = Object.freeze({
    M: 'modificado',
    A: 'adicionado',
    D: 'deletado',
    R: 'renomeado',
    C: 'copiado',
    U: 'conflito',
    '?': 'não rastreado',
    '!': 'ignorado',
});

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {unknown} code
 * @returns {string}
 */
function gitStatusCodeLabel(code) {
    const normalized = typeof code === 'string' ? code.trim() : '';
    return GIT_STATUS_LABELS[normalized] ?? normalized;
}

/**
 * @param {{ xy?: string; label?: string }} entry
 * @returns {string}
 */
function renderGitStatusLabel(entry) {
    const xy = typeof entry.xy === 'string' ? entry.xy.padEnd(2, ' ') : '  ';
    const staged = xy[0] ?? ' ';
    const unstaged = xy[1] ?? ' ';
    if (staged === '?' && unstaged === '?') return 'não rastreado';
    if (staged === '!' && unstaged === '!') return 'ignorado';
    const parts = [];
    if (staged.trim()) parts.push(`stage ${gitStatusCodeLabel(staged)}`);
    if (unstaged.trim()) parts.push(`worktree ${gitStatusCodeLabel(unstaged)}`);
    if (parts.length > 0) return parts.join(' · ');
    return typeof entry.label === 'string' && entry.label ? entry.label.replace(':', ' ') : 'alterado';
}

/**
 * @param {{ xy?: string }} entry
 * @returns {'fileRead' | 'fileWrite' | 'fileEdit' | 'fileDelete' | 'warn'}
 */
function gitStatusRole(entry) {
    const xy = typeof entry.xy === 'string' ? entry.xy : '';
    if (xy.includes('D')) return 'fileDelete';
    if (xy.includes('A') || xy.includes('?')) return 'fileWrite';
    if (xy.includes('U')) return 'warn';
    return 'fileEdit';
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function stringField(value, fallback = '-') {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
}

/**
 * @param {Array<{ xy?: string; path?: string; label?: string }>} entries
 * @returns {string[]}
 */
function renderGitStatusEntries(entries) {
    if (entries.length === 0) return [terminalThemeRow('Working tree', 'limpo', { role: 'success' })];
    return entries.map((entry) =>
        terminalThemeWrappedRow('Arquivo', `${stringField(entry.path)} · ${renderGitStatusLabel(entry)}`, {
            role: gitStatusRole(entry),
            columns: 116,
        }),
    );
}

/**
 * @param {Array<{ abbrevHash?: string; subject?: string; authorName?: string; authorDate?: string; refNames?: string }>} entries
 * @returns {string[]}
 */
function renderGitLogEntries(entries) {
    if (entries.length === 0) return [terminalThemeRow('Git log', 'sem commits', { role: 'muted' })];
    return entries.map((entry) => {
        const refs = stringField(entry.refNames, '');
        return terminalThemeWrappedRow(
            stringField(entry.abbrevHash, 'commit'),
            [stringField(entry.subject, 'sem assunto'), stringField(entry.authorName, ''), stringField(entry.authorDate, ''), refs]
                .filter(Boolean)
                .join(' · '),
            { role: 'command', columns: 116, width: 12 },
        );
    });
}

/**
 * @param {Array<{ name?: string; current?: boolean; upstream?: string; lastCommit?: string }>} branches
 * @returns {string[]}
 */
function renderGitBranches(branches) {
    if (branches.length === 0) return [terminalThemeRow('Branches', 'nenhuma branch', { role: 'muted' })];
    return branches.map((branch) =>
        terminalThemeWrappedRow(
            'Branch',
            [
                stringField(branch.name),
                branch.current ? 'atual' : null,
                branch.upstream ? `upstream ${branch.upstream}` : null,
                branch.lastCommit ? `último ${branch.lastCommit}` : null,
            ]
                .filter(Boolean)
                .join(' · '),
            { role: branch.current ? 'success' : 'command', columns: 116 },
        ),
    );
}

/**
 * Handler do comando /git <subcomando> [args…].
 *
 * Subcomandos: status, log [n] [--oneline], diff [--staged] [file], branch, pull, stash [list|pop|drop]
 *
 * @param {SessionContext} ctx
 * @param {string[]} args - Argumentos após "/git"
 * @returns {Promise<void>}
 */
export async function cmdGit({ println }, args) {
    const sub = args[0]?.toLowerCase() ?? '';

    if (sub === 'status' || sub === 'st' || sub === '') {
        println(terminalThemeRow('Git', 'verificando status', { role: 'muted' }));
        const entries = await gitStatus().catch(() => []);
        println('');
        println(terminalThemeHeadline('tool', 'Git status', [countLabel(entries.length, 'arquivo', 'arquivos')]));
        for (const line of renderGitStatusEntries(entries)) println(line);
        println('');
        return;
    }

    if (sub === 'log') {
        const oneline = args.includes('--oneline') || args.includes('-1');
        const nArg = args.find((a) => /^\d+$/.test(a));
        const n = nArg ? Number(nArg) : 15;
        println(terminalThemeRow('Git', 'buscando log', { role: 'muted' }));
        const entries = await gitLog({ n, oneline }).catch(() => []);
        println('');
        println(terminalThemeHeadline('tool', 'Git log', [`últimos ${entries.length} commits`]));
        for (const line of renderGitLogEntries(entries)) println(line);
        println('');
        return;
    }

    if (sub === 'diff') {
        const staged = args.includes('--staged') || args.includes('--cached');
        const plain = args.includes('--plain') || args.includes('--no-external');
        const file = args.find((a) => !a.startsWith('-') && a !== 'diff');
        println(terminalThemeRow('Git', 'gerando diff', { role: 'muted' }));
        const diff = await gitDiff({ staged, ...(file === undefined ? {} : { file }) }).catch(() => '');
        if (!diff) {
            println(terminalThemeRow('Diff', 'sem diferenças', { role: 'muted' }));
            return;
        }
        const rendered = renderTerminalDiffPreview(diff, { forceJs: plain, lineLimit: 220 });
        println('');
        println(terminalThemeHeadline('tool', 'Git diff', [staged ? 'staged' : 'working tree', file || null]));
        println(
            terminalThemeRow(
                'Preview',
                renderTerminalPreviewSummary(rendered),
                { role: terminalPreviewSummaryRole(rendered) },
            ),
        );
        println(rendered.output);
        return;
    }

    if (sub === 'branch' || sub === 'branches') {
        println(terminalThemeRow('Git', 'buscando branches', { role: 'muted' }));
        const branches = await gitBranch().catch(() => []);
        println('');
        println(terminalThemeHeadline('tool', 'Git branches', [countLabel(branches.length, 'branch', 'branches')]));
        for (const line of renderGitBranches(branches)) println(line);
        println('');
        return;
    }

    if (sub === 'pull') {
        println(terminalThemeRow('Git', 'executando pull', { role: 'muted' }));
        const output = await gitPull().catch((e) => `Erro: ${e.message}`);
        println(terminalThemeRow('Pull', output || 'ok', { role: output.startsWith('Erro') ? 'error' : 'success' }));
        return;
    }

    if (sub === 'stash') {
        const stashSub = args[1]?.toLowerCase() ?? 'push';
        if (stashSub === 'list') {
            const out = await gitStashList().catch(() => '');
            if (!out) {
                println(terminalThemeRow('Stash', 'nenhum stash encontrado', { role: 'muted' }));
                return;
            }
            println('');
            println(terminalThemeHeadline('tool', 'Git stash'));
            for (const s of out.split('\n').filter(Boolean)) println(`  ${s}`);
            println('');
            return;
        }
        const out2 = await gitStash({ pop: stashSub === 'pop' }).catch((e) => `Erro: ${e.message}`);
        println(terminalThemeRow('Stash', out2 || 'ok', { role: out2.startsWith('Erro') ? 'error' : 'success' }));
        return;
    }

    // help / fallback
    println('');
    println(terminalThemeHeadline('tool', '/git', ['Git operacional']));
    /** @type {[string, string][]} */
    const rows = [
        ['Status', '/git status'],
        ['Log', '/git log [n] [--oneline]'],
        ['Diff', '/git diff [--staged] [--plain] [file]'],
        ['Branches', '/git branch'],
        ['Atualizar', '/git pull'],
        ['Stash', '/git stash [list|pop|drop]'],
    ];
    for (const [label, command] of rows) {
        println(terminalThemeRow(label, command, { role: 'command' }));
    }
    println('');
}
