// @ts-check
/**
 * Process-owned environment and capability state for local search subprocesses.
 *
 * Named search executables never inherit the ambient Node environment implicitly. ProcessInfra captures a minimal
 * execution environment once, activates exactly one owner, and each search operation acquires an immutable lease bound
 * to that owner. Ripgrep availability is memoized per owner so probe and execution cannot observe different process
 * generations.
 *
 * @module copilot/infra/indexing/search/subprocess/process/service
 */

const SEARCH_SUBPROCESS_ENV_KEYS = Object.freeze([
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'TMP',
    'TEMP',
]);

/** @typedef {Readonly<Record<string,string>>} SearchSubprocessEnvironment */
/** @typedef {Readonly<{environment:SearchSubprocessEnvironment;ripgrepProbeTimeoutMs:number}>} SearchSubprocessProcessConfig */

/**
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 * @returns {SearchSubprocessProcessConfig}
 */
export function readSearchSubprocessProcessConfig(env = {}) {
    /** @type {Record<string,string>} */
    const environment = {};
    const pathValue = env['PATH'] ?? env['Path'] ?? env['path'];
    if (typeof pathValue === 'string' && pathValue.length > 0) environment['PATH'] = pathValue;
    for (const key of SEARCH_SUBPROCESS_ENV_KEYS) {
        const value = env[key];
        if (typeof value === 'string' && value.length > 0) environment[key] = value;
    }
    return Object.freeze({
        environment: Object.freeze(environment),
        ripgrepProbeTimeoutMs: 3_000,
    });
}

/**
 * @typedef {object} SearchSubprocessOwnerState
 * @property {object | null} token
 * @property {string} processId
 * @property {SearchSubprocessProcessConfig} config
 * @property {boolean | null} ripgrepAvailable
 * @property {Promise<boolean> | null} ripgrepProbe
 */

/** @param {object | null} token @param {string} processId @param {SearchSubprocessProcessConfig} config */
function createOwnerState(token, processId, config) {
    return /** @type {SearchSubprocessOwnerState} */ ({
        token,
        processId,
        config,
        ripgrepAvailable: null,
        ripgrepProbe: null,
    });
}

const fallbackOwner = createOwnerState(null, 'standalone-default', readSearchSubprocessProcessConfig({}));
/** @type {SearchSubprocessOwnerState | null} */
let activeOwner = null;

/**
 * @param {{token:object;processId:string;config:SearchSubprocessProcessConfig}} owner
 * @returns {() => void}
 */
export function activateSearchSubprocessProcessConfig(owner) {
    if (!owner?.token || typeof owner.token !== 'object') {
        throw new TypeError('Search subprocess process owner requires token.');
    }
    const processId = String(owner.processId ?? '').trim();
    if (!processId) throw new TypeError('Search subprocess process owner requires processId.');
    if (activeOwner && activeOwner.token !== owner.token) {
        const error = /** @type {Error & {code?:string}} */ (
            new Error(`Search subprocess process configuration is already owned by ${activeOwner.processId}.`)
        );
        error.code = 'ERR_SEARCH_SUBPROCESS_OWNER_ACTIVE';
        throw error;
    }
    if (!activeOwner) activeOwner = createOwnerState(owner.token, processId, owner.config);
    return () => {
        if (activeOwner?.token === owner.token) activeOwner = null;
    };
}

/**
 * Acquire a stable process-generation lease. The returned closures retain the owner state that existed at acquisition,
 * so concurrent teardown cannot retarget an in-flight search to a fallback/new generation.
 */
export function acquireSearchSubprocessProcessLease() {
    const state = activeOwner ?? fallbackOwner;
    const environment = state.config.environment;
    return Object.freeze({
        processId: state.processId,
        environment,
        ripgrepProbeTimeoutMs: state.config.ripgrepProbeTimeoutMs,
        /** @param {(environment:SearchSubprocessEnvironment,timeoutMs:number)=>Promise<boolean>} probe */
        async resolveRipgrepAvailability(probe) {
            if (state.ripgrepAvailable !== null) return state.ripgrepAvailable;
            if (!state.ripgrepProbe) {
                state.ripgrepProbe = Promise.resolve()
                    .then(() => probe(environment, state.config.ripgrepProbeTimeoutMs))
                    .then(Boolean, () => false);
            }
            try {
                state.ripgrepAvailable = await state.ripgrepProbe;
                return state.ripgrepAvailable;
            } finally {
                state.ripgrepProbe = null;
            }
        },
    });
}

export function getSearchSubprocessProcessSnapshot() {
    const state = activeOwner ?? fallbackOwner;
    return Object.freeze({
        active: activeOwner !== null,
        processId: state.processId,
        environmentKeys: Object.freeze(Object.keys(state.config.environment).sort()),
        path: state.config.environment['PATH'] ?? null,
        ripgrepAvailable: state.ripgrepAvailable,
        ripgrepProbePending: state.ripgrepProbe !== null,
    });
}

/** Test-control only. */
export function resetSearchSubprocessProcessStateForTest() {
    fallbackOwner.ripgrepAvailable = null;
    fallbackOwner.ripgrepProbe = null;
    if (activeOwner) {
        activeOwner.ripgrepAvailable = null;
        activeOwner.ripgrepProbe = null;
    }
}
