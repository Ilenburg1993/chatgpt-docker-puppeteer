// @ts-check
/**
 * Comandos de inspeção do próprio terminal LLM-B.
 *
 * @module copilot/terminal/commands/terminal
 */

import { readTerminalExternalToolCapabilitySummary } from '../capabilities/external-tools.js';
import { terminalThemeHeadline, terminalThemeRow, terminalThemeWrappedRow } from '../state/ui-theme.js';

/**
 * @typedef {object} TerminalCommandContext
 * @property {(text: string) => void} println
 */
/**
 * @typedef {{
 *     query: string;
 *     label: string;
 *     active: boolean;
 *     matched: boolean;
 *     tools: import('../capabilities/external-tools.js').TerminalExternalToolCapability[];
 * }} TerminalLibsFilter
 */

const TERMINAL_LIBS_MODE_TOKENS = new Set([
    'detail',
    'details',
    '--detail',
    'json',
    '--json',
    'refresh',
    '--refresh',
]);

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
        println(terminalThemeWrappedRow(label, value, rowOptions));
    }
}

/**
 * @param {string[]} tokens
 * @param {import('../capabilities/external-tools.js').TerminalExternalToolCapability[]} tools
 * @returns {TerminalLibsFilter}
 */
function resolveTerminalLibsFilter(tokens, tools) {
    const query =
        tokens
            .map((token) => token.trim().toLowerCase())
            .find((token) => token && !TERMINAL_LIBS_MODE_TOKENS.has(token)) ?? 'all';
    if (query === 'all' || query === '*') {
        return { query: 'all', label: 'todos', active: false, matched: true, tools };
    }
    if (query === 'available' || query === 'disponiveis' || query === 'disponíveis') {
        return { query, label: 'disponíveis', active: true, matched: true, tools: tools.filter((tool) => tool.available) };
    }
    if (query === 'missing' || query === 'absent' || query === 'ausentes') {
        return { query, label: 'ausentes', active: true, matched: true, tools: tools.filter((tool) => !tool.available) };
    }
    if (query === 'accepted' || query === 'aceitas') {
        return {
            query,
            label: 'aceitas',
            active: true,
            matched: true,
            tools: tools.filter((tool) => tool.decision === 'accepted'),
        };
    }
    if (query === 'guarded' || query === 'guard' || query === 'guardas') {
        return {
            query,
            label: 'com guardas',
            active: true,
            matched: true,
            tools: tools.filter((tool) => tool.decision === 'accepted_guarded'),
        };
    }
    if (query === 'deferred' || query === 'deferidas' || query === 'adiadas') {
        return {
            query,
            label: 'adiadas',
            active: true,
            matched: true,
            tools: tools.filter((tool) => tool.decision === 'deferred'),
        };
    }
    const matchedTools = tools.filter((tool) => {
        const candidates = [tool.id, tool.label, tool.command, ...(tool.commands ?? [])]
            .filter((item) => typeof item === 'string')
            .map((item) => String(item).toLowerCase());
        return candidates.includes(query);
    });
    return {
        query,
        label: matchedTools.length > 0 ? query : `sem resultado: ${query}`,
        active: true,
        matched: matchedTools.length > 0,
        tools: matchedTools,
    };
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
 * @param {import('../capabilities/external-tools.js').TerminalExternalToolCapability} tool
 * @returns {string}
 */
function renderOperationalState(tool) {
    if (tool.decision === 'deferred') {
        return tool.available
            ? 'inventariada apenas; nenhuma chamada automática'
            : 'planejada, mas sem binário local e sem chamada automática';
    }
    if (!tool.available) return 'fallback canônico ativo';
    if (tool.decision === 'accepted_guarded') return 'acionável por opt-in com TTY exclusivo';
    return 'acionável por comando explícito';
}

/**
 * @param {import('../capabilities/external-tools.js').TerminalExternalToolCapability} tool
 * @returns {string}
 */
function renderDefaultState(tool) {
    if (tool.defaultEnabled) return 'habilitada por default';
    return 'desabilitada por default para preservar portabilidade';
}

/**
 * @param {(text: string) => void} println
 * @returns {void}
 */
function printTerminalCommandUsage(println) {
    println('');
    println(terminalThemeHeadline('command', 'Terminal'));
    printRows(println, [
        ['Uso', '/terminal libs [detail|json|refresh] [all|available|missing|accepted|guarded|deferred|tool]'],
        ['Atalho', '/libs [detail|json|refresh] [filtro]'],
        ['Função', 'inspeciona ferramentas auxiliares opcionais e seus fallbacks'],
    ]);
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {boolean} refresh
 * @param {string[]} [filterTokens]
 * @returns {void}
 */
function printTerminalLibsCompact(println, refresh, filterTokens = []) {
    const summary = readTerminalExternalToolCapabilitySummary({ refresh });
    const filter = resolveTerminalLibsFilter(filterTokens, summary.tools);
    println('');
    println(
        terminalThemeHeadline('tool', 'Libs auxiliares do terminal', [
            `${summary.available}/${summary.total} disponíveis`,
            'opcionais',
            filter.active ? `filtro ${filter.label}` : null,
        ]),
    );
    println(terminalThemeRow('Aceitas', `${summary.acceptedAvailable} disponíveis`));
    printRows(println, [
        ['Com guardas', `${summary.guardedAvailable} disponíveis`],
        ['Adiada', `${summary.deferredAvailable} disponível(is)`],
        ['Fallback', 'terminal JS canônico continua sendo o padrão'],
    ]);
    if (!filter.matched) {
        println(terminalThemeRow('Filtro', `${filter.query} não encontrou ferramenta ou grupo`, { role: 'warn' }));
    }
    println('');
    for (const tool of filter.tools) {
        const detail = [
            renderAvailability(tool.available),
            renderDecisionLabel(tool.decision),
            tool.available && tool.command ? tool.command : null,
        ]
            .filter(Boolean)
            .join(' · ');
        println(terminalThemeRow(tool.label, detail, { role: renderToolRole(tool), width: 12 }));
    }
    if (filter.tools.length === 0) {
        println(terminalThemeRow('Resultado', 'nenhuma ferramenta para este filtro', { role: 'warn' }));
    }
    println('');
    println(terminalThemeRow('Detalhes', '/terminal libs detail [filtro] · /terminal libs json [filtro] · /terminal libs refresh'));
    println(terminalThemeRow('Smoke', 'npm run terminal:aux-libs:smoke · npm --silent run terminal:aux-libs:smoke -- --json'));
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {boolean} refresh
 * @param {string[]} [filterTokens]
 * @returns {void}
 */
function printTerminalLibsDetail(println, refresh, filterTokens = []) {
    const summary = readTerminalExternalToolCapabilitySummary({ refresh });
    const filter = resolveTerminalLibsFilter(filterTokens, summary.tools);
    println('');
    println(
        terminalThemeHeadline('tool', 'Libs auxiliares do terminal', [
            `${summary.available}/${summary.total} disponíveis`,
            'detail',
            filter.active ? `filtro ${filter.label}` : null,
        ]),
    );
    if (!filter.matched) {
        println('');
        println(terminalThemeRow('Filtro', `${filter.query} não encontrou ferramenta ou grupo`, { role: 'warn' }));
    }
    for (const tool of filter.tools) {
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
                ['Estado', renderOperationalState(tool)],
                ['Default', renderDefaultState(tool)],
                ['Política', tool.executionPolicy],
                ['Fallback', tool.fallback],
                ['Risco', tool.risk],
                ['Comando', tool.command ?? 'não encontrado'],
                ['Versão', tool.version ?? 'n/d'],
                ['Path', tool.path ?? 'n/d'],
                ['Docs', tool.officialDocs],
            ],
            { width: 12 },
        );
        if (tool.exampleCommands.length > 0) {
            printRows(
                println,
                tool.exampleCommands.map((command, index) => [`Exemplo ${index + 1}`, command]),
                { width: 12 },
            );
        }
    }
    if (filter.tools.length === 0) {
        println('');
        println(terminalThemeRow('Resultado', 'nenhuma ferramenta para este filtro', { role: 'warn' }));
    }
    println('');
    printRows(
        println,
        [
            ['Smoke', 'npm run terminal:aux-libs:smoke'],
            ['JSON limpo', 'npm --silent run terminal:aux-libs:smoke -- --json'],
            ['Filtros', 'available · missing · accepted · guarded · deferred · fzf · bat · glow · delta · jq · yq'],
        ],
        { width: 12 },
    );
    println('');
}

/**
 * @param {(text: string) => void} println
 * @param {boolean} refresh
 * @param {string[]} [filterTokens]
 * @returns {void}
 */
function printTerminalLibsJson(println, refresh, filterTokens = []) {
    const summary = readTerminalExternalToolCapabilitySummary({ refresh });
    const filter = resolveTerminalLibsFilter(filterTokens, summary.tools);
    println(
        JSON.stringify(
            {
                schema: 'terminal-external-tools-capability-summary',
                generatedAt: new Date().toISOString(),
                policy: {
                    optionalByDefault: true,
                    noAutomaticPager: true,
                    noAutomaticTui: true,
                    canonicalFallbacks: true,
                },
                filter: {
                    query: filter.query,
                    label: filter.label,
                    active: filter.active,
                    matched: filter.matched,
                    count: filter.tools.length,
                },
                ...summary,
                tools: filter.tools,
            },
            null,
            2,
        ),
    );
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
    const filterTokens = args.slice(1);
    const refresh = flags.has('refresh') || flags.has('--refresh');
    if (flags.has('json') || flags.has('--json')) {
        printTerminalLibsJson(ctx.println, refresh, filterTokens);
        return;
    }
    if (flags.has('detail') || flags.has('details') || flags.has('--detail')) {
        printTerminalLibsDetail(ctx.println, refresh, filterTokens);
        return;
    }
    printTerminalLibsCompact(ctx.println, refresh, filterTokens);
}

/**
 * @param {TerminalCommandContext} ctx
 * @param {string} [arg]
 * @returns {void}
 */
export function cmdTerminalLibs(ctx, arg = '') {
    cmdTerminal(ctx, `libs ${arg}`.trim());
}
