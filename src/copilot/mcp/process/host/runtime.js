// @ts-check
/**
 * Reference-counted MCP process-runtime host.
 *
 * This owner contains lifecycle mechanics only. It deliberately knows nothing about HTTP, OAuth, Cloudflare, boot,
 * workspace paths or diagnostics. Composition supplies concrete services; listeners acquire leases and therefore own
 * exactly one reference to the process-scoped services they require.
 *
 * @module copilot/mcp/process/host/runtime
 */

/** @typedef {() => void | Promise<void>} McpProcessHostDisposer */
/**
 * @typedef {{
 *     name: string;
 *     required?: boolean;
 *     start: () => void | McpProcessHostDisposer | { dispose: McpProcessHostDisposer } | Promise<void | McpProcessHostDisposer | { dispose: McpProcessHostDisposer }>;
 * }} McpProcessHostService
 *
 * @typedef {{
 *     hostId?: string;
 *     prepare?: () => void | McpProcessHostDisposer | { dispose: McpProcessHostDisposer } | Promise<void | McpProcessHostDisposer | { dispose: McpProcessHostDisposer }>;
 *     services?: readonly McpProcessHostService[];
 *     log?: (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, fields?: Record<string, unknown>) => void;
 * }} McpProcessHostOptions
 *
 * @typedef {{
 *     leaseId: string;
 *     reason: string;
 *     release: () => Promise<boolean>;
 *     [Symbol.asyncDispose]: () => Promise<void>;
 * }} McpProcessHostLease
 */

let hostSequence = 0;

/**
 * @param {McpProcessHostOptions} [options]
 */
