// @ts-check
/**
 * Mapa navegável do subsistema `tools`.
 *
 * Inventário estático para governança arquitetural: torna explícito o papel de cada módulo raiz, evitando diretórios
 * opacos e reduzindo regressão de boundary.
 */

/**
 * @typedef {'file' | 'directory'} ToolsModuleKind
 *
 * @typedef {'entrypoint'
 *     | 'orchestrator'
 *     | 'inventory'
 *     | 'documentation'
 *     | 'infra-foundation'
 *     | 'domain-surface'
 *     | 'state-surface'} ToolsModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} ToolsModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} ToolsModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: ToolsModuleKind;
 *     role: ToolsModuleRole;
 *     tier: ToolsModuleTier;
 *     risk: ToolsModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} ToolsModuleDescriptor
 */

/** @type {readonly ToolsModuleDescriptor[]} */
export const TOOLS_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel canônico e único hub de contato externo do subsistema tools.',
    },
    {
        path: 'bootstrap.js',
        kind: 'file',
        role: 'orchestrator',
        tier: 'primary',
        risk: 'hotspot',
        public: true,
        summary: 'Composition root de registro das tools no SDK, instrumentação e contract checks.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'inventory',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventário executável da raiz de tools (papéis, tiers, risco e scorecard).',
    },
    {
        path: 'README.md',
        kind: 'file',
        role: 'documentation',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Guia canônico de escopo, fronteiras e navegação de tools/.',
    },
    {
        path: 'infra/',
        kind: 'directory',
        role: 'infra-foundation',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Fundação interna: factory canônica, logger injetável e proxy de métricas.',
    },
    {
        path: 'introspection/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de introspecção de registry e verificador de contratos de tool metadata.',
    },
    {
        path: 'session/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Superfície de sessão (session tools + RPC + experimental fleet).',
    },
    {
        path: 'file/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de filesystem (read/write/index/scope). Search tools migradas para search/.',
    },
    {
        path: 'search/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Domínio canônico de search: text-search, symbol-search e find-symbol-usages.',
    },
    {
        path: 'shell/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Superfície de execução shell sandboxada (exec, npm scripts e node files).',
    },
    {
        path: 'todo/',
        kind: 'directory',
        role: 'state-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Superfície stateful de TODOs (store local, read/write, bulk e query).',
    },
    {
        path: 'task/',
        kind: 'directory',
        role: 'state-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de consulta/inspeção de tarefas e artefatos de execução do runtime.',
    },
    {
        path: 'hook/',
        kind: 'directory',
        role: 'state-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Bridge de hook-state e fila de input estruturado com resolução/cancelamento.',
    },
    {
        path: 'hub/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de ConversationHub para sessões, polling de mensagens e histórico.',
    },
    {
        path: 'permission/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de governança de modo de aprovação em runtime (approve/audit/selective).',
    },
    {
        path: 'web/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de I/O web com SSRF guardrails e políticas de volume/telemetria.',
    },
    {
        path: 'git/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de comandos Git de suporte ao fluxo de desenvolvimento assistido.',
    },
    {
        path: 'code/',
        kind: 'directory',
        role: 'domain-surface',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Superfície de qualidade estática/dinâmica (lint, tests e typecheck).',
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
 * Conta entradas por chave usando `Object.groupBy` quando disponível (Node 24+), com fallback seguro.
 *
 * @template T
 * @param {readonly T[]} entries
 * @param {(entry: T) => string} selector
 * @returns {Record<string, number>}
 */
function countBy(entries, selector) {
    const objectCtor =
        /** @type {{ groupBy?: (items: readonly T[], fn: (item: T) => string) => Record<string, T[]> }} */ (Object);
    if (typeof objectCtor.groupBy === 'function') {
        const grouped = objectCtor.groupBy(entries, selector);
        return Object.fromEntries(Object.entries(grouped).map(([key, values]) => [key, values.length]));
    }

    /** @type {Record<string, number>} */
    const fallback = {};
    for (const entry of entries) {
        increment(fallback, selector(entry));
    }
    return fallback;
}

/**
 * @param {ToolsModuleRole} role
 * @returns {ToolsModuleDescriptor[]}
 */
export function listToolsModulesByRole(role) {
    return TOOLS_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {ToolsModuleRisk} risk
 * @returns {ToolsModuleDescriptor[]}
 */
export function listToolsModulesByRisk(risk) {
    return TOOLS_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * @param {string} path
 * @returns {ToolsModuleDescriptor | undefined}
 */
export function getToolsModuleDescriptor(path) {
    return TOOLS_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {ToolsModuleRole | undefined}
 */
export function getToolsModuleRole(path) {
    return getToolsModuleDescriptor(path)?.role;
}

/**
 * Scorecard leve da topologia de tools/ para auditoria arquitetural contínua.
 *
 * @returns {{
 *     total: number;
 *     byKind: Record<string, number>;
 *     byRole: Record<string, number>;
 *     byTier: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     publicEntries: string[];
 *     hotspots: string[];
 * }}
 */
export function buildToolsModuleScorecard() {
    const byKind = countBy(TOOLS_MODULE_LAYOUT, (entry) => entry.kind);
    const byRole = countBy(TOOLS_MODULE_LAYOUT, (entry) => entry.role);
    const byTier = countBy(TOOLS_MODULE_LAYOUT, (entry) => entry.tier);
    const byRisk = countBy(TOOLS_MODULE_LAYOUT, (entry) => entry.risk);
    const publicEntries = TOOLS_MODULE_LAYOUT.filter((entry) => entry.public).map((entry) => entry.path);
    const hotspots = TOOLS_MODULE_LAYOUT.filter((entry) => entry.risk === 'hotspot').map((entry) => entry.path);

    return {
        total: TOOLS_MODULE_LAYOUT.length,
        byKind,
        byRole,
        byTier,
        byRisk,
        publicEntries: publicEntries.sort(),
        hotspots: hotspots.sort(),
    };
}
