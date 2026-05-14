// @ts-check
/**
 * Mapa navegável da borda SDK do Copilot.
 *
 * Este mapa governa a raiz de `sdk/` e seus subdomínios canônicos. Ele não substitui os barrels; serve como contrato
 * executável de ownership, risco, public surface e ordem de decomposição.
 */

/**
 * @typedef {'file' | 'directory'} SdkModuleKind
 *
 * @typedef {'barrel'
 *     | 'inventory'
 *     | 'docs'
 *     | 'contract'
 *     | 'config'
 *     | 'helper'
 *     | 'surface'
 *     | 'surface-entry'
 *     | 'composition-root'
 *     | 'registry'
 *     | 'feature-flag'
 *     | 'logger'
 *     | 'telemetry'
 *     | 'adapter'
 *     | 'experimental-surface'} SdkModuleRole
 *
 *
 * @typedef {'root' | 'agent' | 'models' | 'rpc' | 'session' | 'telemetry' | 'tools'} SdkModuleSurface
 *
 * @typedef {'primary' | 'secondary' | 'internal'} SdkModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} SdkModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: SdkModuleKind;
 *     role: SdkModuleRole;
 *     surface: SdkModuleSurface;
 *     tier: SdkModuleTier;
 *     risk: SdkModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} SdkModuleDescriptor
 */

