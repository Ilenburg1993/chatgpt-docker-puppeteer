// @ts-check
/** Public membrane for governed MCP workspace maintenance. */

export { createAiArtifactsRuntime } from '../artifacts/runtime.js';
export {
    inspectRootDependencyUpdates,
    upgradeRootDependenciesToLatest,
} from '../dependencies/runtime.js';
