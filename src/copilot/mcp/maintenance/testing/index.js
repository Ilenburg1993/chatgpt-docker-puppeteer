// @ts-check
/** White-box surfaces for MCP maintenance tests. */

export { createAiArtifactsRuntime } from '../artifacts/runtime.js';
export {
    readDeclaredNpmVersionFromPackageText,
    runFixedCommand as runFixedDependencyMaintenanceCommandForTests,
    summarizeInstallScriptPolicy,
} from '../dependencies/runtime.js';
