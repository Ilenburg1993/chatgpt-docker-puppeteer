// @ts-check
/**
 * Mapa navegável do subsistema `infra`.
 *
 * Inventário estático para a migração barrel-first 2.0/2.1. Ele separa portas públicas, motores internos e fundações
 * concorrentes/observáveis para que consumidores externos não precisem conhecer arquivos folha.
 *
 * @module copilot/infra/module-map
 */

import { readdirSync } from 'node:fs';

/**
 * @typedef {'file' | 'directory'} InfraModuleKind
 *
 * @typedef {'barrel'
 *     | 'inventory'
 *     | 'documentation'
 *     | 'public-facade'
 *     | 'shared-foundation'
 *     | 'policy-foundation'
 *     | 'scan-foundation'
 *     | 'parse-foundation'
 *     | 'index-store'
 *     | 'low-level-port'
 *     | 'io-engine'
 *     | 'io-cache'
 *     | 'io-index'
 *     | 'io-parser'
 *     | 'io-scope'
 *     | 'concurrency-foundation'
 *     | 'observability'
 *     | 'sse-foundation'
 *     | 'storage'
 *     | 'runtime-foundation'
 *     | 'webhook'
 *     | 'di'} InfraModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} InfraModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} InfraModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: InfraModuleKind;
 *     role: InfraModuleRole;
 *     tier: InfraModuleTier;
 *     risk: InfraModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} InfraModuleDescriptor
 */

