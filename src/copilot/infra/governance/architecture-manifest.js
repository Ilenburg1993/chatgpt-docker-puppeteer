// @ts-check
/**
 * Declarative architecture manifest for `src/copilot/infra`.
 *
 * The manifest describes capability ownership only. Leaf-file inventory is intentionally derived from the filesystem
 * by governance tooling instead of being duplicated as a second source of truth.
 *
 * @module copilot/infra/governance/architecture-manifest
 */

/**
 * @typedef {'file' | 'directory'} InfraModuleKind
 * @typedef {'barrel'
 *     | 'inventory'
 *     | 'documentation'
 *     | 'governance'
 *     | 'composition'
 *     | 'platform-foundation'
 *     | 'process-foundation'
 *     | 'filesystem-capability'
 *     | 'database-foundation'
 *     | 'persistence'
 *     | 'io-cache'
 *     | 'code-analysis'
 *     | 'indexing-capability'
 *     | 'concurrency-foundation'
 *     | 'operations'
 *     | 'telemetry-foundation'
 *     | 'observability'
 *     | 'policy-foundation'
 *     | 'testing'
 *     | 'public-api'} InfraModuleRole
 * @typedef {'primary' | 'secondary' | 'internal'} InfraModuleTier
 * @typedef {'stable' | 'watch' | 'hotspot'} InfraModuleRisk
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

export const INFRA_ARCHITECTURE_MANIFEST = /** @type {readonly InfraModuleDescriptor[]} */ (
    Object.freeze(
        [
            {
                path: 'README.md',
                kind: 'file',
                role: 'documentation',
                tier: 'secondary',
                risk: 'watch',
                public: false,
                summary: 'Human-facing charter, boundaries and migration guidance for infra.',
            },
            {
                path: 'public/',
                kind: 'directory',
                role: 'public-api',
                tier: 'primary',
                risk: 'stable',
                public: true,
                summary:
                    'Exclusive outward-facing API membrane; only declared entrypoints own projection barrels, with no implementation ownership.',
            },
            {
                path: 'governance/',
                kind: 'directory',
                role: 'governance',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary: 'Architecture manifest, scorecard and machine-enforced ownership metadata.',
            },
            {
                path: 'composition/',
                kind: 'directory',
                role: 'composition',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Explicit ProcessInfra, InfraRuntime and WorkspaceInfra ownership/lifecycle scopes.',
            },
            {
                path: 'platform/',
                kind: 'directory',
                role: 'platform-foundation',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary: 'Node/process/buffer/text primitives independent from higher-level capabilities.',
            },
            {
                path: 'process/',
                kind: 'directory',
                role: 'process-foundation',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Generic subprocess execution and attached-child supervision with bounded lifecycle ownership.',
            },
            {
                path: 'concurrency/',
                kind: 'directory',
                role: 'concurrency-foundation',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Bulk execution, bounded queues and resource/file locking.',
            },
            {
                path: 'filesystem/',
                kind: 'directory',
                role: 'filesystem-capability',
                tier: 'primary',
                risk: 'hotspot',
                public: false,
                summary:
                    'Read, transaction, write, mutation, patch, invalidation and workspace/configured filesystem boundaries.',
            },
            {
                path: 'database/',
                kind: 'directory',
                role: 'database-foundation',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary: 'Injected database composition port shared by cache, indexing and filesystem coherence.',
            },
            {
                path: 'persistence/',
                kind: 'directory',
                role: 'persistence',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Shared JSON and JSONL technical persistence.',
            },
            {
                path: 'cache/',
                kind: 'directory',
                role: 'io-cache',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Memory/SQLite cache ownership, registry and tiering.',
            },
            {
                path: 'code-analysis/',
                kind: 'directory',
                role: 'code-analysis',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary: 'Pure structural parsing/extraction primitives without runtime IO ownership.',
            },
            {
                path: 'indexing/',
                kind: 'directory',
                role: 'indexing-capability',
                tier: 'primary',
                risk: 'hotspot',
                public: false,
                summary: 'Scanner, parser runtime, search, SQLite index and session/workspace context.',
            },
            {
                path: 'operations/',
                kind: 'directory',
                role: 'operations',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Operation envelopes, change sets, audit and rollback execution.',
            },
            {
                path: 'telemetry/',
                kind: 'directory',
                role: 'telemetry-foundation',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary:
                    'Producer-side metrics, lifecycle events and advisory-budget primitives with no health projections.',
            },
            {
                path: 'observability/',
                kind: 'directory',
                role: 'observability',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary: 'Read-side health and diagnostic projections over lower infra capabilities.',
            },
            {
                path: 'policy/',
                kind: 'directory',
                role: 'policy-foundation',
                tier: 'primary',
                risk: 'watch',
                public: false,
                summary: 'Truly transversal budgets, output windows, risk and path-resource policy.',
            },
            {
                path: 'testing/',
                kind: 'directory',
                role: 'testing',
                tier: 'primary',
                risk: 'stable',
                public: false,
                summary: 'Deliberately restricted reset/test support boundary.',
            },
        ].map((entry) => Object.freeze(entry)),
    )
);

export const INFRA_PRIMARY_CAPABILITY_PATHS = Object.freeze(
    INFRA_ARCHITECTURE_MANIFEST.filter((entry) => entry.tier === 'primary' && entry.role !== 'public-api').map(
        (entry) => entry.path,
    ),
);

export const INFRA_PUBLIC_ENTRY_PATHS = Object.freeze(
    INFRA_ARCHITECTURE_MANIFEST.filter((entry) => entry.public).map((entry) => entry.path),
);