/** @type {readonly SdkModuleDescriptor[]} */
export const SDK_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        kind: 'file',
        role: 'barrel',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel público canônico do SDK vanilla e composition root de contratos raiz.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'inventory',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventário executável da borda SDK e das surfaces canônicas.',
    },
    {
        path: 'README.md',
        kind: 'file',
        role: 'docs',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Guia canônico da surface SDK, aliases e fronteiras de arquitetura 2.0/2.1.',
    },
    {
        path: 'constants.js',
        kind: 'file',
        role: 'contract',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Constantes fundamentais e enums canônicos do SDK.',
    },
    {
        path: 'di-tokens.js',
        kind: 'file',
        role: 'contract',
        surface: 'root',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Tokens DI da camada SDK usados por bootstrap e composition roots.',
    },
    {
        path: 'errors.js',
        kind: 'file',
        role: 'contract',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Modelo canônico de erro do SDK e classificação operacional.',
    },
    {
        path: 'event-helpers.js',
        kind: 'file',
        role: 'helper',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Helpers de event wiring e espera de eventos da camada SDK.',
    },
    {
        path: 'feature-flags.js',
        kind: 'file',
        role: 'feature-flag',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Flags experimentais do SDK e taxonomia de capacidades gated.',
    },
    {
        path: 'http-request.js',
        kind: 'file',
        role: 'helper',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'HTTP client utilitário usado por wrappers e integrações do SDK.',
    },
    {
        path: 'logger.js',
        kind: 'file',
        role: 'logger',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Setter de logger do SDK e bridge para observabilidade local.',
    },
    {
        path: 'persistent-paths.js',
        kind: 'file',
        role: 'helper',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Cálculo de paths persistentes e workspace paths da camada SDK.',
    },
    {
        path: 'types.js',
        kind: 'file',
        role: 'contract',
        surface: 'root',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'SSOT JSDoc dos tipos do SDK e tipos locais do projeto.',
    },
    {
        path: 'utils.js',
        kind: 'file',
        role: 'helper',
        surface: 'root',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Helpers genéricos semânticos reutilizados pelo SDK vanilla.',
    },
    {
        path: 'agent/',
        kind: 'directory',
        role: 'surface',
        surface: 'agent',
        tier: 'primary',
        risk: 'watch',
        public: true,
        summary: 'Subsurface canônica de agentes do SDK.',
    },
    {
        path: 'agent/index.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'agent',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico para listagem, criação e seleção de agentes do SDK.',
    },
    {
        path: 'models/',
        kind: 'directory',
        role: 'surface',
        surface: 'models',
        tier: 'primary',
        risk: 'watch',
        public: true,
        summary: 'Subsurface de modelos, capabilities e seleção do SDK.',
    },
    {
        path: 'models/index.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'models',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico do domínio de modelos do SDK.',
    },
    {
        path: 'rpc/',
        kind: 'directory',
        role: 'surface',
        surface: 'rpc',
        tier: 'primary',
        risk: 'hotspot',
        public: true,
        summary: 'Subsurface RPC canônica do SDK: session, server, ops e experimental controlado.',
    },
    {
        path: 'rpc/index.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'rpc',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico das operações RPC estáveis do SDK.',
    },
    {
        path: 'rpc/server.js',
        kind: 'file',
        role: 'adapter',
        surface: 'rpc',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Facade RPC server-side para health, model list, quota e tools.',
    },
    {
        path: 'rpc/session.js',
        kind: 'file',
        role: 'adapter',
        surface: 'rpc',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Facade RPC de sessão estável, usada por rotas e wrappers do SDK.',
    },
    {
        path: 'rpc/ops.js',
        kind: 'file',
        role: 'adapter',
        surface: 'rpc',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Operações RPC vanilla agrupadas por semântica de comando e sessão.',
    },
    {
        path: 'rpc/session-facade.js',
        kind: 'file',
        role: 'composition-root',
        surface: 'rpc',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Façade canônica entre session runtime e RPC vanilla.',
    },
    {
        path: 'rpc/guards.js',
        kind: 'file',
        role: 'helper',
        surface: 'rpc',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Guards semânticos e narrowings para RPC do SDK.',
    },
    {
        path: 'rpc/experimental.js',
        kind: 'file',
        role: 'experimental-surface',
        surface: 'rpc',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Surface experimental limitada e gated: fleet, skills, mcp/oauth, plugins, extensions, history e usage.',
    },
    {
        path: 'session/',
        kind: 'directory',
        role: 'surface',
        surface: 'session',
        tier: 'primary',
        risk: 'hotspot',
        public: true,
        summary: 'Subsurface canônica de sessão, lifecycle, input, UI e hooks do SDK.',
    },
    {
        path: 'session/index.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'session',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico de sessão do SDK.',
    },
    {
        path: 'session/client.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'session',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Client runtime e lifecycle principal do SDK.',
    },
    {
        path: 'session/lifecycle.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'session',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Lifecycle de criação, retomada, deleção e auto-resolução de sessão.',
    },
    {
        path: 'session/runtime.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'session',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Runtime de sessão: send, abort, dispose e estado observável.',
    },
    {
        path: 'telemetry/',
        kind: 'directory',
        role: 'surface',
        surface: 'telemetry',
        tier: 'primary',
        risk: 'watch',
        public: true,
        summary: 'Subsurface de tracing, health, quota e métricas do SDK.',
    },
    {
        path: 'telemetry/index.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'telemetry',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico de telemetry do SDK.',
    },
    {
        path: 'telemetry/health.js',
        kind: 'file',
        role: 'telemetry',
        surface: 'telemetry',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Health checks e status operacional da camada SDK.',
    },
    {
        path: 'telemetry/tracing.js',
        kind: 'file',
        role: 'telemetry',
        surface: 'telemetry',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Configuração de tracing e telemetria OpenTelemetry do SDK.',
    },
    {
        path: 'telemetry/quota-monitor.js',
        kind: 'file',
        role: 'telemetry',
        surface: 'telemetry',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Monitor de quota e rate-limit da camada SDK.',
    },
    {
        path: 'telemetry/preflight.js',
        kind: 'file',
        role: 'telemetry',
        surface: 'telemetry',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Preflight canônico do SDK/CLI usado pelo boot antes de expor HTTP/REPL.',
    },
    {
        path: 'tools/',
        kind: 'directory',
        role: 'surface',
        surface: 'tools',
        tier: 'primary',
        risk: 'hotspot',
        public: true,
        summary: 'Subsurface de tools, registry, state e políticas do SDK.',
    },
    {
        path: 'tools/index.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'tools',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico de tools do SDK.',
    },
    {
        path: 'tools/core.js',
        kind: 'file',
        role: 'surface-entry',
        surface: 'tools',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Factories centrais e helpers de definição/normalização de tool.',
    },
    {
        path: 'tools/registry.js',
        kind: 'file',
        role: 'registry',
        surface: 'tools',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Registry canônico de tools por sessão e categorias.',
    },
    {
        path: 'tools/custom.js',
        kind: 'file',
        role: 'registry',
        surface: 'tools',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Builder e registry de custom tools do SDK.',
    },
    {
        path: 'tools/state.js',
        kind: 'file',
        role: 'registry',
        surface: 'tools',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Estado local de tools e persistência de configuração.',
    },
    {
        path: 'tools/agent-policy.js',
        kind: 'file',
        role: 'registry',
        surface: 'tools',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Policy de ferramentas vinculadas a agentes e read-only/full-access.',
    },
]);

