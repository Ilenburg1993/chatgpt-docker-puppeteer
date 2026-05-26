// @ts-check
/**
 * Disposable model-gateway probes.
 *
 * Probes exercise the same provider/model/session contracts used by live routing, but run in temporary sessions so
 * health checks and operator diagnostics do not mutate the canonical dialog loop.
 *
 * @module copilot/model-gateway/probes
 */

export { runConfiguredByokChatProbe } from './chat-probe.js';
export {
    BYOK_AGENT_PROBE_ANSWER,
    BYOK_AGENT_PROBE_QUESTION,
    BYOK_AGENT_PROBE_READ_PATH,
    BYOK_AGENT_PROBE_READ_TOOL,
    BYOK_AGENT_PROBE_TOOL,
    runConfiguredByokAgentProbe,
} from './agent-probe.js';
export { runConfiguredByokJsonProbe } from './json-probe.js';
export { runConfiguredByokStreamingProbe } from './streaming-probe.js';
export {
    BYOK_VISION_PROBE_DISPLAY_NAME,
    BYOK_VISION_PROBE_MIME_TYPE,
    runConfiguredByokVisionProbe,
} from './vision-probe.js';
export { estimateProbeCostUsd, planCostBoundedCatalogProbes } from './planner.js';
export {
    MODEL_GATEWAY_IMPLEMENTED_PROBE_KINDS,
    MODEL_GATEWAY_PLANNED_PROBE_KINDS,
    listProviderWireProbeMatrix,
    summarizeProviderWireProbeMatrix,
} from './matrix.js';
export { recommendCatalogDiffProbes } from './recommendations.js';
