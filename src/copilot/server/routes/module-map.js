// @ts-check
/**
 * Mapa navegável das rotas HTTP/SSE do Copilot.
 *
 * Este mapa governa `server/routes/` de forma recursiva e separa rotas gerais, Copilot API e SDK API. Ele não substitui
 * os routers; serve como contrato de ownership, risco e ordem de decomposição.
 */

/**
 * @typedef {'file' | 'directory'} ServerRouteModuleKind
 *
 * @typedef {'root-route'
 *     | 'copilot-api-route'
 *     | 'sdk-route'
 *     | 'sdk-composition'
 *     | 'sdk-deps'
 *     | 'sdk-middleware'
 *     | 'sdk-schema'
 *     | 'sdk-session-helper'
 *     | 'sdk-session-route-family'
 *     | 'sdk-session-stream'
 *     | 'sse-route'
 *     | 'health-registry'
 *     | 'module-health'
 *     | 'compat-reexport'
 *     | 'route-adapter'
 *     | 'inventory'
 *     | 'docs'
 *     | 'surface'} ServerRouteModuleRole
 *
 *
 * @typedef {'root' | 'copilot-api' | 'sdk'} ServerRouteModuleSurface
 *
 * @typedef {'primary' | 'secondary' | 'internal'} ServerRouteModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} ServerRouteModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: ServerRouteModuleKind;
 *     role: ServerRouteModuleRole;
 *     surface: ServerRouteModuleSurface;
 *     tier: ServerRouteModuleTier;
 *     risk: ServerRouteModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} ServerRouteModuleDescriptor
 */

