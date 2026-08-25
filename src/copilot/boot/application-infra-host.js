// @ts-check
/**
 * Process-owned application host for the Infra 2.1 composition tree.
 *
 * The generic infra layer owns ProcessInfra → InfraRuntime → WorkspaceInfra. This boot adapter adds the application
 * responsibilities that do not belong in generic infra: canonical SQLite bootstrap and one graceful-shutdown binding.
 * No process-global state is created here; callers decide when to materialize a host.
 *
 * @module copilot/boot/application-infra-host
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { PROCESS_SHUTDOWN_PHASE, createProcessInfra } from '#copilot/infra/public/composition/process';
import { dirname, resolve, sep } from 'node:path';

const DEFAULT_SHUTDOWN_HANDLER_NAME = 'copilot.application-infra.dispose';
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;
let hostSequence = 0;

/** @typedef {import('#copilot/infra/public/database/sqlite').InfraSqliteProvider} InfraSqliteProvider */
/**
 * @typedef {{
 *   ensureDirectory: () => Promise<unknown>;
 *   getDatabase: InfraSqliteProvider;
 *   dispose?: () => void | Promise<void>;
 * }} ApplicationInfraSqliteProvider
 */

/**
 * @param {{
 *   hostId?: string;
 *   processId?: string;
 *   runtimeId?: string;
 *   defaultWorkspaceRoot?: string;
 *   registerProcessShutdown?: boolean;
 *   activateProcessPolicies?: boolean;
 *   env?: NodeJS.ProcessEnv;
 *   shutdownHandlerName?: string;
 *   shutdownTimeoutMs?: number;
 *   loadSqliteProvider?: () => Promise<ApplicationInfraSqliteProvider>;
 * }} [options]
 */
