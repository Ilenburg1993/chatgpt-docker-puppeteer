// @ts-check
/**
 * Query surface for infra architecture metadata.
 *
 * The semantic source of truth lives in `architecture-manifest.js`. This module intentionally contains no
 * second hand-maintained topology; it only exposes the historical query API and compares the manifest with the real
 * top-level filesystem when a scorecard is requested.
 *
 * @module copilot/infra/governance/module-map
 */

import { readdirSync } from 'node:fs';
import {
    INFRA_ARCHITECTURE_MANIFEST,
    INFRA_LEGACY_ROOT_PATHS,
    INFRA_PRIMARY_CAPABILITY_PATHS,
} from './architecture-manifest.js';

/** @typedef {import('./architecture-manifest.js').InfraModuleDescriptor} InfraModuleDescriptor */
/** @typedef {InfraModuleDescriptor['role']} InfraModuleRole */
/** @typedef {InfraModuleDescriptor['risk']} InfraModuleRisk */

/**
 * Historical export retained for callers/tests. It now aliases the architecture manifest rather than duplicating it.
 */
export const INFRA_MODULE_LAYOUT = INFRA_ARCHITECTURE_MANIFEST;
export { INFRA_LEGACY_ROOT_PATHS, INFRA_PRIMARY_CAPABILITY_PATHS };

/**
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
 * Scorecard of the declared architecture against the actual top-level infra filesystem.
 *
 * `missingInLayout` means a new top-level item exists without an ownership decision. `staleInLayout` means the
 * manifest still declares a path that no longer exists. Both are architecture-governance failures, not file-inventory
 * bookkeeping.
 *
 * @returns {{
 *     total: number;
 *     byKind: Record<string, number>;
 *     byRole: Record<string, number>;
 *     byTier: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     publicEntries: string[];
 *     hotspots: string[];
 *     primaryCapabilities: readonly string[];
 *     legacyRoots: readonly string[];
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
    const publicEntries = INFRA_MODULE_LAYOUT.filter((entry) => entry.public)
        .map((entry) => entry.path)
        .sort();
    const hotspots = INFRA_MODULE_LAYOUT.filter((entry) => entry.risk === 'hotspot')
        .map((entry) => entry.path)
        .sort();

    /** @type {{ available: boolean; missingInLayout: string[]; staleInLayout: string[] }} */
    const drift = { available: false, missingInLayout: [], staleInLayout: [] };

    try {
        const actualEntries = readdirSync(new URL('../', import.meta.url), { withFileTypes: true })
            .filter((entry) => entry.name === 'README.md' || entry.name.endsWith('.js') || entry.isDirectory())
            .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
            .sort();
        const declaredEntries = INFRA_MODULE_LAYOUT.map((entry) => entry.path).sort();
        const declaredSet = new Set(declaredEntries);
        const actualSet = new Set(actualEntries);

        drift.available = true;
        drift.missingInLayout = actualEntries.filter((path) => !declaredSet.has(path));
        drift.staleInLayout = declaredEntries.filter((path) => !actualSet.has(path));
    } catch {
        // Best effort: architecture metadata must remain queryable in constrained runtimes.
    }

    return {
        total: INFRA_MODULE_LAYOUT.length,
        byKind,
        byRole,
        byTier,
        byRisk,
        publicEntries,
        hotspots,
        primaryCapabilities: INFRA_PRIMARY_CAPABILITY_PATHS,
        legacyRoots: INFRA_LEGACY_ROOT_PATHS,
        drift,
    };
}
