// @ts-check
/**
 * Comandos de inspeção do próprio terminal LLM-B.
 *
 * @module copilot/terminal/commands/terminal
 */

import { readTerminalExternalToolCapabilitySummary } from '../capabilities/index.js';
import { terminalThemeHeadline, terminalThemeRow } from '../state/ui-theme.js';

/**
 * @typedef {object} TerminalCommandContext
 * @property {(text: string) => void} println
 */

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitTerminalArgs(value) {
    return value
        .trim()
        .split(/\s+/u)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * @param {import('../capabilities/external-tools.js').TerminalExternalToolDecision} decision
 * @returns {string}
 */
function renderDecisionLabel(decision) {
    if (decision === 'accepted') return 'aceita como opcional';
    if (decision === 'accepted_guarded') return 'aceita com guardas';
    return 'adiada';
}

/**
 * @param {boolean} value
 * @returns {string}
 */
function renderAvailability(value) {
    return value ? 'disponível' : 'ausente';
}

/**
 * @param {(text: string) => void} println
 * @param {Array<[string, string]>} rows
 * @param {{ width?: number }} [options]
 * @returns {void}
 */
function printRows(println, rows, options = {}) {
    for (const [label, value] of rows) {
        const rowOptions = options.width === undefined ? {} : { width: options.width };
        println(terminalThemeRow(label, value, rowOptions));
    }
}

/**
 * @param {import('../capabilities/external-tools.js').TerminalExternalToolCapability} tool
 * @returns {'success' | 'warn' | 'muted'}
 */
function renderToolRole(tool) {
    if (!tool.available) return 'muted';
    if (tool.decision === 'deferred') return 'warn';
    return 'success';
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function printTerminalCommandUsage(println) {
    println('');
    println(terminalThemeHeadline('command', 'Terminal'));
    printRows(
        println,
        [
            ['Uso', '/terminal libs [detail|json|refresh]'],
            ['Atalho', '/libs [detail|json|refresh]'],
            ['Função', 'inspeciona ferramentas auxiliares opcionais e seus fallbacks'],
        ],
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {boolean} refresh
 * @returns {void}
 */
function printTerminalLibsCompact(println, refresh) {
    const summary = readTerminalExternalToolCapabilitySummary({ refresh });
    println('');
    println(
        terminalThemeHeadline('tool', 'Libs auxiliares do terminal', [
            `${summary.available}/${summary.total} disponíveis`,
            'opcionais',
        ]),
    );
    println(terminalThemeRow('Aceitas', `${summary.acceptedAvailable} disponíveis`));
    printRows(println, [
        ['Com guardas', `${summary.guardedAvailable} disponíveis`],
        ['Adiada', `${summary.deferredAvailable} disponível(is)`],
        ['Fallback', 'terminal JS canônico continua sendo o padrão'],
    ]);
    println('');
    for (const tool of summary.tools) {
        const detail = [
            renderAvailability(tool.available),
            renderDecisionLabel(tool.decision),
            tool.available && tool.command ? tool.command : null,
        ]
            .filter(Boolean)
            .join(' · ');
        println(terminalThemeRow(tool.label, detail, { role: renderToolRole(tool), width: 12 }));
    }
    println('');
    println(terminalThemeRow('Detalhes', '/terminal libs detail · /terminal libs json · /terminal libs refresh'));
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {boolean} refresh
 * @returns {void}
 */
function printTerminalLibsDetail(println, refresh) {
    const summary = readTerminalExternalToolCapabilitySummary({ refresh });
    println('');
    println(
        terminalThemeHeadline('tool', 'Libs auxiliares do terminal', [
            `${summary.available}/${summary.total} disponíveis`,
            'detail',
        ]),
    );
    for (const tool of summary.tools) {
        println('');
        println(
            terminalThemeRow(tool.label, `${renderAvailability(tool.available)} · ${renderDecisionLabel(tool.decision)}`, {
                role: renderToolRole(tool),
                width: 12,
            }),
        );
        printRows(
            println,
            [
                ['Uso', tool.recommendedFor],
                ['Fallback', tool.fallback],
                ['Risco', tool.risk],
                ['Comando', tool.command ?? 'não encontrado'],
                ['Versão', tool.version ?? 'n/d'],
                ['Path', tool.path ?? 'n/d'],
                ['Docs', tool.officialDocs],
            ],
            { width: 12 },
        );
    }
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {boolean} refresh
 * @returns {void}
 */
function printTerminalLibsJson(println, refresh) {
    const summary = readTerminalExternalToolCapabilitySummary({ refresh });
    println(JSON.stringify(summary, null, 2));
}

/**
 * @param {TerminalCommandContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdTerminal(ctx, arg = '') {
    const args = splitTerminalArgs(arg);
    const first = args[0]?.toLowerCase() ?? '';
    if (!first) {
        printTerminalCommandUsage(ctx.println);
        return;
    }
    if (first !== 'libs' && first !== 'lib' && first !== 'tools') {
        printTerminalCommandUsage(ctx.println);
        return;
    }
    const flags = new Set(args.slice(1).map((item) => item.toLowerCase()));
    const refresh = flags.has('refresh') || flags.has('--refresh');
    if (flags.has('json') || flags.has('--json')) {
        printTerminalLibsJson(ctx.println, refresh);
        return;
    }
    if (flags.has('detail') || flags.has('details') || flags.has('--detail')) {
        printTerminalLibsDetail(ctx.println, refresh);
        return;
    }
    printTerminalLibsCompact(ctx.println, refresh);
}

/**
 * @param {TerminalCommandContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdTerminalLibs(ctx, arg = '') {
    cmdTerminal(ctx, `libs ${arg}`.trim());
}
