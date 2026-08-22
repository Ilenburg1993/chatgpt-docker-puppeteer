// @ts-check
/**
 * Policies de budgets para operações de I/O com potencial de crescer em tempo, memória ou saída.
 *
 * Resolução ambiental é explícita e ocorre no composition root. Os resolvers operacionais recebem apenas valores já
 * normalizados; nenhum primeiro uso ou import de módulo pode capturar process.env implicitamente.
 *
 * @module copilot/infra/policy/budgets
 */

export const DEFAULT_IO_SEARCH_TIMEOUT_MS = 15_000;
export const DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
export const DEFAULT_PROCESS_TIMEOUT_MS = 60_000;
export const DEFAULT_PROCESS_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
export const MIN_TIMEOUT_MS = 100;
export const MIN_BUFFER_BYTES = 1024;

/** @typedef {Readonly<{timeoutMs:number;maxBufferBytes:number}>} IoSearchBudget */

/**
 * @param {number | undefined} value
 * @param {number} fallback
 * @param {{ min?: number; max?: number }} [limits]
 * @returns {number}
 */
export function normalizePositiveIntegerBudget(value, fallback, limits = {}) {
    const parsed = Number(value);
    const base = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
    const min = limits.min ?? 1;
    const withMin = Math.max(min, base);
    return Number.isFinite(limits.max) ? Math.min(Number(limits.max), withMin) : withMin;
}

/**
 * Resolve one immutable search budget from an explicit environment snapshot.
 * @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 * @returns {IoSearchBudget}
 */
export function readIoSearchBudgetConfig(env = {}) {
    return Object.freeze({
        timeoutMs: normalizePositiveIntegerBudget(Number(env['IO_SEARCH_TIMEOUT_MS']), DEFAULT_IO_SEARCH_TIMEOUT_MS, {
            min: MIN_TIMEOUT_MS,
        }),
        maxBufferBytes: normalizePositiveIntegerBudget(
            Number(env['IO_SEARCH_MAX_BUFFER_BYTES']),
            DEFAULT_IO_SEARCH_MAX_BUFFER_BYTES,
            { min: MIN_BUFFER_BYTES },
        ),
    });
}

const DEFAULT_IO_SEARCH_BUDGET = readIoSearchBudgetConfig({});

/**
 * Resolve per-call search overrides against an already-resolved process default.
 * @param {{ timeoutMs?: number; maxBufferBytes?: number }} [overrides]
 * @param {IoSearchBudget} [defaults]
 * @returns {IoSearchBudget}
 */
export function resolveIoSearchBudget(overrides = {}, defaults = DEFAULT_IO_SEARCH_BUDGET) {
    return Object.freeze({
        timeoutMs: normalizePositiveIntegerBudget(overrides.timeoutMs ?? defaults.timeoutMs, defaults.timeoutMs, {
            min: MIN_TIMEOUT_MS,
        }),
        maxBufferBytes: normalizePositiveIntegerBudget(
            overrides.maxBufferBytes ?? defaults.maxBufferBytes,
            defaults.maxBufferBytes,
            { min: MIN_BUFFER_BYTES },
        ),
    });
}

/** @type {{token:object;processId:string;searchBudget:IoSearchBudget} | null} */
let activeProcessBudgetOwner = null;

/**
 * Activate the process generation that owns stateless search defaults. Competing owners are rejected rather than
 * silently retargeting searches already executing in the same Node process.
 * @param {{token:object;processId:string;searchBudget:IoSearchBudget}} owner
 * @returns {() => void}
 */
export function activateProcessBudgetConfig(owner) {
    if (!owner?.token || typeof owner.token !== 'object') throw new TypeError('Process budget owner requires token.');
    const processId = String(owner.processId ?? '').trim();
    if (!processId) throw new TypeError('Process budget owner requires processId.');
    if (activeProcessBudgetOwner && activeProcessBudgetOwner.token !== owner.token) {
        const error = /** @type {Error & {code?:string}} */ (
            new Error(`Process budget configuration is already owned by ${activeProcessBudgetOwner.processId}.`)
        );
        error.code = 'ERR_PROCESS_BUDGET_OWNER_ACTIVE';
        throw error;
    }
    activeProcessBudgetOwner = Object.freeze({
        token: owner.token,
        processId,
        searchBudget: resolveIoSearchBudget({}, owner.searchBudget),
    });
    return () => {
        if (activeProcessBudgetOwner?.token === owner.token) activeProcessBudgetOwner = null;
    };
}

/** @returns {IoSearchBudget} */
export function getActiveIoSearchBudget() {
    return activeProcessBudgetOwner?.searchBudget ?? DEFAULT_IO_SEARCH_BUDGET;
}

export function getActiveProcessBudgetOwnerSnapshot() {
    return Object.freeze({
        active: activeProcessBudgetOwner !== null,
        processId: activeProcessBudgetOwner?.processId ?? null,
        searchBudget: activeProcessBudgetOwner?.searchBudget ?? DEFAULT_IO_SEARCH_BUDGET,
    });
}

/**
 * @param {{
 *     timeoutMs?: number | null;
 *     maxBufferBytes?: number;
 *     defaultTimeoutMs?: number;
 *     defaultMaxBufferBytes?: number;
 * }} [options]
 * @returns {Readonly<{ timeoutMs: number | null; maxBufferBytes: number }>}
 */
export function resolveProcessExecutionBudget(options = {}) {
    const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const defaultMaxBufferBytes = options.defaultMaxBufferBytes ?? DEFAULT_PROCESS_MAX_BUFFER_BYTES;
    return Object.freeze({
        timeoutMs:
            options.timeoutMs === null
                ? null
                : normalizePositiveIntegerBudget(options.timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs, {
                      min: MIN_TIMEOUT_MS,
                  }),
        maxBufferBytes: normalizePositiveIntegerBudget(
            options.maxBufferBytes ?? defaultMaxBufferBytes,
            defaultMaxBufferBytes,
            { min: MIN_BUFFER_BYTES },
        ),
    });
}
