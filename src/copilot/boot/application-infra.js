// @ts-check
/**
 * Canonical application composition root for infra 2.0.
 *
 * One process-level application runtime owns runtime-scoped database/index/cache resources; workspace capabilities are
 * memoized below that runtime by canonical root. Resource activation remains lazy.
 *
 * @module copilot/boot/application-infra
 */

import { createInfraRuntime } from '#copilot/infra/public/composition/runtime';
import { WORKSPACE_ROOT } from './workspace.js';

const APPLICATION_INFRA_RUNTIME = createInfraRuntime({ runtimeId: 'copilot-application' });
/** @type {Promise<Readonly<{ configured: boolean; revision: number }>> | null} */
let applicationInfraSqliteBootstrap = null;

export function getApplicationInfraRuntime() {
    return APPLICATION_INFRA_RUNTIME;
}

/** @param {string} [workspaceRoot=WORKSPACE_ROOT] */
export function getApplicationWorkspaceInfra(workspaceRoot = WORKSPACE_ROOT) {
    return APPLICATION_INFRA_RUNTIME.workspace(workspaceRoot);
}

/** @param {() => import('better-sqlite3').Database} provider */
export function configureApplicationInfraSqliteProvider(provider) {
    return APPLICATION_INFRA_RUNTIME.database.configure(provider);
}

/**
 * Ensure the process-wide application infra runtime is bound to the canonical Copilot SQLite provider.
 *
 * The DB module remains dynamically loaded so importing the composition root does not eagerly load better-sqlite3.
 * Concurrent hosts share one in-flight bootstrap; a later reset can bootstrap again because only in-flight work is
 * cached, never a completed provider result.
 *
 * @returns {Promise<Readonly<{ configured: boolean; revision: number }>>}
 */
export async function bootstrapApplicationInfraSqliteProvider() {
    const current = APPLICATION_INFRA_RUNTIME.database.status();
    if (current.configured) return current;
    if (applicationInfraSqliteBootstrap) return applicationInfraSqliteBootstrap;

    applicationInfraSqliteBootstrap = (async () => {
        const { ensureCopilotDbDir, getCopilotDb } = await import('../db/sqlite.js');
        await ensureCopilotDbDir();
        configureApplicationInfraSqliteProvider(getCopilotDb);
        // Fail during bootstrap rather than deferring a broken native binding/path until the first indexed read.
        getCopilotDb();
        return APPLICATION_INFRA_RUNTIME.database.status();
    })();
    try {
        return await applicationInfraSqliteBootstrap;
    } finally {
        applicationInfraSqliteBootstrap = null;
    }
}

export function readApplicationInfraSnapshot() {
    return APPLICATION_INFRA_RUNTIME.lifecycleSnapshot();
}

export function disposeApplicationInfra() {
    return APPLICATION_INFRA_RUNTIME.dispose();
}
