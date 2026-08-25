// @ts-check
/** White-box testing surface for Cloudflare transport benchmark semantics. */

export {
    buildComparison,
    buildTransportBenchmarkLaunchEnvironment,
    buildTransportBenchmarkSmokeEnvironment,
    buildTransportMetricDelta,
    classifyTransportWindow,
    spawnCloudflareTransportBenchmarkWithDependencies,
} from '../runtime.js';

export { buildCloudflareTransportBenchmarkPlan, summarizePersistedBenchmarkState } from '../plan.js';
