// @ts-check
/**
 * @module copilot/terminal/repl-command-parser
 * @file Parser puro de comandos slash do REPL.
 */

/**
 * @typedef {{
 *     resolved: string;
 *     command: string;
 *     arg: string;
 *     rest: string[];
 * }} TerminalReplCommand
 */

/**
 * @param {string} line
 * @param {(line: string) => string} [resolveLine]
 * @returns {TerminalReplCommand | null}
 */
export function parseTerminalReplCommand(line, resolveLine = (value) => value) {
    if (!line.startsWith('/')) {
        return null;
    }
    const resolved = resolveLine(line);
    const [command = '', ...rest] = resolved.slice(1).split(' ');
    return {
        resolved,
        command,
        arg: rest.join(' '),
        rest,
    };
}

/**
 * Normaliza o contrato duplo do dispatcher: `arg` agregado e `rest` tokenizado.
 *
 * @param {string} [arg]
 * @param {string[]} [rest]
 * @returns {{ subcommand: string; rest: string[] }}
 */
export function parseTerminalSubcommand(arg = '', rest = []) {
    const tokens = rest.length > 0 ? rest : arg.split(/\s+/u).filter(Boolean);
    const [subcommand = '', ...subcommandRest] = tokens;
    return { subcommand, rest: subcommandRest };
}
