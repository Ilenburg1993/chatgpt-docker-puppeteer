// @ts-check
/** Process-owned cache for physical workspace path-policy decisions. */
import { IO_PATH_POLICY_VERSION } from '#copilot/infra/internal/policy';
import path from 'node:path';

const DEFAULT_TTL_MS = 250;
const HARD_TTL_MS = 2_000;
const DEFAULT_MAX_ENTRIES = 2_048;
const HARD_MAX_ENTRIES = 10_000;

/** @typedef {Readonly<{ttlMs:number;maxEntries:number}>} WorkspacePathPolicyCacheConfig */
/** @typedef {{ result: import('#copilot/infra/internal/policy').WorkspacePathPolicySuccess; cachedAtMs:number; absolutePath:string; realPath:string }} CacheEntry */
/** @type {Map<string, CacheEntry>} */
const cache = new Map();
const stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    expirations: 0,
    evictions: 0,
    bypasses: 0,
    invalidationEvents: 0,
    invalidatedEntries: 0,
};
/** @type {{token:object;processId:string;config:WorkspacePathPolicyCacheConfig} | null} */
let owner = null;

/** @param {NodeJS.ProcessEnv | Record<string,string|undefined>} [env] @returns {WorkspacePathPolicyCacheConfig} */
export function readWorkspacePathPolicyCacheConfig(env = {}) {
    return Object.freeze({
        ttlMs: readBoundedInteger(env['IO_PATH_POLICY_CACHE_TTL_MS'], DEFAULT_TTL_MS, 0, HARD_TTL_MS),
        maxEntries: readBoundedInteger(
            env['IO_PATH_POLICY_CACHE_MAX_ENTRIES'],
            DEFAULT_MAX_ENTRIES,
            16,
            HARD_MAX_ENTRIES,
        ),
    });
}

const DEFAULT_CONFIG = readWorkspacePathPolicyCacheConfig({});

/** @param {{token:object;processId:string;config:WorkspacePathPolicyCacheConfig}} nextOwner */
export function activateWorkspacePathPolicyCacheConfig(nextOwner) {
    if (!nextOwner?.token || typeof nextOwner.token !== 'object') {
        throw new TypeError('Workspace path-policy cache owner requires token.');
    }
    const processId = String(nextOwner.processId ?? '').trim();
    if (!processId) throw new TypeError('Workspace path-policy cache owner requires processId.');
    const config = readWorkspacePathPolicyCacheConfig({
        IO_PATH_POLICY_CACHE_TTL_MS: String(nextOwner.config?.ttlMs ?? ''),
        IO_PATH_POLICY_CACHE_MAX_ENTRIES: String(nextOwner.config?.maxEntries ?? ''),
    });
    if (owner && owner.token !== nextOwner.token) {
        const error = /** @type {Error & {code?:string}} */ (
            new Error(`Workspace path-policy cache configuration is already owned by ${owner.processId}.`)
        );
        error.code = 'ERR_IO_PATH_POLICY_CACHE_OWNER_ACTIVE';
        throw error;
    }
    cache.clear();
    owner = Object.freeze({ token: nextOwner.token, processId, config });
    return () => {
        if (owner?.token !== nextOwner.token) return;
        cache.clear();
        owner = null;
    };
}

export function getWorkspacePathPolicyCacheStats() {
    return Object.freeze({
        ...stats,
        size: cache.size,
        ...(owner?.config ?? DEFAULT_CONFIG),
        ownerProcessId: owner?.processId ?? null,
        policyVersion: IO_PATH_POLICY_VERSION,
    });
}

export function getWorkspacePathPolicyCacheConfig() {
    return owner?.config ?? DEFAULT_CONFIG;
}

export function recordWorkspacePathPolicyCacheBypass() {
    stats.bypasses += 1;
}

/** @param {string} key @param {number} ttlMs */
export function readWorkspacePathPolicyCacheEntry(key, ttlMs) {
    const entry = cache.get(key);
    if (!entry) {
        stats.misses += 1;
        return null;
    }
    if (Date.now() - entry.cachedAtMs > ttlMs) {
        cache.delete(key);
        stats.expirations += 1;
        stats.misses += 1;
        return null;
    }
    stats.hits += 1;
    cache.delete(key);
    cache.set(key, entry);
    return { ...entry.result };
}

/** @param {string} key @param {import('#copilot/infra/internal/policy').WorkspacePathPolicySuccess} result @param {number} maxEntries */
export function rememberWorkspacePathPolicyCacheEntry(key, result, maxEntries) {
    const storedResult = /** @type {import('#copilot/infra/internal/policy').WorkspacePathPolicySuccess} */ ({
        ...result,
        blockedSegments: Object.freeze([...result.blockedSegments]),
    });
    cache.delete(key);
    cache.set(key, {
        result: storedResult,
        cachedAtMs: Date.now(),
        absolutePath: result.absolutePath,
        realPath: result.realPath,
    });
    stats.sets += 1;
    while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (typeof oldest !== 'string') break;
        cache.delete(oldest);
        stats.evictions += 1;
    }
}

/** @param {string} filePath @param {{recursive?:boolean}} [options] */
export function invalidateWorkspacePathPolicyCache(filePath, options = {}) {
    const target = path.resolve(filePath);
    let removed = 0;
    for (const [key, entry] of cache) {
        if (
            pathMatchesInvalidation(entry.absolutePath, target, options.recursive === true) ||
            pathMatchesInvalidation(entry.realPath, target, options.recursive === true)
        ) {
            cache.delete(key);
            removed += 1;
        }
    }
    stats.invalidationEvents += 1;
    stats.invalidatedEntries += removed;
    return removed;
}

export function resetWorkspacePathPolicyCacheForTest() {
    cache.clear();
    for (const key of Object.keys(stats)) stats[/** @type {keyof typeof stats} */ (key)] = 0;
}

/** @param {string} candidate @param {string} target @param {boolean} recursive */
function pathMatchesInvalidation(candidate, target, recursive) {
    const normalizedCandidate = path.resolve(candidate);
    if (normalizedCandidate === target) return true;
    if (!recursive) return false;
    const relativePath = path.relative(target, normalizedCandidate);
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

/** @param {string | undefined} raw @param {number} fallback @param {number} min @param {number} max */
function readBoundedInteger(raw, fallback, min, max) {
    const numeric = Number(raw ?? fallback);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(numeric)));
}
