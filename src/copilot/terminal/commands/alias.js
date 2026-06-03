// @ts-check
/**
 * src/copilot/terminal/commands/alias.js
 *
 * Comando /alias do REPL: list, set, remove, reset
 *
 * @module copilot/terminal/commands/alias
 * @see EventBus
 */

import { formatAliases, removeAlias, setAlias } from '../stores/index.js';
import { terminalThemeHeadline, terminalThemeRow } from '../state/index.js';

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
        println('');
        println(terminalThemeHeadline('command', 'Aliases'));
        println(formatAliases());
        println('');
        return;
    }

    if (action === 'set') {
        const name = args[1];
        const expansion = args.slice(2).join(' ');
        if (!name || !expansion) {
            println(terminalThemeRow('Uso', '/alias set <nome> <comando> · ex: /alias set /myissues /gh issue list', { role: 'warn' }));
            return;
        }
        const result = setAlias(name.startsWith('/') ? name : `/${name}`, expansion);
        if (!result.ok) {
            println(terminalThemeRow('Alias', `erro ao definir: ${result.error}`, { role: 'error' }));
            return;
        }
        println(terminalThemeRow('Alias', `definido · ${name} -> ${expansion}`, { role: 'success' }));
        return;
    }

    if (action === 'remove' || action === 'rm' || action === 'delete') {
        const name = args[1];
        if (!name) {
            println(terminalThemeRow('Uso', '/alias remove <nome>', { role: 'warn' }));
            return;
        }
        const ok = removeAlias(name.startsWith('/') ? name : `/${name}`);
        println(ok ? terminalThemeRow('Alias', `removido · ${name}`, { role: 'success' }) : terminalThemeRow('Alias', `não encontrado · ${name}`, { role: 'warn' }));
        return;
    }

    println(terminalThemeRow('Uso', '/alias [list|set <nome> <cmd>|remove <nome>]', { role: 'command' }));
}
