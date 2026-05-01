// @ts-check
/**
 * Mapa navegável dos handlers HTTP compartilhados pelo terminal LLM-B.
 *
 * Este diretório deve permanecer uma borda fina: handlers daqui só reexportam ou tipam contratos vindos de
 * `presentation/`. Qualquer regra de domínio nova deve nascer no owner canônico antes de chegar aqui.
 */

/**
 * @typedef {'file'} TerminalHandlerModuleKind
 *
 * @typedef {'barrel' | 'presentation-adapter' | 'type-contract' | 'inventory'} TerminalHandlerModuleRole
 *
 * @typedef {'terminal-http'} TerminalHandlerModuleSurface
 *
 * @typedef {'primary' | 'secondary' | 'internal'} TerminalHandlerModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} TerminalHandlerModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: TerminalHandlerModuleKind;
 *     role: TerminalHandlerModuleRole;
 *     surface: TerminalHandlerModuleSurface;
 *     tier: TerminalHandlerModuleTier;
 *     risk: TerminalHandlerModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} TerminalHandlerModuleDescriptor
 */

/** @type {readonly TerminalHandlerModuleDescriptor[]} */
export const TERMINAL_HANDLER_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        kind: 'file',
        role: 'barrel',
        surface: 'terminal-http',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel publico dos handlers HTTP do terminal.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'inventory',
        surface: 'terminal-http',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventario executavel dos handlers HTTP do terminal.',
    },
    {
        path: 'agent.js',
        kind: 'file',
        role: 'presentation-adapter',
        surface: 'terminal-http',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Adapter fino para comandos de agent-control em presentation.',
    },
    {
        path: 'dialog.js',
        kind: 'file',
        role: 'presentation-adapter',
        surface: 'terminal-http',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Adapter fino para sessions, memory e hub-health em presentation.',
    },
    {
        path: 'system-config.js',
        kind: 'file',
        role: 'presentation-adapter',
        surface: 'terminal-http',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Adapter fino para config, tools, skills e health em presentation.',
    },
    {
        path: 'system-metrics.js',
        kind: 'file',
        role: 'presentation-adapter',
        surface: 'terminal-http',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Adapter fino para metricas, git, GitHub e auditoria em presentation.',
    },
    {
        path: 'shared.js',
        kind: 'file',
        role: 'type-contract',
        surface: 'terminal-http',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Tipos locais compartilhados por handlers HTTP.',
    },
]);

/**
 * @param {Record<string, number>} bucket
 * @param {string} key
 * @returns {void}
 */
function increment(bucket, key) {
    bucket[key] = (bucket[key] ?? 0) + 1;
}

/**
 * @param {TerminalHandlerModuleRole} role
 * @returns {TerminalHandlerModuleDescriptor[]}
 */
export function listTerminalHandlerModulesByRole(role) {
    return TERMINAL_HANDLER_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {TerminalHandlerModuleRisk} risk
 * @returns {TerminalHandlerModuleDescriptor[]}
 */
export function listTerminalHandlerModulesByRisk(risk) {
    return TERMINAL_HANDLER_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * @param {string} path
 * @returns {TerminalHandlerModuleDescriptor | undefined}
 */
export function getTerminalHandlerModuleDescriptor(path) {
    return TERMINAL_HANDLER_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {TerminalHandlerModuleRole | undefined}
 */
export function getTerminalHandlerModuleRole(path) {
    return getTerminalHandlerModuleDescriptor(path)?.role;
}

/**
 * Scorecard leve de organização física dos handlers do terminal.
 *
 * @returns {{
 *     total: number;
 *     byRole: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     adapters: string[];
 *     hotspots: string[];
 * }}
 */
export function buildTerminalHandlerModuleScorecard() {
    /** @type {Record<string, number>} */
    const byRole = {};
    /** @type {Record<string, number>} */
    const byRisk = {};
    /** @type {string[]} */
    const adapters = [];
    /** @type {string[]} */
    const hotspots = [];

    for (const entry of TERMINAL_HANDLER_MODULE_LAYOUT) {
        increment(byRole, entry.role);
        increment(byRisk, entry.risk);
        if (entry.role === 'presentation-adapter') adapters.push(entry.path);
        if (entry.risk === 'hotspot') hotspots.push(entry.path);
    }

    return {
        total: TERMINAL_HANDLER_MODULE_LAYOUT.length,
        byRole,
        byRisk,
        adapters: adapters.sort(),
        hotspots: hotspots.sort(),
    };
}