export function createMcpProcessHost(options = {}) {
    const hostId = options.hostId?.trim() || `mcp-process-host-${++hostSequence}`;
    const services = normalizeServices(options.services ?? []);
    const log = options.log ?? (() => {});
    /** @type {'idle'|'starting'|'active'|'stopping'|'start_failed'|'stop_failed'|'disposing'|'disposed'|'dispose_failed'} */
    let state = 'idle';
    let prepared = false;
    /** @type {Promise<void> | null} */
    let preparePromise = null;
    /** @type {McpProcessHostDisposer | null} */
    let prepareDisposer = null;
    /** @type {Promise<unknown>} */
    let transition = Promise.resolve();
    /** @type {{ name: string; dispose: McpProcessHostDisposer }[]} */
    let activeDisposers = [];
    /** @type {Map<string, { reason: string; acquiredAt: string }>} */
    const leases = new Map();
    /** @type {Map<string, { name: string; required: boolean; state: 'idle'|'starting'|'active'|'degraded'|'stopping'|'stopped'|'failed'; starts: number; stops: number; lastError: string | null }>} */
    const serviceStates = new Map(
        services.map((service) => [
            service.name,
            {
                name: service.name,
                required: service.required === true,
                state: /** @type {const} */ ('idle'),
                starts: 0,
                stops: 0,
                lastError: null,
            },
        ]),
    );
    let leaseSequence = 0;
    let starts = 0;
    let stops = 0;
    let lastError = /** @type {string | null} */ (null);

    function assertUsable() {
        if (state === 'disposed' || state === 'disposing' || state === 'dispose_failed') {
            throw new Error(`McpProcessHost(${hostId}) is ${state}.`);
        }
        if (state === 'stop_failed') {
            throw new Error(`McpProcessHost(${hostId}) has unresolved teardown failure.`);
        }
    }

    /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
    function enqueue(operation) {
        const current = transition.then(operation, operation);
        transition = current.catch(() => undefined);
        return current;
    }

    async function prepare() {
        assertUsable();
        if (prepared) return;
        if (preparePromise) return await preparePromise;
        preparePromise = (async () => {
            const result = await options.prepare?.();
            prepareDisposer = normalizeDisposer(result);
            prepared = true;
        })();
        try {
            await preparePromise;
        } finally {
            preparePromise = null;
        }
    }

    async function startServices() {
        assertUsable();
        if (state === 'active') return;
        if (state === 'start_failed') {
            // A new acquire is an explicit retry after the prior start attempt rolled back all started services.
            state = 'idle';
        }
        if (state !== 'idle') throw new Error(`McpProcessHost(${hostId}) cannot start from state ${state}.`);
        state = 'starting';
        /** @type {{ name: string; dispose: McpProcessHostDisposer }[]} */
        const started = [];
        try {
            for (const service of services) {
                const serviceState = serviceStates.get(service.name);
                if (!serviceState) continue;
                serviceState.state = 'starting';
                serviceState.lastError = null;
                try {
                    const result = await service.start();
                    const disposer = normalizeDisposer(result);
                    if (disposer) started.push({ name: service.name, dispose: disposer });
                    serviceState.state = 'active';
                    serviceState.starts += 1;
                } catch (error) {
                    const message = errorMessage(error);
                    serviceState.state = service.required === true ? 'failed' : 'degraded';
                    serviceState.lastError = message;
                    log(service.required === true ? 'ERROR' : 'WARN', 'MCP process service failed to start.', {
                        hostId,
                        service: service.name,
                        required: service.required === true,
                        error: message,
                    });
                    if (service.required === true) throw error;
                }
            }
            activeDisposers = started;
            state = 'active';
            starts += 1;
            lastError = null;
        } catch (error) {
            const rollbackFailures = await disposeEntries(started, serviceStates, log, hostId);
            activeDisposers = [];
            state = 'start_failed';
            lastError = errorMessage(error);
            if (rollbackFailures.length > 0) {
                const startCause = error instanceof Error ? error : new Error(lastError);
                throw new AggregateError(
                    [startCause, ...rollbackFailures],
                    `McpProcessHost(${hostId}) start failed and rollback was incomplete.`,
                    { cause: error },
                );
            }
            throw error;
        }
    }

    /** @param {string} reason */
    async function stopServices(reason) {
        if (state === 'idle') return;
        if (state === 'start_failed') {
            state = 'idle';
            return;
        }
        if (state !== 'active') throw new Error(`McpProcessHost(${hostId}) cannot stop from state ${state}.`);
        state = 'stopping';
        const entries = activeDisposers;
        activeDisposers = [];
        const failures = await disposeEntries(entries, serviceStates, log, hostId);
        stops += 1;
        if (failures.length > 0) {
            state = 'stop_failed';
            lastError = `process service teardown failed (${failures.length})`;
            throw new AggregateError(failures, `McpProcessHost(${hostId}) teardown failed (${reason}).`);
        }
        state = 'idle';
        lastError = null;
    }

    /**
     * @param {{ reason?: string }} [input]
     * @returns {Promise<McpProcessHostLease>}
     */
    async function acquire(input = {}) {
        const reason = String(input.reason ?? 'unspecified').trim() || 'unspecified';
        const leaseId = `${hostId}:lease:${++leaseSequence}`;
        await prepare();
        await enqueue(async () => {
            assertUsable();
            if (leases.size === 0) await startServices();
            if (state !== 'active') throw new Error(`McpProcessHost(${hostId}) did not reach active state.`);
            leases.set(leaseId, { reason, acquiredAt: new Date().toISOString() });
        });
        let released = false;
        async function release() {
            if (released) return false;
            released = true;
            return await enqueue(async () => {
                const removed = leases.delete(leaseId);
                if (!removed) return false;
                if (leases.size === 0) await stopServices(`last-lease-released:${reason}`);
                return true;
            });
        }
        return Object.freeze({
            leaseId,
            reason,
            release,
            async [Symbol.asyncDispose]() {
                await release();
            },
        });
    }

    function snapshot() {
        return Object.freeze({
            hostId,
            state,
            prepared,
            leaseCount: leases.size,
            leases: Object.freeze(
                [...leases.entries()].map(([leaseId, lease]) => Object.freeze({ leaseId, ...lease })),
            ),
            starts,
            stops,
            lastError,
            services: Object.freeze([...serviceStates.values()].map((service) => Object.freeze({ ...service }))),
        });
    }

    async function dispose() {
        await enqueue(async () => {
            if (state === 'disposed') return;
            if (state === 'disposing') return;
            if (state === 'dispose_failed') throw new Error(`McpProcessHost(${hostId}) dispose previously failed.`);
            // A prepare may have been started by acquire() before this dispose transition entered the queue. Teardown
            // must not become terminal while that bootstrap still owns asynchronous work/resources.
            const pendingPrepare = preparePromise;
            if (pendingPrepare) await pendingPrepare.catch(() => undefined);
            const previousState = state;
            state = 'disposing';
            leases.clear();
            try {
                if (previousState === 'active') {
                    // stopServices requires active state because it owns the truthful transition into stopping.
                    state = 'active';
                    await stopServices('host-dispose');
                    state = 'disposing';
                } else if (previousState === 'stop_failed') {
                    throw new Error(`McpProcessHost(${hostId}) cannot claim disposal after unresolved stop failure.`);
                }
                if (prepareDisposer) await prepareDisposer();
                prepareDisposer = null;
                prepared = false;
                state = 'disposed';
            } catch (error) {
                state = 'dispose_failed';
                lastError = errorMessage(error);
                throw error;
            }
        });
    }

    return Object.freeze({
        hostId,
        prepare,
        acquire,
        snapshot,
        dispose,
        [Symbol.asyncDispose]: dispose,
    });
}

