// @ts-check
/**
 * Runtime-owned authenticated rollback capabilities.
 *
 * The signing key is intentionally ephemeral and belongs to one InfraRuntime. A serialized rollback token therefore
 * survives ordinary tool round-trips but not process/runtime replacement. Workspace bindings add audience, runtime,
 * workspace and workspace-root claims before an HMAC-SHA-256 tag is emitted. Real execution reserves a token against
 * concurrent replay and consumes it after any physical mutation has been observed.
 *
 * @module copilot/infra/operations/rollback/capability
 */

import { cleanupRollbackSidecars, listRollbackSidecars } from '#copilot/infra/internal/filesystem/transaction';
import { sha256 } from '#copilot/infra/internal/platform/hash';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { executeAuthenticatedIoRollbackToken } from './executor.js';
import {
    ROLLBACK_TOKEN_AUDIENCE,
    buildIoRollbackTokenAuthPayload,
    createIoRollbackTokenEnvelope,
    decodeIoRollbackToken,
    serializeIoRollbackToken,
    validateIoRollbackTokenShape,
    verifyIoRollbackTokenDigest,
} from './token.js';

const ROLLBACK_HMAC_BYTES = 32;

/**
 * @param {{
 *   runtimeId:string;
 *   ttlMs:number;
 *   secret?:Buffer|Uint8Array;
 * }} options
 */