/** @type {readonly ServerRouteModuleDescriptor[]} */
export const SERVER_ROUTE_MODULE_LAYOUT = Object.freeze([
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'inventory',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventario executavel recursivo das rotas HTTP/SSE.',
    },
    {
        path: 'presentation-route.js',
        kind: 'file',
        role: 'route-adapter',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: false,
        summary: 'Adapter canônico entre handlers de presentation e RequestHandlers Express.',
    },
    {
        path: 'agent.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Rotas HTTP de agent-control via presentation e handler bridge.',
    },
    {
        path: 'agent-health.js',
        kind: 'file',
        role: 'compat-reexport',
        surface: 'root',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Reexport compatível de health do agent vindo de presentation.',
    },
    {
        path: 'config.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Rotas de config, skills e tools via presentation.',
    },
    {
        path: 'git.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Rotas de git e GitHub via presentation.',
    },
    {
        path: 'health.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Rotas de health, hub-health e ws/info.',
    },
    {
        path: 'health-modules.js',
        kind: 'file',
        role: 'module-health',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Registry HTTP de health por modulo.',
    },
    {
        path: 'health-registry.js',
        kind: 'file',
        role: 'health-registry',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Cadastro dos health checks canonicos do Copilot.',
    },
    {
        path: 'memory.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Rotas de memoria via presentation/conversation-hub.',
    },
    {
        path: 'observability.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Rotas de erros, metricas, historico, audit e reset via presentation.',
    },
    {
        path: 'sessions.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Rotas do ConversationHub via presentation.',
    },
    {
        path: 'sse.js',
        kind: 'file',
        role: 'sse-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'SSE terminal global e stream critico.',
    },
    {
        path: 'webhooks.js',
        kind: 'file',
        role: 'root-route',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Rotas de webhooks por runtime.',
    },
    {
        path: 'copilot-api/',
        kind: 'directory',
        role: 'surface',
        surface: 'copilot-api',
        tier: 'primary',
        risk: 'watch',
        public: false,
        summary: 'Subsuperficie HTTP/SSE do AlwaysAliveAgent.',
    },
    {
        path: 'copilot-api/index.js',
        kind: 'file',
        role: 'copilot-api-route',
        surface: 'copilot-api',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Composition router da Copilot API.',
    },
    {
        path: 'copilot-api/control.js',
        kind: 'file',
        role: 'copilot-api-route',
        surface: 'copilot-api',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Controle de lifecycle, permissao, steering e status do agent runtime.',
    },
    {
        path: 'copilot-api/dialog.js',
        kind: 'file',
        role: 'copilot-api-route',
        surface: 'copilot-api',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Rotas de dialog loop do agent runtime.',
    },
    {
        path: 'copilot-api/stream.js',
        kind: 'file',
        role: 'copilot-api-route',
        surface: 'copilot-api',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'SSE global e SSE de tasks do agent runtime.',
    },
    {
        path: 'copilot-api/tasks.js',
        kind: 'file',
        role: 'copilot-api-route',
        surface: 'copilot-api',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Task enqueue, pending questions, clear-shadow e elicitation bridge.',
    },
    {
        path: 'sdk/',
        kind: 'directory',
        role: 'surface',
        surface: 'sdk',
        tier: 'primary',
        risk: 'hotspot',
        public: false,
        summary: 'Subsuperficie HTTP/SSE da SDK API.',
    },
    {
        path: 'sdk/agent.js',
        kind: 'file',
        role: 'sdk-route',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Rotas de agent info/tools/telemetry/state/stream do SDK API.',
    },
    {
        path: 'sdk/client.js',
        kind: 'file',
        role: 'sdk-route',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Rotas de client control, auth, models, tools e status.',
    },
    {
        path: 'sdk/deps.js',
        kind: 'file',
        role: 'sdk-deps',
        surface: 'sdk',
        tier: 'primary',
        risk: 'watch',
        public: false,
        summary: 'Composition root de dependencias da SDK API.',
    },
    {
        path: 'sdk/hooks.js',
        kind: 'file',
        role: 'sdk-route',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Rotas e SSE de hooks da SDK API.',
    },
    {
        path: 'sdk/index.js',
        kind: 'file',
        role: 'sdk-composition',
        surface: 'sdk',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Composition router da SDK API sob /sdk.',
    },
    {
        path: 'sdk/middleware.js',
        kind: 'file',
        role: 'sdk-middleware',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Error handling HTTP da SDK API.',
    },
    {
        path: 'sdk/observability.js',
        kind: 'file',
        role: 'sdk-route',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Rotas de health, metrics, quota, logs, audit e eventos da SDK API.',
    },
    {
        path: 'sdk/session-crud.js',
        kind: 'file',
        role: 'sdk-route',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'CRUD, foreground, create, resume e compaction history de sessoes SDK.',
    },
    {
        path: 'sdk/session-messaging.js',
        kind: 'file',
        role: 'sdk-composition',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Composition router das familias de rotas de sessoes SDK.',
    },
    {
        path: 'sdk/session-core-routes.js',
        kind: 'file',
        role: 'sdk-session-route-family',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Send, stream, model, log, abort e messages de sessoes SDK.',
    },
    {
        path: 'sdk/session-middleware.js',
        kind: 'file',
        role: 'sdk-middleware',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Validação HTTP, model sanitizer, error wrapper e rate-limit da SDK session API.',
    },
    {
        path: 'sdk/session-schemas.js',
        kind: 'file',
        role: 'sdk-schema',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Schemas Zod dos bodies HTTP de sessoes SDK.',
    },
    {
        path: 'sdk/session-route-helpers.js',
        kind: 'file',
        role: 'sdk-session-helper',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Metadata runtime, ownership de sessao e lookup ativo para rotas SDK.',
    },
    {
        path: 'sdk/session-rpc-routes.js',
        kind: 'file',
        role: 'sdk-session-route-family',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Permissions, tools, commands, compaction e shell de sessoes SDK.',
    },
    {
        path: 'sdk/session-send-helpers.js',
        kind: 'file',
        role: 'sdk-session-helper',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Helpers de envio de mensagem, timeout desabilitado e limite de prompt.',
    },
    {
        path: 'sdk/session-stream-state.js',
        kind: 'file',
        role: 'sdk-session-stream',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Estado local e lifecycle do SSE de sessoes SDK.',
    },
    {
        path: 'sdk/session-ui-routes.js',
        kind: 'file',
        role: 'sdk-session-route-family',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Capabilities e operacoes UI de sessoes SDK.',
    },
    {
        path: 'sdk/session-workspace-routes.js',
        kind: 'file',
        role: 'sdk-session-route-family',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Rotas de workspace virtual de sessoes SDK.',
    },
    {
        path: 'sdk/session-workspace-helpers.js',
        kind: 'file',
        role: 'sdk-session-helper',
        surface: 'sdk',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Validacao de caminhos do workspace virtual SDK.',
    },
    {
        path: 'sdk/sessions.js',
        kind: 'file',
        role: 'sdk-composition',
        surface: 'sdk',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Composition router de sessions SDK.',
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
 * @param {ServerRouteModuleRole} role
 * @returns {ServerRouteModuleDescriptor[]}
 */
export function listServerRouteModulesByRole(role) {
    return SERVER_ROUTE_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {ServerRouteModuleSurface} surface
 * @returns {ServerRouteModuleDescriptor[]}
 */
export function listServerRouteModulesBySurface(surface) {
    return SERVER_ROUTE_MODULE_LAYOUT.filter((entry) => entry.surface === surface);
}

/**
 * @param {ServerRouteModuleRisk} risk
 * @returns {ServerRouteModuleDescriptor[]}
 */
export function listServerRouteModulesByRisk(risk) {
    return SERVER_ROUTE_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * @param {string} path
 * @returns {ServerRouteModuleDescriptor | undefined}
 */
export function getServerRouteModuleDescriptor(path) {
    return SERVER_ROUTE_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {ServerRouteModuleRole | undefined}
 */
export function getServerRouteModuleRole(path) {
    return getServerRouteModuleDescriptor(path)?.role;
}

/**
 * Scorecard leve de organização física da borda de rotas.
 *
 * @returns {{
 *     total: number;
 *     bySurface: Record<string, number>;
 *     byRole: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     hotspots: string[];
 *     watch: string[];
 * }}
 */
export function buildServerRouteModuleScorecard() {
    /** @type {Record<string, number>} */
    const bySurface = {};
    /** @type {Record<string, number>} */
    const byRole = {};
    /** @type {Record<string, number>} */
    const byRisk = {};
    /** @type {string[]} */
    const hotspots = [];
    /** @type {string[]} */
    const watch = [];

    for (const entry of SERVER_ROUTE_MODULE_LAYOUT) {
        increment(bySurface, entry.surface);
        increment(byRole, entry.role);
        increment(byRisk, entry.risk);
        if (entry.risk === 'hotspot') hotspots.push(entry.path);
        if (entry.risk === 'watch') watch.push(entry.path);
    }

    return {
        total: SERVER_ROUTE_MODULE_LAYOUT.length,
        bySurface,
        byRole,
        byRisk,
        hotspots: hotspots.sort(),
        watch: watch.sort(),
    };
}
