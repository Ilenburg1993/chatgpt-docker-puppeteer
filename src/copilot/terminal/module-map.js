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
 *     | 'fallback'
 *     | 'sdk-adapter'
 *     | 'wiring'} TerminalModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} TerminalModuleTier
 *
 * @typedef {{
 *     path: string;
 *     kind: TerminalModuleKind;
 *     role: TerminalModuleRole;
 *     tier: TerminalModuleTier;
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
        public: true,
        summary: 'Composition root do terminal: fases de boot, recursos de UX local e REPL.',
    },
    {
        path: 'bootstrap.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        public: false,
        summary: 'Entrypoint executável da task terminal:llm-b.',
    },
    {
        path: 'bootstrap-lifecycle.js',
        kind: 'file',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Lifecycle fatal de boot, sinais e shutdown por falha de bootstrap.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Inventário executável da raiz do terminal.',
    },
    {
        path: 'repl.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        public: true,
        summary: 'Loop readline e roteamento de input humano para comandos/turnos.',
    },
    {
        path: 'repl-listeners.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        public: false,
        summary: 'Listeners que traduzem eventos vivos para UX do REPL.',
    },
    {
        path: 'terminal-agent-wiring.js',
        kind: 'file',
        role: 'wiring',
        tier: 'secondary',
        public: false,
        summary: 'Wiring de alto nível entre terminal, agent e SSE local.',
    },
    {
        path: 'agent-runtime-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        public: false,
        summary: 'Adapta eventos normalizados do runtime/agent para stdout e SSE.',
    },
    {
        path: 'sdk-session-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        public: false,
        summary: 'Adapta sinais vanilla da sessão SDK para a UX do terminal.',
    },
    {
        path: 'task-stream-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        public: false,
        summary: 'Renderiza e transmite eventos de streaming de tarefas internas.',
    },
    {
        path: 'agent-sse-fallback.js',
        kind: 'file',
        role: 'fallback',
        tier: 'internal',
        public: false,
        summary: 'Fallback SSE explícito para eventos do agent ainda sem adapter dedicado.',
    },
    {
        path: 'sdk-interactions.js',
        kind: 'file',
        role: 'sdk-adapter',
        tier: 'secondary',
        public: false,
        summary: 'Interações humanas com elicitation/permissões do SDK vanilla.',
    },
    {
        path: 'activity-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'Estado observável da atividade terminal para comandos e métricas locais.',
    },
    {
        path: 'rate-limiter-state.js',
        kind: 'file',
        role: 'state',
        tier: 'internal',
        public: false,
        summary: 'Estado local do rate limiter usado por comandos/handlers do terminal.',
    },
    {
        path: 'alias-store.js',
        kind: 'file',
        role: 'store',
        tier: 'secondary',
        public: true,
        summary: 'Persistência dos aliases humanos do REPL.',
    },
    {
        path: 'commands/',
        kind: 'directory',
        role: 'command-surface',
        tier: 'secondary',
        public: false,
        summary: 'Comandos REPL finos, orientados a operações do runtime.',
    },
    {
        path: 'dialog/',
        kind: 'directory',
        role: 'dialog-surface',
        tier: 'secondary',
        public: false,
        summary: 'Render, prompt, waiting UX, envio e exibição de turnos.',
    },
    {
        path: 'frontend/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        public: false,
        summary: 'Consumer layer canônica do runtime para o terminal.',
    },
    {
        path: 'handlers/',
        kind: 'directory',
        role: 'handler-surface',
        tier: 'secondary',
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
