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
    formatBranch,
    formatLog,
    formatStatus,
    gitBranch,
    gitDiff,
    gitLog,
    gitPull,
    gitStash,
    gitStashList,
    gitStatus,
} from '#copilot/bridges';
import { renderTerminalDiffPreview } from '../capabilities/index.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeRows } from '../state/index.js';

/**
 * @typedef {object} SessionContext
 * @property {(text: string) => void} println
 */

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
        println(terminalThemeHeadline('tool', 'Git status', [`${entries.length} ${entries.length === 1 ? 'arquivo' : 'arquivos'}`]));
        println(formatStatus(entries));
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
        println(formatLog(entries, oneline));
        println('');
        return;
    }

    if (sub === 'diff') {
        const staged = args.includes('--staged') || args.includes('--cached');
        const plain = args.includes('--plain') || args.includes('--no-external');
        const file = args.find((a) => !a.startsWith('-') && a !== 'diff');
        println(terminalThemeRow('Git', 'gerando diff', { role: 'muted' }));
        const diff = await gitDiff({ staged, file }).catch(() => '');
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
                `${rendered.renderer}${rendered.fallbackReason ? ` · fallback: ${rendered.fallbackReason}` : ''}${rendered.truncated ? ' · truncado' : ''}`,
                { role: rendered.renderer === 'delta' ? 'success' : 'muted' },
            ),
        );
        println(rendered.output);
        return;
    }

    if (sub === 'branch' || sub === 'branches') {
        println(terminalThemeRow('Git', 'buscando branches', { role: 'muted' }));
        const branches = await gitBranch().catch(() => []);
        println('');
        println(terminalThemeHeadline('tool', 'Git branches', [`${branches.length}`]));
        println(formatBranch(branches));
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
    println(
        terminalThemeRows(
            'Comandos',
            [
                '/git status',
                '/git log [n] [--oneline]',
                '/git diff [--staged] [--plain] [file]',
                '/git branch',
                '/git pull',
                '/git stash [list|pop|drop]',
            ],
            { role: 'command' },
        ),
    );
    println('');
}