/**
 * Lista módulos por role.
 *
 * @param {SdkModuleRole} role
 * @returns {SdkModuleDescriptor[]}
 */
export function listSdkModulesByRole(role) {
    return SDK_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * Lista módulos por surface.
 *
 * @param {SdkModuleSurface} surface
 * @returns {SdkModuleDescriptor[]}
 */
export function listSdkModulesBySurface(surface) {
    return SDK_MODULE_LAYOUT.filter((entry) => entry.surface === surface);
}

/**
 * Localiza um módulo do SDK pelo path canônico.
 *
 * @param {string} path
 * @returns {SdkModuleDescriptor | undefined}
 */
export function getSdkModuleDescriptor(path) {
    return SDK_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * Obtém o role canônico de um módulo do SDK.
 *
 * @param {string} path
 * @returns {SdkModuleRole | undefined}
 */
export function getSdkModuleRole(path) {
    return getSdkModuleDescriptor(path)?.role;
}

/**
 * Obtém a surface canônica de um módulo do SDK.
 *
 * @param {string} path
 * @returns {SdkModuleSurface | undefined}
 */
export function getSdkModuleSurface(path) {
    return getSdkModuleDescriptor(path)?.surface;
}

/**
 * @typedef {'stable-root' | 'stable-subsurface' | 'stable-type-surface' | 'experimental-subsurface'} SdkAliasTier
 *
 * @typedef {{
 *     alias: string;
 *     target: string;
 *     tier: SdkAliasTier;
 *     summary: string;
 * }} SdkAliasDescriptor
 */

/** @type {readonly SdkAliasDescriptor[]} */
export const SDK_ALIAS_LAYOUT = Object.freeze([
    {
        alias: '#copilot/sdk',
        target: 'src/copilot/sdk/index.js',
        tier: 'stable-root',
        summary: 'Barrel raiz estável do SDK.',
    },
    {
        alias: '#copilot/sdk/session',
        target: 'src/copilot/sdk/session/index.js',
        tier: 'stable-subsurface',
        summary: 'Subsurface estável de sessão.',
    },
    {
        alias: '#copilot/sdk/constants',
        target: 'src/copilot/sdk/constants.js',
        tier: 'stable-subsurface',
        summary: 'Constantes públicas do SDK local.',
    },
    {
        alias: '#copilot/sdk/di',
        target: 'src/copilot/sdk/di-tokens.js',
        tier: 'stable-subsurface',
        summary: 'Tokens DI expostos pela fronteira SDK.',
    },
    {
        alias: '#copilot/sdk/errors',
        target: 'src/copilot/sdk/errors.js',
        tier: 'stable-subsurface',
        summary: 'Classificação e políticas de erro do SDK.',
    },
    {
        alias: '#copilot/sdk/event-helpers',
        target: 'src/copilot/sdk/event-helpers.js',
        tier: 'stable-subsurface',
        summary: 'Helpers genéricos de eventos sem dependências de sessão.',
    },
    {
        alias: '#copilot/sdk/feature-flags',
        target: 'src/copilot/sdk/feature-flags.js',
        tier: 'stable-subsurface',
        summary: 'Feature flags experimentais do SDK local.',
    },
    {
        alias: '#copilot/sdk/session-runtime',
        target: 'src/copilot/sdk/session/runtime.js',
        tier: 'stable-subsurface',
        summary: 'Runtime operacional de sessão (send/abort/dispose/model).',
    },
    {
        alias: '#copilot/sdk/rpc',
        target: 'src/copilot/sdk/rpc/index.js',
        tier: 'stable-subsurface',
        summary: 'Subsurface estável RPC.',
    },
    {
        alias: '#copilot/sdk/rpc/experimental',
        target: 'src/copilot/sdk/rpc/experimental.js',
        tier: 'experimental-subsurface',
        summary: 'Subsurface experimental restrita (fleet/skills/mcp/plugins/extensions).',
    },
    {
        alias: '#copilot/sdk/telemetry',
        target: 'src/copilot/sdk/telemetry/index.js',
        tier: 'stable-subsurface',
        summary: 'Subsurface de telemetry do SDK.',
    },
    {
        alias: '#copilot/sdk/tools',
        target: 'src/copilot/sdk/tools/index.js',
        tier: 'stable-subsurface',
        summary: 'Subsurface de tools do SDK.',
    },
    {
        alias: '#copilot/sdk/agents',
        target: 'src/copilot/sdk/agent/index.js',
        tier: 'stable-subsurface',
        summary: 'Subsurface de agentes do SDK.',
    },
    {
        alias: '#copilot/sdk/models',
        target: 'src/copilot/sdk/models/index.js',
        tier: 'stable-subsurface',
        summary: 'Subsurface de modelos, capabilities, seleção e auto-policy.',
    },
    {
        alias: '#copilot/sdk/types',
        target: 'src/copilot/sdk/types.js',
        tier: 'stable-type-surface',
        summary: 'Surface type-only canônica para JSDoc/tsserver.',
    },
    {
        alias: '#copilot/sdk/utils',
        target: 'src/copilot/sdk/utils.js',
        tier: 'stable-subsurface',
        summary: 'Utilitários mínimos e puros do SDK local.',
    },
]);

/**
 * @typedef {'agent'
 *     | 'boot'
 *     | 'config'
 *     | 'event-handlers'
 *     | 'hooks'
 *     | 'observability'
 *     | 'runtime-wiring.js'
 *     | 'server'
 *     | 'terminal'
 *     | 'tools'
 *     | 'audit'
 *     | 'events'
 *     | 'types'} SdkConsumerLayer
 *
 *
 * @typedef {{
 *     layer: SdkConsumerLayer;
 *     preferred: string[];
 *     allowed: string[];
 *     discouraged: string[];
 *     notes: string;
 * }} SdkLayerAccessPolicy
 */

/** @type {readonly SdkLayerAccessPolicy[]} */
export const SDK_LAYER_ACCESS_POLICY = Object.freeze([
    {
        layer: 'agent',
        preferred: [
            '#copilot/sdk/errors',
            '#copilot/sdk/event-helpers',
            '#copilot/sdk/feature-flags',
            '#copilot/sdk/session',
            '#copilot/sdk/session-runtime',
            '#copilot/sdk/rpc',
            '#copilot/sdk/tools',
            '#copilot/sdk/telemetry',
            '#copilot/sdk/models',
            '#copilot/sdk/utils',
        ],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Agent deve usar apenas subpaths semânticos e não depender do root amplo.',
    },
    {
        layer: 'boot',
        preferred: ['#copilot/sdk/di', '#copilot/sdk/session', '#copilot/sdk/telemetry'],
        allowed: ['#copilot/sdk', '#copilot/sdk/rpc'],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Boot usa root apenas para validação da surface pública; composição usa subpaths.',
    },
    {
        layer: 'config',
        preferred: ['#copilot/sdk/constants', '#copilot/sdk/session', '#copilot/sdk/rpc'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Config integra system-message e session setup; evita surfaces de execução.',
    },
    {
        layer: 'event-handlers',
        preferred: ['#copilot/sdk/session'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Event handlers traduzem SessionEvent e devem preferir contracts de session.',
    },
    {
        layer: 'hooks',
        preferred: ['#copilot/sdk/errors', '#copilot/sdk/session', '#copilot/sdk/models', '#copilot/sdk/constants'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Hooks devem operar por session contracts e evitar RPC direta.',
    },
    {
        layer: 'observability',
        preferred: ['#copilot/sdk/di', '#copilot/sdk/session', '#copilot/sdk/telemetry'],
        allowed: ['#copilot/sdk/tools'],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Observability lê eventos/session e telemetry, não policy operacional.',
    },
    {
        layer: 'runtime-wiring.js',
        preferred: ['#copilot/sdk/session', '#copilot/sdk/rpc'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Runtime-wiring atua como composition root e integra surfaces estáveis.',
    },
    {
        layer: 'server',
        preferred: ['#copilot/sdk/session', '#copilot/sdk/rpc', '#copilot/sdk/tools', '#copilot/sdk/telemetry', '#copilot/sdk/utils'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Rotas SDK devem evitar root amplo quando subpaths existem.',
    },
    {
        layer: 'terminal',
        preferred: ['#copilot/sdk/session', '#copilot/sdk/rpc'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Terminal usa SDK para mode/plan/runtime e não deve replicar vanilla SDK.',
    },
    {
        layer: 'tools',
        preferred: ['#copilot/sdk/tools', '#copilot/sdk/rpc', '#copilot/sdk/session'],
        allowed: ['#copilot/sdk/rpc/experimental'],
        discouraged: [],
        notes: 'Tools de sessão podem consumir RPC experimental quando explicitamente gated.',
    },
    {
        layer: 'audit',
        preferred: ['#copilot/sdk/constants', '#copilot/sdk/session'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Audit deve operar por contracts estáveis e não por surfaces experimentais.',
    },
    {
        layer: 'events',
        preferred: ['#copilot/sdk/session'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Eventos SDK devem nascer da surface de session.',
    },
    {
        layer: 'types',
        preferred: ['#copilot/sdk/di', '#copilot/sdk/types'],
        allowed: [],
        discouraged: ['#copilot/sdk/rpc/experimental'],
        notes: 'Camada de tipos consome contratos estáveis.',
    },
]);

/**
 * @param {SdkAliasTier} tier
 * @returns {SdkAliasDescriptor[]}
 */
export function listSdkAliasesByTier(tier) {
    return SDK_ALIAS_LAYOUT.filter((entry) => entry.tier === tier);
}

/**
 * @param {string} alias
 * @returns {SdkAliasDescriptor | undefined}
 */
export function getSdkAliasDescriptor(alias) {
    return SDK_ALIAS_LAYOUT.find((entry) => entry.alias === alias);
}

/**
 * @param {SdkConsumerLayer} layer
 * @returns {SdkLayerAccessPolicy | undefined}
 */
export function getSdkLayerAccessPolicy(layer) {
    return SDK_LAYER_ACCESS_POLICY.find((entry) => entry.layer === layer);
}

/**
 * Lista módulos por risco.
 *
 * @param {SdkModuleRisk} risk
 * @returns {SdkModuleDescriptor[]}
 */
export function listSdkModulesByRisk(risk) {
    return SDK_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * Scorecard leve de organização física do SDK.
 *
 * @returns {{
 *     total: number;
 *     publicCount: number;
 *     byKind: Record<string, number>;
 *     byRole: Record<string, number>;
 *     bySurface: Record<string, number>;
 *     byTier: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     hotspots: string[];
 *     watch: string[];
 * }}
 */
export function buildSdkModuleScorecard() {
    /** @param {Record<string, number>} acc @param {string} key */
    function increment(acc, key) {
        acc[key] = (acc[key] ?? 0) + 1;
    }

    /** @type {Record<string, number>} */
    const byKind = {};
    /** @type {Record<string, number>} */
    const byRole = {};
    /** @type {Record<string, number>} */
    const bySurface = {};
    /** @type {Record<string, number>} */
    const byTier = {};
    /** @type {Record<string, number>} */
    const byRisk = {};
    /** @type {string[]} */
    const hotspots = [];
    /** @type {string[]} */
    const watch = [];

    let publicCount = 0;
    for (const entry of SDK_MODULE_LAYOUT) {
        increment(byKind, entry.kind);
        increment(byRole, entry.role);
        increment(bySurface, entry.surface);
        increment(byTier, entry.tier);
        increment(byRisk, entry.risk);
        if (entry.public) publicCount += 1;
        if (entry.risk === 'hotspot') hotspots.push(entry.path);
        if (entry.risk === 'watch') watch.push(entry.path);
    }

    return {
        total: SDK_MODULE_LAYOUT.length,
        publicCount,
        byKind,
        byRole,
        bySurface,
        byTier,
        byRisk,
        hotspots: hotspots.sort(),
        watch: watch.sort(),
    };
}
