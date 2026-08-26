// @ts-check
/**
 * Canonical application Infra 2.1 composition façade.
 *
 * Production owns exactly one ApplicationInfraHost. The host owns ProcessInfra → InfraRuntime → WorkspaceInfra,
 * SQLite bootstrap coalescing and the single graceful-shutdown registration. This module deliberately contains no
 * second process/runtime lifecycle or bootstrap state.
 *
 * @module copilot/boot/application-infra
 */

import { createApplicationInfraHost } from './application-infra-host.js';
import { WORKSPACE_ROOT } from './workspace.js';

const APPLICATION_INFRA_HOST = createApplicationInfraHost({
    hostId: 'copilot-application-host',
    processId: 'copilot-application-process',
    runtimeId: 'copilot-application',
    defaultWorkspaceRoot: WORKSPACE_ROOT,
    registerProcessShutdown: true,
    activateProcessPolicies: true,
});

export function getApplicationInfraHost() {
    return APPLICATION_INFRA_HOST;
}

export function getApplicationInfraRuntime() {
    return APPLICATION_INFRA_HOST.runtime;
}

/**
 * Return the already-configured application database capability.
 *
 * This accessor never opens a path or creates a second database owner. Callers that may run before application
 * bootstrap must await `bootstrapApplicationInfraSqliteProvider()` first.
 *
 * @returns {import('#copilot/infra/public/database/sqlite').SqliteDatabasePort}
 */
export function getApplicationSqliteDatabase() {
    return APPLICATION_INFRA_HOST.runtime.database.get();
}

/**
 * Execute path-bound SQLite maintenance through the application-owned Infra resource.
 * Domain callers retain no dbPath/native-driver authority; the concrete runtime performs the work off the event loop.
 *
 * @param {{mode?:'PASSIVE';timeoutMs?:number;busyTimeoutMs?:number}} [options]
 */
export function checkpointApplicationSqlite(options = {}) {
    return APPLICATION_INFRA_HOST.checkpointSqlite(options);
}

/** @param {string} [workspaceRoot=WORKSPACE_ROOT] */
export function getApplicationWorkspaceInfra(workspaceRoot = WORKSPACE_ROOT) {
    return APPLICATION_INFRA_HOST.workspace(workspaceRoot);
}

/** @param {import('#copilot/infra/public/database/sqlite').InfraSqliteProvider} provider */
export function configureApplicationInfraSqliteProvider(provider) {
    return APPLICATION_INFRA_HOST.configureSqliteProvider(provider);
}

/**
 * Ensure the process-owned application runtime is bound to the canonical Copilot SQLite provider.
 *
 * The host keeps exactly one in-flight bootstrap and dynamically loads the DB module, preserving cold-start isolation
 * while preventing provider activation after application infra teardown has begun.
 *
 * @returns {Promise<Readonly<{ configured: boolean; revision: number }>>}
 */
export function bootstrapApplicationInfraSqliteProvider() {
    return APPLICATION_INFRA_HOST.bootstrapSqliteProvider();
}

export function readApplicationInfraSnapshot() {
    return APPLICATION_INFRA_HOST.snapshot();
}

export function disposeApplicationInfra() {
    return APPLICATION_INFRA_HOST.dispose();
}
