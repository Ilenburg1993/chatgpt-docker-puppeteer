// @ts-check
/**
 * src/copilot/tools/hub/index.js
 *
 * Barrel do subdomínio `hub/`. Re-exporta a API pública de hub-tools.
 *
 * @module copilot/tools/hub
 */
export {
    hubCreateSessionTool,
    hubListSessionsTool,
    hubPollUserMessagesTool,
    hubReadHistoryTool,
    hubSendMessageTool,
    hubTools,
    resetHubForTests,
    setHub,
} from './hub-tools.js';