/** @param {readonly McpProcessHostService[]} services */
function normalizeServices(services) {
    const seen = new Set();
    return Object.freeze(
        services.map((service) => {
            const name = String(service?.name ?? '').trim();
            if (!name) throw new TypeError('MCP process host service name is required.');
            if (seen.has(name)) throw new Error(`Duplicate MCP process host service: ${name}`);
            if (typeof service.start !== 'function')
                throw new TypeError(`MCP process host service ${name} requires start().`);
            seen.add(name);
            return Object.freeze({ name, required: service.required === true, start: service.start });
        }),
    );
}

/**
 * @param {void | McpProcessHostDisposer | { dispose: McpProcessHostDisposer }} value
 * @returns {McpProcessHostDisposer | null}
 */
function normalizeDisposer(value) {
    if (typeof value === 'function') return value;
    if (value && typeof value === 'object' && typeof value.dispose === 'function') return value.dispose.bind(value);
    return null;
}

/**
 * @param {{ name: string; dispose: McpProcessHostDisposer }[]} entries
 * @param {Map<string, { name: string; required: boolean; state: 'idle'|'starting'|'active'|'degraded'|'stopping'|'stopped'|'failed'; starts: number; stops: number; lastError: string | null }>} serviceStates
 * @param {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, fields?: Record<string, unknown>) => void} log
 * @param {string} hostId
 */
async function disposeEntries(entries, serviceStates, log, hostId) {
    /** @type {Error[]} */
    const failures = [];
    for (const entry of [...entries].reverse()) {
        const serviceState = serviceStates.get(entry.name);
        if (serviceState) serviceState.state = 'stopping';
        try {
            await entry.dispose();
            if (serviceState) {
                serviceState.state = 'stopped';
                serviceState.stops += 1;
                serviceState.lastError = null;
            }
        } catch (error) {
            const failure = new Error(`MCP process service ${entry.name} teardown failed`, { cause: error });
            failures.push(failure);
            if (serviceState) {
                serviceState.state = 'failed';
                serviceState.lastError = errorMessage(error);
            }
            log('ERROR', 'MCP process service failed to stop.', {
                hostId,
                service: entry.name,
                error: errorMessage(error),
            });
        }
    }
    return failures;
}

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** @typedef {ReturnType<typeof createMcpProcessHost>} McpProcessHost */
