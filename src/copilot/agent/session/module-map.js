// @ts-check
/**
 * Mapa navegável do subsistema de sessão do agent.
 *
 * Como em `agent/dialog/module-map.js`, este inventário evita diretórios opacos: cada arquivo JS precisa declarar
 * papel, tier e exposição antes de movimentos físicos mais profundos.
 */

/**
 * @typedef {'entrypoint' | 'boot' | 'initializer' | 'lifecycle' | 'wiring' | 'history' | 'context' | 'state'} SessionModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} SessionModuleTier
 *
 * @typedef {{ path: string; role: SessionModuleRole; tier: SessionModuleTier; public: boolean; summary: string }} SessionModuleDescriptor
 */

/** @type {readonly SessionModuleDescriptor[]} */
export const SESSION_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Sub-barrel publico do subsistema de sessao.',
    },
    {
        path: 'module-map.js',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Inventario executavel de papeis e tiers do diretorio.',
    },
    {
        path: 'initializers/initializer.js',
        role: 'initializer',
        tier: 'primary',
        public: true,
        summary: 'Inicializador/resumer de sessao SDK persistente.',
    },
    {
        path: 'boot/boot-wiring.js',
        role: 'boot',
        tier: 'primary',
        public: true,
        summary: 'Runner/composer das etapas de boot pos-init.',
    },
    {
        path: 'boot/boot-steps.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Barrel interno das steps de boot extraidas.',
    },
    {
        path: 'boot/boot-session-prep.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Preparacao de sessao, event collector e cleanup no boot.',
    },
    {
        path: 'boot/boot-dialog-recovery.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Recuperacao de dialog loop e shadow de pergunta no boot/resume.',
    },
    {
        path: 'boot/boot-runtime-bind.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Bindings operacionais do runtime: observer, metricas, MCP, handoff e relays.',
    },
    {
        path: 'lifecycle/keepalive.js',
        role: 'lifecycle',
        tier: 'secondary',
        public: true,
        summary: 'Keepalive de sessao SDK quando o dialog loop nao esta ativo.',
    },
    {
        path: 'lifecycle/cleanup.js',
        role: 'lifecycle',
        tier: 'secondary',
        public: true,
        summary: 'Limpeza proativa de sessoes antigas protegendo sessoes ativas.',
    },
    {
        path: 'lifecycle/rotation.js',
        role: 'lifecycle',
        tier: 'secondary',
        public: true,
        summary: 'Politica de rotacao de sessao por idade/contexto/compaction.',
    },
    {
        path: 'wiring/event-wirer.js',
        role: 'wiring',
        tier: 'secondary',
        public: true,
        summary: 'Orquestrador de event handlers do SDK.',
    },
    {
        path: 'history/history-sync.js',
        role: 'history',
        tier: 'secondary',
        public: true,
        summary: 'Sincronizacao de mensagens SDK para ConversationStore e cache local.',
    },
    {
        path: 'context/hook-context.js',
        role: 'context',
        tier: 'secondary',
        public: false,
        summary: 'Builder/sanitizador do contexto de hooks e briefing de sessao.',
    },
    {
        path: 'state/ownership.js',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'SSOT operacional do vinculo entre sessao SDK e hub conversational.',
    },
    {
        path: 'state/snapshot.js',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'API semantica de snapshot/restore de sessao.',
    },
    {
        path: 'state/snapshot-store.js',
        role: 'state',
        tier: 'internal',
        public: false,
        summary: 'Persistencia fisica, validacao e pruning de snapshots.',
    },
]);

/**
 * @param {SessionModuleRole} role
 * @returns {SessionModuleDescriptor[]}
 */
export function listSessionModulesByRole(role) {
    return SESSION_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {string} path
 * @returns {SessionModuleDescriptor | undefined}
 */
export function getSessionModuleDescriptor(path) {
    return SESSION_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {SessionModuleRole | undefined}
 */
export function getSessionModuleRole(path) {
    return getSessionModuleDescriptor(path)?.role;
}