/** @type {readonly InfraModuleDescriptor[]} */
export const INFRA_MODULE_LAYOUT = Object.freeze([
    {
        path: 'README.md',
        kind: 'file',
        role: 'documentation',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Guia humano do subsistema infra e suas fronteiras.',
    },
    {
        path: 'index.js',
        kind: 'file',
        role: 'barrel',
        tier: 'primary',
        risk: 'watch',
        public: true,
        summary: 'Barrel raiz de compatibilidade e agregação de contratos infra.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'inventory',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventário executável de papéis, tiers e riscos da raiz de infra.',
    },
    {
        path: 'public/',
        kind: 'directory',
        role: 'public-facade',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Facades públicas semânticas para consumidores fora de infra.',
    },
    {
        path: 'shared/',
        kind: 'directory',
        role: 'shared-foundation',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Helpers compartilhados de baixo nível sem dependências de domínio.',
    },
    {
        path: 'policy/',
        kind: 'directory',
        role: 'policy-foundation',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Policies internas de orçamento, janela de saída e normalização operacional.',
    },
    {
        path: 'scan/',
        kind: 'directory',
        role: 'scan-foundation',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Primitivas modulares de scan: glob, gitignore, batching e fingerprint.',
    },
    {
        path: 'parse/',
        kind: 'directory',
        role: 'parse-foundation',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Parsers puros sem dependência de IO/cache/session.',
    },
    {
        path: 'index-store/',
        kind: 'directory',
        role: 'index-store',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Stores persistentes do índice L2: schema, queries, paths e helpers SQLite.',
    },
    {
        path: 'io/',
        kind: 'directory',
        role: 'low-level-port',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Portas baixas de filesystem usadas por engines para evitar ciclos.',
    },
    {
        path: 'cache/',
        kind: 'directory',
        role: 'io-cache',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Subdomínios modulares de cache L1/L2/tiering durante a migração 2.0/2.1.',
    },
    {
        path: 'locks/',
        kind: 'directory',
        role: 'concurrency-foundation',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Barrels internos de locks em memória e lockfile.',
    },
    {
        path: 'queue/',
        kind: 'directory',
        role: 'concurrency-foundation',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Implementação modular da fila assíncrona.',
    },
    {
        path: 'storage/',
        kind: 'directory',
        role: 'storage',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Implementações modulares de storage local.',
    },
    {
        path: 'runtime/',
        kind: 'directory',
        role: 'runtime-foundation',
        tier: 'internal',
        risk: 'watch',
        public: false,
        summary: 'Operações rastreáveis, audit log opt-in, transações e rollback futuro.',
    },
    {
        path: 'io-engine.js',
        kind: 'file',
        role: 'io-engine',
        tier: 'primary',
        risk: 'hotspot',
        public: false,
        summary: 'Engine canônica de read/write/search local, cache L1/L2 e telemetria.',
    },
    {
        path: 'io-scanner.js',
        kind: 'file',
        role: 'io-engine',
        tier: 'primary',
        risk: 'hotspot',
        public: false,
        summary: 'Scanner canônico de diretórios com denylist, gitignore, fingerprint e batching.',
    },
    {
        path: 'io-prefetch.js',
        kind: 'file',
        role: 'io-engine',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Warmup e read-through context para cache e escopos de leitura.',
    },
    {
        path: 'io-cache.js',
        kind: 'file',
        role: 'io-cache',
        tier: 'primary',
        risk: 'watch',
        public: false,
        summary: 'Cache L1, chaves normalizadas e eventos de invalidação.',
    },
    {
        path: 'io-cache-l2-registry.js',
        kind: 'file',
        role: 'io-cache',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Registry global do cache L2 e health/stats.',
    },
    {
        path: 'io-cache-l2-sqlite.js',
        kind: 'file',
        role: 'io-cache',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Implementação SQLite do cache L2.',
    },
    {
        path: 'io-cache-tiering.js',
        kind: 'file',
        role: 'io-cache',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Planejamento e agregação de tiers de cache.',
    },
    {
        path: 'io-advisory-budget.js',
        kind: 'file',
        role: 'observability',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Budget advisory rolante para pressão de mutações e builds de índice.',
    },
    {
        path: 'io-index-registry.js',
        kind: 'file',
        role: 'io-index',
        tier: 'primary',
        risk: 'watch',
        public: false,
        summary: 'Registry global do índice L2/FTS.',
    },
    {
        path: 'io-index-sqlite.js',
        kind: 'file',
        role: 'io-index',
        tier: 'primary',
        risk: 'hotspot',
        public: false,
        summary: 'Indexador SQLite/FTS, símbolos, imports e freshness.',
    },
    {
        path: 'io-parser.js',
        kind: 'file',
        role: 'io-parser',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Parser de símbolos, outline, comentários e schema para contexto.',
    },
    {
        path: 'io-parser-worker.js',
        kind: 'file',
        role: 'io-parser',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Worker thread dedicado ao parse JS/TS off-main-thread com retorno de símbolos/imports/exports.',
    },
    {
        path: 'io-session-scope.js',
        kind: 'file',
        role: 'io-scope',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Escopos declarados pela sessão e índices simbólicos por contexto.',
    },
    {
        path: 'io-health.js',
        kind: 'file',
        role: 'observability',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Snapshot de saúde runtime do subsistema de I/O.',
    },
    {
        path: 'io-observability.js',
        kind: 'file',
        role: 'observability',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Publicação de eventos e lifecycle de operações de I/O.',
    },
    {
        path: 'io-locks.js',
        kind: 'file',
        role: 'concurrency-foundation',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Locks em memória por recurso normalizado.',
    },
    {
        path: 'lockfile.js',
        kind: 'file',
        role: 'concurrency-foundation',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Lockfile atômico interprocesso.',
    },
    {
        path: 'queue.js',
        kind: 'file',
        role: 'concurrency-foundation',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Facade de compatibilidade para queue/.',
    },
    {
        path: 'sse/',
        kind: 'directory',
        role: 'sse-foundation',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Fanout, replay buffer e estado SSE.',
    },
    {
        path: 'storage.js',
        kind: 'file',
        role: 'storage',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Facade de compatibilidade para storage/.',
    },
    {
        path: 'webhooks.js',
        kind: 'file',
        role: 'webhook',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Infraestrutura de webhooks do runtime (integra com #copilot/config e #copilot/core).',
    },
    {
        path: 'di-tokens.js',
        kind: 'file',
        role: 'di',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Tokens DI locais de infraestrutura.',
    },
]);

/**
 * Conta entradas por chave usando a API nativa do baseline Node 24.
 *
 * @template T
 * @param {readonly T[]} entries
 * @param {(entry: T) => string} selector
 * @returns {Record<string, number>}
 */
function countBy(entries, selector) {
    const grouped = Object.groupBy(entries, selector);
    return Object.fromEntries(Object.entries(grouped).map(([key, values]) => [key, values?.length ?? 0]));
}

/**
 * @param {InfraModuleRole} role
 * @returns {InfraModuleDescriptor[]}
 */
export function listInfraModulesByRole(role) {
    return INFRA_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {InfraModuleRisk} risk
 * @returns {InfraModuleDescriptor[]}
 */
export function listInfraModulesByRisk(risk) {
    return INFRA_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * @param {string} path
 * @returns {InfraModuleDescriptor | undefined}
 */
export function getInfraModuleDescriptor(path) {
    return INFRA_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * Scorecard leve da topologia de infra/ para auditoria arquitetural contínua.
 *
 * @returns {{
 *     total: number;
 *     byKind: Record<string, number>;
 *     byRole: Record<string, number>;
 *     byTier: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     publicEntries: string[];
 *     hotspots: string[];
 *     drift: {
 *         available: boolean;
 *         missingInLayout: string[];
 *         staleInLayout: string[];
 *     };
 * }}
 */
export function buildInfraModuleScorecard() {
    const byKind = countBy(INFRA_MODULE_LAYOUT, (entry) => entry.kind);
    const byRole = countBy(INFRA_MODULE_LAYOUT, (entry) => entry.role);
    const byTier = countBy(INFRA_MODULE_LAYOUT, (entry) => entry.tier);
    const byRisk = countBy(INFRA_MODULE_LAYOUT, (entry) => entry.risk);
    const publicEntries = INFRA_MODULE_LAYOUT.filter((entry) => entry.public).map((entry) => entry.path);
    const hotspots = INFRA_MODULE_LAYOUT.filter((entry) => entry.risk === 'hotspot').map((entry) => entry.path);

    /** @type {{ available: boolean; missingInLayout: string[]; staleInLayout: string[] }} */
    const drift = {
        available: false,
        missingInLayout: [],
        staleInLayout: [],
    };

    try {
        const infraRoot = import.meta.dirname;
        const actualEntries = readdirSync(infraRoot, { withFileTypes: true })
            .filter((entry) => entry.name === 'README.md' || entry.name.endsWith('.js') || entry.isDirectory())
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .sort();
        const mappedEntries = INFRA_MODULE_LAYOUT.map((entry) => entry.path).sort();

        const mappedSet = new Set(mappedEntries);
        const actualSet = new Set(actualEntries);

        drift.available = true;
        drift.missingInLayout = actualEntries.filter((path) => !mappedSet.has(path));
        drift.staleInLayout = mappedEntries.filter((path) => !actualSet.has(path));
    } catch {
        // best effort: scorecard não deve falhar por limitações de filesystem/runtime.
    }

    return {
        total: INFRA_MODULE_LAYOUT.length,
        byKind,
        byRole,
        byTier,
        byRisk,
        publicEntries: publicEntries.sort(),
        hotspots: hotspots.sort(),
        drift,
    };
}
