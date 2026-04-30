// @ts-check
/**
 * Mapa navegável do subsistema de lifecycle do agent.
 */

/**
 * @typedef {'entrypoint'
 *     | 'orchestrator'
 *     | 'compat-entry'
 *     | 'process-host'
 *     | 'setup'
 *     | 'policy'
 *     | 'teardown'
 *     | 'state'} LifecycleModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} LifecycleModuleTier
 *
 * @typedef {{ path: string; role: LifecycleModuleRole; tier: LifecycleModuleTier; public: boolean; summary: string }} LifecycleModuleDescriptor
 */

/** @type {readonly LifecycleModuleDescriptor[]} */
export const LIFECYCLE_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Sub-barrel publico do subsistema de lifecycle.',
    },
    {
        path: 'module-map.js',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Inventario executavel de papeis e tiers do diretorio.',
    },
    {
        path: 'agent-lifecycle.js',
        role: 'orchestrator',
        tier: 'primary',
        public: false,
        summary: 'Orquestrador de start/stop/initSession do AlwaysAliveAgent.',
    },
    {
        path: 'entry.js',
        role: 'compat-entry',
        tier: 'secondary',
        public: false,
        summary: 'Entrypoint compat legado; boot canonico vive fora deste arquivo.',
    },
    {
        path: 'runtime-host.js',
        role: 'process-host',
        tier: 'secondary',
        public: true,
        summary: 'Borda de processo: sinais, IPC, shutdown host e preflight SDK.',
    },
    {
        path: 'session-setup.js',
        role: 'setup',
        tier: 'secondary',
        public: false,
        summary: 'Preparacao de config de sessao SDK, tools, hooks e ask_user.',
    },
    {
        path: 'reconnect-policy.js',
        role: 'policy',
        tier: 'secondary',
        public: true,
        summary: 'Politica de reconexao com backoff, jitter e recovery SDK.',
    },
    {
        path: 'runtime-teardown.js',
        role: 'teardown',
        tier: 'secondary',
        public: false,
        summary: 'Helpers internos de teardown e rollback do runtime.',
    },
    {
        path: 'state-io.js',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'API semantica de leitura/escrita do estado persistido.',
    },
    {
        path: 'state-file-io.js',
        role: 'state',
        tier: 'internal',
        public: false,
        summary: 'I/O fisico cru do arquivo de estado persistido.',
    },
]);

/**
 * @param {LifecycleModuleRole} role
 * @returns {LifecycleModuleDescriptor[]}
 */
export function listLifecycleModulesByRole(role) {
    return LIFECYCLE_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {string} path
 * @returns {LifecycleModuleDescriptor | undefined}
 */
export function getLifecycleModuleDescriptor(path) {
    return LIFECYCLE_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {LifecycleModuleRole | undefined}
 */
export function getLifecycleModuleRole(path) {
    return getLifecycleModuleDescriptor(path)?.role;
}