export function createApplicationInfraHost(options = {}) {
    const hostId = options.hostId?.trim() || `application-infra-host-${++hostSequence}`;
    const processId = options.processId?.trim() || `${hostId}:process`;
    const runtimeId = options.runtimeId?.trim() || `${hostId}:runtime`;
    const defaultWorkspaceRoot = options.defaultWorkspaceRoot ? resolve(options.defaultWorkspaceRoot) : null;
    const processEnv = options.env ?? process.env;
    const applicationDbPath = resolveApplicationDbPath(processEnv, defaultWorkspaceRoot);
    const processInfra = createProcessInfra({
        processId,
        activateProcessPolicies: options.activateProcessPolicies === true,
        ...(defaultWorkspaceRoot ? { workspaceRoot: defaultWorkspaceRoot } : {}),
        ...(options.env ? { env: options.env } : {}),
    });
    const runtime = processInfra.createRuntime({ runtimeId });
    const loadSqliteProvider = options.loadSqliteProvider ?? (() => loadDefaultSqliteProvider(applicationDbPath));
    let state = /** @type {'active'|'disposing'|'disposed'} */ ('active');
    /** @type {Promise<Readonly<{ configured:boolean; revision:number }>> | null} */
    let sqliteBootstrap = null;
    /** @type {Promise<void> | null} */
    let disposePromise = null;
    /** @type {(() => void | Promise<void>) | null} */
    let sqliteDispose = null;
    let shutdownRegistered = false;
    /** @type {(() => void) | null} */
    let unregisterShutdown = null;

    function assertActive() {
        if (state !== 'active') throw new Error(`ApplicationInfraHost(${hostId}) is ${state}.`);
    }

    /** @param {string|null|undefined} workspaceRoot */
    function workspace(workspaceRoot = defaultWorkspaceRoot) {
        assertActive();
        if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) {
            throw new TypeError(`ApplicationInfraHost(${hostId}) requires a workspace root.`);
        }
        return runtime.workspace(resolve(workspaceRoot));
    }

    /** @param {InfraSqliteProvider} provider */
    function configureSqliteProvider(provider) {
        assertActive();
        return runtime.database.configure(provider);
    }

    async function bootstrapSqliteProvider() {
        assertActive();
        const current = runtime.database.status();
        if (current.configured) return current;
        if (sqliteBootstrap) return sqliteBootstrap;

        sqliteBootstrap = (async () => {
            const provider = await loadSqliteProvider();
            sqliteDispose = provider.dispose ?? null;
            await provider.ensureDirectory();
            // Dispose may have started while the asynchronous provider module/directory was loading. In that case the
            // bootstrap must not activate a provider into a runtime already entering teardown.
            assertActive();
            runtime.database.configure(provider.getDatabase);
            // Materialize once so native binding/path failures surface during bootstrap, not on the first indexed read.
            provider.getDatabase();
            return runtime.database.status();
        })();
        try {
            return await sqliteBootstrap;
        } finally {
            sqliteBootstrap = null;
        }
    }

    function snapshot() {
        return Object.freeze({
            hostId,
            state,
            processId,
            runtimeId,
            defaultWorkspaceRoot,
            applicationDbPath,
            shutdownRegistered,
            sqliteBootstrapInFlight: sqliteBootstrap !== null,
            process: processInfra.lifecycleSnapshot(),
            runtime: runtime.lifecycleSnapshot(),
        });
    }

    function dispose() {
        if (disposePromise) return disposePromise;
        state = 'disposing';
        unregisterShutdown?.();
        unregisterShutdown = null;
        disposePromise = (async () => {
            const pendingBootstrap = sqliteBootstrap;
            if (pendingBootstrap) {
                // Bootstrap callers receive their own failure. Teardown only waits for the in-flight activation attempt
                // to settle, then deterministically disposes whatever resources were actually materialized.
                await pendingBootstrap.catch(() => undefined);
            }
            try {
                await processInfra.dispose();
            } finally {
                // Revoke the database capability before closing its resource. A retained runtime reference must not be
                // able to reacquire/reopen SQLite after host teardown.
                runtime.database.reset();
                try {
                    await sqliteDispose?.();
                } finally {
                    sqliteDispose = null;
                    state = 'disposed';
                }
            }
        })();
        return disposePromise;
    }

    const api = Object.freeze({
        hostId,
        processId,
        runtimeId,
        processInfra,
        runtime,
        workspace,
        configureSqliteProvider,
        bootstrapSqliteProvider,
        snapshot,
        dispose,
        [Symbol.asyncDispose]: dispose,
    });

    if (options.registerProcessShutdown === true) {
        unregisterShutdown = processInfra.shutdown.register(
            options.shutdownHandlerName?.trim() || DEFAULT_SHUTDOWN_HANDLER_NAME,
            async () => dispose(),
            PROCESS_SHUTDOWN_PHASE.APPLICATION_INFRA,
            { timeoutMs: normalizeShutdownTimeout(options.shutdownTimeoutMs) },
        );
        shutdownRegistered = true;
    }

    return api;
}

/** @param {NodeJS.ProcessEnv} env @param {string | null} workspaceRoot */
function resolveApplicationDbPath(env, workspaceRoot) {
    const configured = String(env['COPILOT_DB_PATH'] ?? '').trim();
    if (configured === ':memory:') return configured;
    const base = workspaceRoot ?? resolve(import.meta.dirname, '../../..');
    const raw = configured || resolve(base, 'data', 'copilot.sqlite');
    const looksLikeDirectory = raw.endsWith(sep) || raw.endsWith('/') || raw.endsWith('\\');
    return resolve(looksLikeDirectory ? resolve(raw, 'copilot.sqlite') : raw);
}

/** @param {string} dbPath */
async function ensureApplicationDbDirectory(dbPath) {
    if (dbPath === ':memory:') return;
    const directory = dirname(dbPath);
    const io = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'boot.application-infra.sqlite-directory',
            exactPaths: [directory],
            operations: ['mkdir'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    await io.mkdirPath(directory, { recursive: true, mode: 0o700, durability: 'file-and-directory' });
}

/** @param {string} dbPath @returns {Promise<ApplicationInfraSqliteProvider>} */
async function loadDefaultSqliteProvider(dbPath) {
    const { createApplicationSqliteRuntime } = await import('#copilot/infra/public/composition/database/sqlite');
    const resource = await createApplicationSqliteRuntime({ dbPath });
    return Object.freeze({
        ensureDirectory: () => ensureApplicationDbDirectory(dbPath),
        getDatabase: resource.getStructuralDatabase,
        dispose: resource.close,
    });
}

/** @param {unknown} value */
function normalizeShutdownTimeout(value) {
    const numeric = Number(value ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
    return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}
