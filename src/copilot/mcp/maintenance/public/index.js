// @ts-check
/** Public membrane for governed MCP workspace maintenance. */

export {
    buildAiArtifactsReport,
    cleanupAiArtifacts,
    readAiArtifactsPressure,
    configureAiArtifactsRuntime,
    createAiArtifactsRuntime,
} from '../artifacts/runtime.js';
export {
    inspectRootDependencyUpdates,
    upgradeRootDependenciesToLatest,
} from '../dependencies/runtime.js';
