// @ts-check
/**
 * Infra-owned policy wrapper over the domain-neutral public-surface cost engine.
 *
 * Mechanics live in public-api-cost-engine.js. Infra retains ownership only of its semantic manifest,
 * tier limits and versioned baseline.
 *
 * @module copilot/infra/governance/public-api-cost
 */

import { buildPublicSurfaceCostReport } from './public-api-cost-engine.js';

export {
    buildStaticImportClosure,
    createStaticImportClosureAnalyzer,
    listStaticModuleEdges,
    listStaticModuleSpecifiers,
} from './public-api-cost-engine.js';

/**
 * Evaluate every Infra public entrypoint against its versioned closure baseline and declared cost tier.
 * @param {{ manifest?: readonly import('./public-api-manifest.js').PublicApiDescriptor[] }} [options]
 */
export async function buildInfraPublicApiCostReport(options = {}) {
    const { INFRA_PUBLIC_API_COST_BASELINE } = await import('./public-api-cost-baseline.js');
    const { INFRA_PUBLIC_API_COST_TIER_LIMITS, INFRA_PUBLIC_API_MANIFEST } = await import('./public-api-manifest.js');
    return buildPublicSurfaceCostReport({
        manifest: options.manifest ?? INFRA_PUBLIC_API_MANIFEST,
        baseline: INFRA_PUBLIC_API_COST_BASELINE,
        tierLimits: INFRA_PUBLIC_API_COST_TIER_LIMITS,
    });
}
