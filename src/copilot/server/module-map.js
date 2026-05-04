// @ts-check
/**
 * Mapa navegável da borda HTTP/Socket.IO do Copilot.
 *
 * Este mapa governa a raiz de `server/`; subdiretórios mantêm taxonomias próprias em ondas posteriores.
 */

/**
 * @typedef {'file' | 'directory'} ServerModuleKind
 *
 * @typedef {'entrypoint' | 'app-factory' | 'router' | 'middleware' | 'runtime-state' | 'socket'} ServerModuleRole
 *
 * @typedef {'primary' | 'secondary' | 'internal'} ServerModuleTier
 *
 * @typedef {{
 *     path: string;
 *     kind: ServerModuleKind;
 *     role: ServerModuleRole;
 *     tier: ServerModuleTier;
 *     public: boolean;
 *     summary: string;
 * }} ServerModuleDescriptor
 */

/** @type {readonly ServerModuleDescriptor[]} */
export const SERVER_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Owner do HTTP server, Socket.IO server e shutdown handler de rede.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Inventário executável da raiz do server.',
    },
    {
        path: 'app.js',
        kind: 'file',
        role: 'app-factory',
        tier: 'primary',
        public: true,
        summary: 'Factory Express, middleware base e error handler final.',
    },
    {
        path: 'router.js',
        kind: 'file',
        role: 'router',
        tier: 'primary',
        public: true,
        summary: 'Composition root dos routers HTTP do Copilot.',
    },
    {
        path: 'middleware/',
        kind: 'directory',
        role: 'middleware',
        tier: 'secondary',
        public: false,
        summary: 'Middleware Express de auth, CORS, headers, rate-limit e validação.',
    },
    {
        path: 'routes/',
        kind: 'directory',
        role: 'router',
        tier: 'secondary',
        public: false,
        summary: 'Routers HTTP por domínio de borda.',
    },
    {
        path: 'runtime-state/',
        kind: 'directory',
        role: 'runtime-state',
        tier: 'secondary',
        public: false,
        summary: 'Estado local de borda para stream/rate-limit por runtime.',
    },
    {
        path: 'socket/',
        kind: 'directory',
        role: 'socket',
        tier: 'secondary',
        public: false,
        summary: 'Socket.IO server e namespace do ConversationHub.',
    },
]);

/**
 * @param {ServerModuleRole} role
 * @returns {ServerModuleDescriptor[]}
 */
export function listServerModulesByRole(role) {
    return SERVER_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {string} path
 * @returns {ServerModuleDescriptor | undefined}
 */
export function getServerModuleDescriptor(path) {
    return SERVER_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {ServerModuleRole | undefined}
 */
export function getServerModuleRole(path) {
    return getServerModuleDescriptor(path)?.role;
}
