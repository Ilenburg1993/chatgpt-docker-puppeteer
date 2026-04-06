// @ts-check
/**
 * src/copilot/terminal/commands/git.js
 *
 * Comando /git do REPL terminal LLM-B. Subcomandos: status, log, diff, branch, pull, stash
 *
 * @module copilot/terminal/commands/git
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
} from '#copilot/bridges/git-bridge';

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
        println('\x1b[90m  Verificando status git…\x1b[0m');
        const entries = await gitStatus().catch(() => []);
        println('\n  \x1b[36mGit Status\x1b[0m');
        println(formatStatus(entries));
        println('');
        return;
    }

    if (sub === 'log') {
        const oneline = args.includes('--oneline') || args.includes('-1');
        const nArg = args.find((a) => /^\d+$/.test(a));
        const n = nArg ? Number(nArg) : 15;
        println('\x1b[90m  Buscando log…\x1b[0m');
        const entries = await gitLog({ n, oneline }).catch(() => []);
        println(`\n  \x1b[36mGit Log\x1b[0m \x1b[90m(últimos ${entries.length} commits)\x1b[0m`);
        println(formatLog(entries, oneline));
        println('');
        return;
    }

    if (sub === 'diff') {
        const staged = args.includes('--staged') || args.includes('--cached');
        const file = args.find((a) => !a.startsWith('-') && a !== 'diff');
        println('\x1b[90m  Gerando diff…\x1b[0m');
        const diff = await gitDiff({ staged, file }).catch(() => '');
        if (!diff) {
            println('\x1b[90m  Sem diferenças.\x1b[0m');
            return;
        }
        const lines = diff.split('\n').slice(0, 150);
        for (const l of lines) {
            if (l.startsWith('+') && !l.startsWith('+++')) println(`\x1b[32m  ${l}\x1b[0m`);
            else if (l.startsWith('-') && !l.startsWith('---')) println(`\x1b[31m  ${l}\x1b[0m`);
            else if (l.startsWith('@@')) println(`\x1b[36m  ${l}\x1b[0m`);
            else println(`  ${l}`);
        }
        if (diff.split('\n').length > 150) println('\x1b[90m  …(truncado a 150 linhas)\x1b[0m');
        return;
    }

    if (sub === 'branch' || sub === 'branches') {
        println('\x1b[90m  Buscando branches…\x1b[0m');
        const branches = await gitBranch().catch(() => []);
        println('\n  \x1b[36mGit Branch\x1b[0m');
        println(formatBranch(branches));
        println('');
        return;
    }

    if (sub === 'pull') {
        println('\x1b[90m  Executando git pull…\x1b[0m');
        const output = await gitPull().catch((e) => `Erro: ${e.message}`);
        println(output.startsWith('Erro') ? `\x1b[31m  ✗ ${output}\x1b[0m` : `\x1b[32m  ✓ ${output || 'ok'}\x1b[0m`);
        return;
    }

    if (sub === 'stash') {
        const stashSub = args[1]?.toLowerCase() ?? 'push';
        if (stashSub === 'list') {
            const out = await gitStashList().catch(() => '');
            if (!out) {
                println('\x1b[90m  Nenhum stash encontrado.\x1b[0m');
                return;
            }
            println('\n  \x1b[36mGit Stash List\x1b[0m');
            for (const s of out.split('\n').filter(Boolean)) println(`  ${s}`);
            println('');
            return;
        }
        const out2 = await gitStash({ pop: stashSub === 'pop' }).catch((e) => `Erro: ${e.message}`);
        println(out2.startsWith('Erro') ? `\x1b[31m  ✗ ${out2}\x1b[0m` : `\x1b[32m  ✓ ${out2 || 'ok'}\x1b[0m`);
        return;
    }

    // help / fallback
    println(`
  \x1b[36m/git — Git CLI\x1b[0m
  ─────────────────────────────────────────────────
  \x1b[33m/git status\x1b[0m                    — status do working tree
  \x1b[33m/git log [n] [--oneline]\x1b[0m       — log de commits
  \x1b[33m/git diff [--staged] [file]\x1b[0m    — diff
  \x1b[33m/git branch\x1b[0m                    — branches
  \x1b[33m/git pull\x1b[0m                      — git pull
  \x1b[33m/git stash [list|pop|drop]\x1b[0m     — stash
  ─────────────────────────────────────────────────
`);
}
