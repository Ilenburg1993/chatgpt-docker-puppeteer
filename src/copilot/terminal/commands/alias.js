// @ts-check
/**
 * src/copilot/terminal/commands/alias.js
 *
 * Comando /alias do REPL: list, set, remove, reset
 *
 * @module copilot/terminal/commands/alias
 */

import { formatAliases, removeAlias, setAlias } from '../../alias-store.js';

/**
 * @typedef {object} SessionContext
 * @property {(text: string) => void} println
 */

/**
 * Handler do comando /alias [set|remove|reset|list].
 *
 * @param {SessionContext} ctx
 * @param {string[]} args - Argumentos após /alias
 * @returns {void}
 */
export function cmdAlias({ println }, args) {
    const action = args[0]?.toLowerCase() ?? 'list';

    if (action === 'list' || action === '') {
        println('\n  \x1b[36mAliases\x1b[0m');
        println(formatAliases());
        println('');
        return;
    }

    if (action === 'set') {
        const name = args[1];
        const expansion = args.slice(2).join(' ');
        if (!name || !expansion) {
            println('\x1b[90m  Uso: /alias set <nome> <comando>   ex: /alias set /myissues /gh issue list\x1b[0m');
            return;
        }
        setAlias(name.startsWith('/') ? name : `/${name}`, expansion);
        println(`\x1b[32m  ✓ Alias definido: ${name} → ${expansion}\x1b[0m`);
        return;
    }

    if (action === 'remove' || action === 'rm' || action === 'delete') {
        const name = args[1];
        if (!name) {
            println('\x1b[90m  Uso: /alias remove <nome>\x1b[0m');
            return;
        }
        const ok = removeAlias(name.startsWith('/') ? name : `/${name}`);
        println(ok ? `\x1b[32m  ✓ Alias removido: ${name}\x1b[0m` : `\x1b[33m  Alias não encontrado: ${name}\x1b[0m`);
        return;
    }

    println('\x1b[90m  Uso: /alias [list|set <nome> <cmd>|remove <nome>]\x1b[0m');
}