export function createIoRollbackCapabilityRuntime(options) {
    const runtimeId = assertIdentity(options?.runtimeId, 'runtimeId');
    const ttlMs = normalizeTtl(options?.ttlMs);
    const secret = options?.secret ? Buffer.from(options.secret) : randomBytes(ROLLBACK_HMAC_BYTES);
    if (secret.byteLength < ROLLBACK_HMAC_BYTES) {
        throw new TypeError(`Rollback capability secret must contain at least ${ROLLBACK_HMAC_BYTES} bytes.`);
    }
    /** @type {Set<string>} */
    const consumedTokenIds = new Set();
    /** @type {Set<string>} */
    const executingTokenIds = new Set();
    let disposed = false;

    function assertActive() {
        if (disposed)
            throw rollbackError('EROLLBACKCAPDISPOSED', `Rollback capability runtime ${runtimeId} is disposed.`);
    }

    /** @param {import('./token.js').IoRollbackToken} token */
    function sign(token) {
        assertActive();
        return createHmac('sha256', secret).update(buildIoRollbackTokenAuthPayload(token)).digest('base64url');
    }

    /** @param {string} actual @param {string} expected */
    function tagsEqual(actual, expected) {
        let left;
        let right;
        try {
            left = Buffer.from(actual, 'base64url');
            right = Buffer.from(expected, 'base64url');
        } catch {
            return false;
        }
        return (
            left.byteLength === ROLLBACK_HMAC_BYTES &&
            right.byteLength === left.byteLength &&
            timingSafeEqual(left, right)
        );
    }

    /**
     * @param {{
     *   workspaceId:string;
     *   workspaceRoot:string;
     *   policy:ReturnType<typeof import('#copilot/infra/internal/filesystem/transaction').readIoRollbackPolicy>;
     * }} binding
     */
    function bindWorkspace(binding) {
        assertActive();
        const workspaceId = assertIdentity(binding?.workspaceId, 'workspaceId');
        const workspaceRoot = path.resolve(assertIdentity(binding?.workspaceRoot, 'workspaceRoot'));
        const workspaceRootDigest = sha256(workspaceRoot);
        const policy = binding?.policy;
        if (!policy || typeof policy !== 'object') throw new TypeError('Rollback workspace binding requires a policy.');

        /** @param {import('./token.js').IoRollbackToken} token @param {number} nowMs */
        function verifyAt(token, nowMs) {
            if (!validateIoRollbackTokenShape(token)) return false;
            if (token.audience !== ROLLBACK_TOKEN_AUDIENCE) return false;
            if (token.runtimeId !== runtimeId || token.workspaceId !== workspaceId) return false;
            if (token.workspaceRootDigest !== workspaceRootDigest) return false;
            if (!rollbackStepsStayInsideWorkspace(token.steps, workspaceRoot)) return false;
            if (token.expiresAtMs <= token.createdAtMs || token.expiresAtMs - token.createdAtMs > ttlMs) return false;
            if (nowMs < token.createdAtMs || nowMs >= token.expiresAtMs) return false;
            if (!verifyIoRollbackTokenDigest(token)) return false;
            return tagsEqual(token.authTag, sign(token));
        }

        /**
         * @param {import('../contracts/index.js').IoChangeSet} changeSet
         * @param {{nowMs?:number}} [issueOptions]
         */
        function issue(changeSet, issueOptions = {}) {
            assertActive();
            const nowMs = normalizeNow(issueOptions.nowMs);
            const unsigned = createIoRollbackTokenEnvelope(changeSet, {
                runtimeId,
                workspaceId,
                workspaceRootDigest,
                createdAtMs: nowMs,
                expiresAtMs: nowMs + ttlMs,
            });
            if (!rollbackStepsStayInsideWorkspace(unsigned.steps, workspaceRoot)) {
                throw rollbackError(
                    'EROLLBACKPATHCLAIM',
                    'Rollback change set contains a path outside the bound workspace.',
                );
            }
            const token = Object.freeze({
                ...unsigned,
                authTag: sign(/** @type {import('./token.js').IoRollbackToken} */ ({ ...unsigned, authTag: '' })),
            });
            return Object.freeze({ token, serialized: serializeIoRollbackToken(token) });
        }

        /** @param {string} serialized @param {{nowMs?:number}} [parseOptions] */
        function parse(serialized, parseOptions = {}) {
            assertActive();
            const token = decodeIoRollbackToken(serialized);
            if (!verifyAt(token, normalizeNow(parseOptions.nowMs))) {
                throw rollbackError(
                    'EROLLBACKAUTH',
                    'Rollback capability is invalid, expired, or belongs to another runtime/workspace.',
                );
            }
            return token;
        }

        /** @param {import('./token.js').IoRollbackToken} token @param {{nowMs?:number}} [verifyOptions] */
        function verify(token, verifyOptions = {}) {
            if (disposed) return false;
            return verifyAt(token, normalizeNow(verifyOptions.nowMs));
        }

        /**
         * @param {string|import('./token.js').IoRollbackToken} tokenOrSerialized
         * @param {{dryRun?:boolean;allowedPaths?:ReadonlySet<string>;nowMs?:number;onPhase?:(phase:string,details:Record<string,unknown>)=>void|Promise<void>}} [executeOptions]
         */
        async function execute(tokenOrSerialized, executeOptions = {}) {
            assertActive();
            const nowMs = normalizeNow(executeOptions.nowMs);
            const token =
                typeof tokenOrSerialized === 'string' ? parse(tokenOrSerialized, { nowMs }) : tokenOrSerialized;
            if (!verifyAt(token, nowMs)) {
                throw rollbackError('EROLLBACKAUTH', 'Rollback capability authentication failed.');
            }
            const dryRun = executeOptions.dryRun !== false;
            if (!dryRun) {
                if (consumedTokenIds.has(token.tokenId) || executingTokenIds.has(token.tokenId)) {
                    throw rollbackError(
                        'EROLLBACKREPLAY',
                        `Rollback capability ${token.tokenId} has already been consumed or is executing.`,
                    );
                }
                executingTokenIds.add(token.tokenId);
            }
            try {
                const result = await executeAuthenticatedIoRollbackToken(token, {
                    dryRun,
                    ...(executeOptions.allowedPaths ? { allowedPaths: executeOptions.allowedPaths } : {}),
                    sidecarDirectory: policy.directory,
                    nowMs,
                    ...(executeOptions.onPhase ? { onPhase: executeOptions.onPhase } : {}),
                });
                if (!dryRun && (result.success || result.appliedCount > 0 || result.mutationApplied === true)) {
                    consumedTokenIds.add(token.tokenId);
                }
                return result;
            } finally {
                if (!dryRun) executingTokenIds.delete(token.tokenId);
            }
        }

        /** @param {{maxEntries?:number;verifyContent?:boolean;nowMs?:number}} [inventoryOptions] */
        function listSidecars(inventoryOptions = {}) {
            assertActive();
            return listRollbackSidecars({
                policy,
                ...(inventoryOptions.maxEntries === undefined ? {} : { maxEntries: inventoryOptions.maxEntries }),
                ...(inventoryOptions.verifyContent === undefined
                    ? {}
                    : { verifyContent: inventoryOptions.verifyContent }),
                ...(inventoryOptions.nowMs === undefined ? {} : { nowMs: inventoryOptions.nowMs }),
            });
        }

        /**
         * Cleanup is bound to the workspace rollback policy/directory. Callers may tune retention behavior but cannot
         * retarget the filesystem namespace.
         * @param {{
         *   nowMs?:number;
         *   scanLimit?:number;
         *   maxEntries?:number;
         *   maxBytes?:number;
         *   purgeAll?:boolean;
         *   enforceBudget?:boolean;
         * }} [cleanupOptions]
         */
        function cleanupSidecars(cleanupOptions = {}) {
            assertActive();
            return cleanupRollbackSidecars({
                policy,
                ...(cleanupOptions.nowMs === undefined ? {} : { nowMs: cleanupOptions.nowMs }),
                ...(cleanupOptions.scanLimit === undefined ? {} : { scanLimit: cleanupOptions.scanLimit }),
                ...(cleanupOptions.maxEntries === undefined ? {} : { maxEntries: cleanupOptions.maxEntries }),
                ...(cleanupOptions.maxBytes === undefined ? {} : { maxBytes: cleanupOptions.maxBytes }),
                ...(cleanupOptions.purgeAll === undefined ? {} : { purgeAll: cleanupOptions.purgeAll }),
                ...(cleanupOptions.enforceBudget === undefined ? {} : { enforceBudget: cleanupOptions.enforceBudget }),
            });
        }

        return Object.freeze({
            runtimeId,
            workspaceId,
            workspaceRoot,
            policy,
            issue,
            parse,
            verify,
            execute,
            listSidecars,
            cleanupSidecars,
            snapshot() {
                return Object.freeze({
                    runtimeId,
                    workspaceId,
                    audience: ROLLBACK_TOKEN_AUDIENCE,
                    ttlMs,
                    consumedTokens: consumedTokenIds.size,
                    executingTokens: executingTokenIds.size,
                    disposed,
                });
            },
        });
    }

    return Object.freeze({
        runtimeId,
        ttlMs,
        bindWorkspace,
        snapshot() {
            return Object.freeze({
                runtimeId,
                ttlMs,
                consumedTokens: consumedTokenIds.size,
                executingTokens: executingTokenIds.size,
                disposed,
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            consumedTokenIds.clear();
            executingTokenIds.clear();
            secret.fill(0);
        },
    });
}

/** @param {unknown} value @param {string} label */
function assertIdentity(value, label) {
    if (typeof value !== 'string' || !value.trim())
        throw new TypeError(`Rollback capability ${label} must be non-empty.`);
    return value.trim();
}

/** @param {unknown} value */
function normalizeTtl(value) {
    const ttl = Number(value);
    if (!Number.isSafeInteger(ttl) || ttl <= 0)
        throw new TypeError('Rollback capability ttlMs must be a positive safe integer.');
    return ttl;
}

/** @param {unknown} value */
function normalizeNow(value) {
    const now = value === undefined ? Date.now() : Number(value);
    if (!Number.isSafeInteger(now) || now < 0)
        throw new TypeError('Rollback capability nowMs must be a non-negative safe integer.');
    return now;
}

/** @param {readonly import('./token.js').IoRollbackStep[]} steps @param {string} workspaceRoot */
function rollbackStepsStayInsideWorkspace(steps, workspaceRoot) {
    for (const step of steps) {
        const paths = step.action === 'move' ? [step.source, step.destination] : [step.target];
        for (const candidate of paths) {
            if (typeof candidate !== 'string' || !pathIsInsideWorkspace(candidate, workspaceRoot)) return false;
        }
    }
    return true;
}

/** @param {string} candidate @param {string} workspaceRoot */
function pathIsInsideWorkspace(candidate, workspaceRoot) {
    const relative = path.relative(workspaceRoot, path.resolve(candidate));
    return (
        relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    );
}

/** @param {string} code @param {string} message */
function rollbackError(code, message) {
    const error = new Error(message);
    /** @type {{code?:string}} */ (error).code = code;
    return error;
}
