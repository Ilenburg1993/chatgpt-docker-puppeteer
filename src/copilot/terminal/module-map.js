// @ts-check
/**
 * Mapa navegável da borda terminal LLM-B.
 *
 * Este mapa governa a raiz de `terminal/`: subdiretórios já possuem ownership próprio e serão detalhados em ondas
 * locais posteriores.
 */

/**
 * @typedef {'file' | 'directory'} TerminalModuleKind
 *
 * @typedef {'entrypoint'
 *     | 'boot'
 *     | 'orchestrator'
 *     | 'repl'
 *     | 'command-surface'
 *     | 'dialog-surface'
 *     | 'frontend-surface'
 *     | 'handler-surface'
 *     | 'event-adapter'
 *     | 'state'
 *     | 'store'
 *     | 'passthrough'
 *     | 'sdk-adapter'
 *     | 'wiring'} TerminalModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} TerminalModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} TerminalModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: TerminalModuleKind;
 *     role: TerminalModuleRole;
 *     tier: TerminalModuleTier;
 *     risk: TerminalModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} TerminalModuleDescriptor
 */

/** @type {readonly TerminalModuleDescriptor[]} */
export const TERMINAL_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        kind: 'file',
        role: 'orchestrator',
        tier: 'primary',
        risk: 'hotspot',
        public: true,
        summary: 'Composition root do terminal: fases de boot, recursos de UX local e REPL.',
    },
    {
        path: 'bootstrap.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        risk: 'stable',
        public: false,
        summary: 'Entrypoint executável da task terminal:llm-b.',
    },
    {
        path: 'bootstrap-lifecycle.js',
        kind: 'file',
        role: 'boot',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Lifecycle fatal de boot, sinais e shutdown por falha de bootstrap.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventário executável da raiz do terminal.',
    },
    {
        path: 'repl.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Loop readline e roteamento de input humano para comandos/turnos.',
    },
    {
        path: 'repl-listeners.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Listeners que traduzem eventos vivos para UX do REPL.',
    },
    {
        path: 'repl-banner.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Banner operacional do REPL e lista compacta de comandos/endpoints.',
    },
    {
        path: 'repl-command-parser.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Parser puro de comandos slash e aliases resolvidos.',
    },
    {
        path: 'repl-command-router.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Tabela CMD_ROUTES e dispatcher dispatchCmd — routing de comandos REPL.',
    },
    {
        path: 'repl-lifecycle.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Lifecycle readline do REPL: criação do interface, tab completion e event handlers.',
    },
    {
        path: 'repl-multiline.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Estado de input multiline por backslash continuation.',
    },
    {
        path: 'terminal-agent-wiring.js',
        kind: 'file',
        role: 'wiring',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Wiring de alto nível entre terminal, agent e SSE local.',
    },
    {
        path: 'event-adapters.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Composition root canônico dos adapters de eventos do terminal para REPL e headless.',
    },
    {
        path: 'event-adapter-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Matriz de cobertura dos eventos do agent: adapters explícitos, passthrough residual e ignorados.',
    },
    {
        path: 'agent-runtime-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Adapta eventos normalizados do runtime/agent para stdout e SSE.',
    },
    {
        path: 'sdk-session-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Adapta sinais vanilla da sessão SDK para a UX do terminal.',
    },
    {
        path: 'task-stream-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Renderiza e transmite eventos de streaming de tarefas internas.',
    },
    {
        path: 'agent-sse-passthrough.js',
        kind: 'file',
        role: 'passthrough',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Passthrough SSE explícito e estreito para eventos do agent ainda sem adapter dedicado.',
    },
    {
        path: 'sdk-interactions.js',
        kind: 'file',
        role: 'sdk-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Interações humanas com elicitation/permissões do SDK vanilla.',
    },
    {
        path: 'tool-activity-presenter.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Presenter puro para narrativa operacional de tools, arquivos e comandos no terminal.',
    },
    {
        path: 'activity-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Estado observável da atividade terminal para comandos e métricas locais.',
    },
    {
        path: 'display-policy.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Policy de densidade visual: presets, toggles e impacto em prompt/waiting.',
    },
    {
        path: 'ui-preferences.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Preferências locais de UI do terminal persistidas para comandos e projeções.',
    },
    {
        path: 'ui-theme.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Tokens e helpers de tema visual do terminal.',
    },
    {
        path: 'pending-question-replay.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Policy de replay/dedupe para perguntas pendentes no terminal.',
    },
    {
        path: 'pending-question-answer.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Policy de roteamento de input humano para ask_user pendente sem deadlock de fila.',
    },
    {
        path: 'turn-trace-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Estado canônico de resumo por turno para tools, arquivos tocados e activity projections.',
    },
    {
        path: 'rate-limiter-state.js',
        kind: 'file',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Estado local do rate limiter usado por comandos/handlers do terminal.',
    },
    {
        path: 'alias-store.js',
        kind: 'file',
        role: 'store',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Persistência dos aliases humanos do REPL.',
    },
    {
        path: 'commands/',
        kind: 'directory',
        role: 'command-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Comandos REPL finos, orientados a operações do runtime.',
    },
    {
        path: 'dialog/',
        kind: 'directory',
        role: 'dialog-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Render, prompt, waiting UX, envio e exibição de turnos.',
    },
    {
        path: 'frontend/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Consumer layer canônica do runtime para o terminal.',
    },
    {
        path: 'frontend/projections/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Famílias de projeção: shared, status, now, config, metrics, usage, sdk-session.',
    },
    {
        path: 'frontend/gateways/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Gateways de runtime: agent-runtime, sdk-session, dialog, hub.',
    },
    {
        path: 'handlers/',
        kind: 'directory',
        role: 'handler-surface',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Handlers HTTP usados pelo servidor terminal/inject.',
    },
]);

/**
 * @param {TerminalModuleRole} role
 * @returns {TerminalModuleDescriptor[]}
 */
export function listTerminalModulesByRole(role) {
    return TERMINAL_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {TerminalModuleRisk} risk
 * @returns {TerminalModuleDescriptor[]}
 */
export function listTerminalModulesByRisk(risk) {
    return TERMINAL_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * @param {Record<string, number>} bucket
 * @param {string} key
 * @returns {void}
 */
function increment(bucket, key) {
    bucket[key] = (bucket[key] ?? 0) + 1;
}

/**
 * @param {string} path
 * @returns {TerminalModuleDescriptor | undefined}
 */
export function getTerminalModuleDescriptor(path) {
    return TERMINAL_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {TerminalModuleRole | undefined}
 */
export function getTerminalModuleRole(path) {
    return getTerminalModuleDescriptor(path)?.role;
}

/**
 * Scorecard leve de organização física da raiz do terminal.
 *
 * @returns {{
 *     total: number;
 *     byRole: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     hotspots: string[];
 *     watch: string[];
 * }}
 */
export function buildTerminalModuleScorecard() {
    /** @type {Record<string, number>} */
    const byRole = {};
    /** @type {Record<string, number>} */
    const byRisk = {};
    /** @type {string[]} */
    const hotspots = [];
    /** @type {string[]} */
    const watch = [];

    for (const entry of TERMINAL_MODULE_LAYOUT) {
        increment(byRole, entry.role);
        increment(byRisk, entry.risk);
        if (entry.risk === 'hotspot') hotspots.push(entry.path);
        if (entry.risk === 'watch') watch.push(entry.path);
    }

    return {
        total: TERMINAL_MODULE_LAYOUT.length,
        byRole,
        byRisk,
        hotspots: hotspots.sort(),
        watch: watch.sort(),
    };
}
