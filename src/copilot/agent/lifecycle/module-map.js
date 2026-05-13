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
        path: 'entrypoints/index.js',
        role: 'compat-entry',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos entrypoints de lifecycle.',
    },
    {
        path: 'orchestrators/index.js',
        role: 'orchestrator',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos orquestradores de lifecycle.',
    },
    {
        path: 'policies/index.js',
        role: 'policy',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro das políticas de lifecycle.',
    },
    {
        path: 'process-host/index.js',
        role: 'process-host',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro das bordas de processo.',
    },
    {
        path: 'setup/index.js',
        role: 'setup',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro do setup de sessão.',
    },
    {
        path: 'state/index.js',
        role: 'state',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro do estado de lifecycle.',
    },
    {
        path: 'state/file/index.js',
        role: 'state',
        tier: 'internal',
        public: false,
        summary: 'Barrel puro do I/O físico de estado.',
    },
    {
        path: 'teardown/index.js',
        role: 'teardown',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro de teardown de runtime.',
    },
    {
        path: 'orchestrators/agent-lifecycle.js',
        role: 'orchestrator',
        tier: 'primary',
        public: false,
        summary: 'Orquestrador de start/stop/initSession do AlwaysAliveAgent.',
    },
    {
        path: 'entrypoints/entry.js',
        role: 'compat-entry',
        tier: 'secondary',
        public: false,
        summary: 'Entrypoint compat legado; boot canonico vive fora deste arquivo.',
    },
    {
        path: 'process-host/runtime-host.js',
        role: 'process-host',
        tier: 'secondary',
        public: true,
        summary: 'Borda de processo: sinais, IPC, shutdown host e preflight SDK.',
    },
    {
        path: 'setup/session-setup.js',
        role: 'setup',
        tier: 'secondary',
        public: false,
        summary: 'Preparacao de config de sessao SDK, tools, hooks e ask_user.',
    },
    {
        path: 'policies/reconnect-policy.js',
        role: 'policy',
        tier: 'secondary',
        public: true,
        summary: 'Politica de reconexao com backoff, jitter e recovery SDK.',
    },
    {
        path: 'teardown/runtime-teardown.js',
        role: 'teardown',
        tier: 'secondary',
        public: false,
        summary: 'Helpers internos de teardown e rollback do runtime.',
    },
    {
        path: 'state/state-io.js',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'API semantica de leitura/escrita do estado persistido.',
    },
    {
        path: 'state/state-file-io.js',
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
