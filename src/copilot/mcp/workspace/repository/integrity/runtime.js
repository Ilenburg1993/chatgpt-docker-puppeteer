// @ts-check
/**
 * Hash-bound source barriers for repository validation and promotion.
 *
 * A barrier certifies the exact bytes observed for an explicit file set. It is intentionally independent from Git
 * state and from MCP audit provenance: provenance can explain a later transition, but it can never make a stale
 * validation barrier valid again.
 *
 * @module copilot/mcp/workspace/repository/integrity/runtime
 */

import { createHash } from 'node:crypto';

const SOURCE_BARRIER_SCHEMA = 'copilot.repository-source-barrier';
const SOURCE_BARRIER_VERSION = 2;
const SOURCE_BARRIER_LEGACY_DOMAIN = 'copilot.repository-source-barrier.v1';
const SOURCE_BARRIER_DOMAIN = 'copilot.repository-source-barrier.v2';
const MAX_SOURCE_BARRIER_FILES = 500;
const SOURCE_BARRIER_FINGERPRINT_RE = /^[a-f0-9]{64}$/u;

/** @typedef {import('#copilot/mcp/public/workspace').McpWorkspaceCapability} SourceBarrierWorkspace */
/** @typedef {Readonly<{ path: string; sha256: string; bytes: number }>} RepositorySourceBarrierLegacyEntry */
/** @typedef {Readonly<{ kind: 'file'; path: string; sha256: string; bytes: number }>} RepositorySourceBarrierFileEntry */
/** @typedef {Readonly<{ kind: 'absent'; path: string }>} RepositorySourceBarrierAbsentEntry */
/** @typedef {RepositorySourceBarrierFileEntry | RepositorySourceBarrierAbsentEntry} RepositorySourceBarrierEntry */
/** @typedef {Readonly<{ schema: typeof SOURCE_BARRIER_SCHEMA; version: 1; algorithm: 'sha256'; domain: typeof SOURCE_BARRIER_LEGACY_DOMAIN; capturedAt: string; entryCount: number; fingerprint: string; entries: readonly RepositorySourceBarrierLegacyEntry[] }> | Readonly<{ schema: typeof SOURCE_BARRIER_SCHEMA; version: typeof SOURCE_BARRIER_VERSION; algorithm: 'sha256'; domain: typeof SOURCE_BARRIER_DOMAIN; capturedAt: string; entryCount: number; fingerprint: string; entries: readonly RepositorySourceBarrierEntry[] }>} RepositorySourceBarrier */
/** @typedef {Readonly<{ path: string; kind: 'missing-or-unreadable' | 'content-changed' | 'unexpected-file'; expectedSha256: string | null; actualSha256: string | null; expectedBytes: number | null; actualBytes: number | null; provenance: 'controlled-mcp-transition' | 'unattributed'; traceId: string | null }>} RepositorySourceDrift */
/** @typedef {Pick<ReturnType<typeof import('#copilot/mcp/public/observability').createMcpAuditCapability>, 'readTail'>} SourceBarrierAuditCapability */

/** @param {readonly (RepositorySourceBarrierEntry | RepositorySourceBarrierLegacyEntry)[]} entries */
export function fingerprintRepositorySourceBarrierEntries(entries) {
    const legacy = entries.every((entry) => !('kind' in entry));
    const current = entries.every((entry) => 'kind' in entry);
    if (!legacy && !current) {
        throw new TypeError('Repository source barrier fingerprint entries cannot mix v1 and v2 shapes.');
    }
    const hash = createHash('sha256');
    hash.update(`${legacy ? SOURCE_BARRIER_LEGACY_DOMAIN : SOURCE_BARRIER_DOMAIN}\0`);
    for (const entry of entries) {
        if (!('kind' in entry)) hash.update(JSON.stringify([entry.path, entry.sha256, entry.bytes]));
        else if (entry.kind === 'absent') hash.update(JSON.stringify([entry.kind, entry.path]));
        else hash.update(JSON.stringify([entry.kind, entry.path, entry.sha256, entry.bytes]));
        hash.update('\n');
    }
    return hash.digest('hex');
}

/** @param {unknown} value */
function assertRepositorySourceBarrier(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Repository source barrier must be an object.');
    const barrier = /** @type {Record<string, unknown>} */ (value);
    const version = barrier['version'];
    if (barrier['schema'] !== SOURCE_BARRIER_SCHEMA || (version !== 1 && version !== SOURCE_BARRIER_VERSION)) {
        throw new TypeError('Unsupported repository source barrier schema/version.');
    }
    const expectedDomain = version === 1 ? SOURCE_BARRIER_LEGACY_DOMAIN : SOURCE_BARRIER_DOMAIN;
    if (barrier['algorithm'] !== 'sha256' || barrier['domain'] !== expectedDomain) {
        throw new TypeError('Repository source barrier algorithm/domain is invalid.');
    }
    if (!SOURCE_BARRIER_FINGERPRINT_RE.test(String(barrier['fingerprint'] ?? ''))) {
        throw new TypeError('Repository source barrier fingerprint must be a SHA-256 digest.');
    }
    if (
        !Array.isArray(barrier['entries']) ||
        barrier['entries'].length < 1 ||
        barrier['entries'].length > MAX_SOURCE_BARRIER_FILES
    ) {
        throw new TypeError(
            `Repository source barrier entries must be an array with 1..${MAX_SOURCE_BARRIER_FILES} paths.`,
        );
    }
    if (barrier['entryCount'] !== barrier['entries'].length) {
        throw new TypeError('Repository source barrier entryCount does not match entries length.');
    }
    for (const entry of barrier['entries']) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new TypeError('Repository source barrier entries must be objects.');
        }
        const row = /** @type {Record<string, unknown>} */ (entry);
        if (typeof row['path'] !== 'string' || !row['path']) {
            throw new TypeError('Repository source barrier entry path is invalid.');
        }
        if (version === 1) {
            if (!SOURCE_BARRIER_FINGERPRINT_RE.test(String(row['sha256'] ?? ''))) {
                throw new TypeError('Repository source barrier v1 entry hash is invalid.');
            }
            if (!Number.isSafeInteger(row['bytes']) || Number(row['bytes']) < 0) {
                throw new TypeError('Repository source barrier v1 entry bytes must be a non-negative safe integer.');
            }
            continue;
        }
        if (row['kind'] === 'absent') {
            if (row['sha256'] !== undefined || row['bytes'] !== undefined) {
                throw new TypeError('Repository source barrier absent entries cannot carry file hash/bytes.');
            }
            continue;
        }
        if (row['kind'] !== 'file' || !SOURCE_BARRIER_FINGERPRINT_RE.test(String(row['sha256'] ?? ''))) {
            throw new TypeError('Repository source barrier file entry kind/hash is invalid.');
        }
        if (!Number.isSafeInteger(row['bytes']) || Number(row['bytes']) < 0) {
            throw new TypeError('Repository source barrier file entry bytes must be a non-negative safe integer.');
        }
    }
    return /** @type {RepositorySourceBarrier} */ (value);
}

/** @param {string} content */
export function parseRepositorySourceBarrierJson(content) {
    const parsed = JSON.parse(content);
    return assertRepositorySourceBarrier(parsed);
}

/** @param {unknown} error */
function isMissingPathError(error) {
    return Boolean(error && typeof error === 'object' && /** @type {{code?:unknown}} */ (error).code === 'ENOENT');
}

/**
 * @param {SourceBarrierWorkspace} workspace
 * @param {string} requestedPath
 * @returns {Promise<RepositorySourceBarrierEntry>}
 */
async function readBarrierEntry(workspace, requestedPath) {
    const resolved = await workspace.resolveReadPath(requestedPath);
    if (!resolved.ok) {
        const error = new Error(`Unable to resolve source-barrier path '${requestedPath}': ${resolved.reason}`);
        /** @type {Error & { code?: string }} */ (error).code = resolved.code;
        throw error;
    }
    const relative = resolved.relative.replaceAll('\\', '/');
    try {
        const snapshot = await workspace.io.readBytesFresh(resolved.resolved, {
            includeHash: true,
            advisoryLimits: { operation: 'repository-source-barrier' },
        });
        if (!snapshot.isFile || !snapshot.contentHash) {
            throw new TypeError(`Repository source barrier requires a regular file or absent path: ${relative}`);
        }
        return Object.freeze({
            kind: /** @type {const} */ ('file'),
            path: relative,
            sha256: snapshot.contentHash,
            bytes: snapshot.bytesRead,
        });
    } catch (error) {
        if (isMissingPathError(error)) {
            return Object.freeze({ kind: /** @type {const} */ ('absent'), path: relative });
        }
        throw error;
    }
}

/**
 * Capture a deterministic state barrier for explicit repository paths, including absent-path tombstones.
 *
 * @param {SourceBarrierWorkspace} workspace
 * @param {readonly string[]} paths
 * @returns {Promise<RepositorySourceBarrier>}
 */
export async function captureRepositorySourceBarrier(workspace, paths) {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_SOURCE_BARRIER_FILES) {
        throw new TypeError(`Repository source barrier requires 1..${MAX_SOURCE_BARRIER_FILES} explicit paths.`);
    }
    const requested = [...new Set(paths.map((value) => String(value).trim()).filter(Boolean))];
    if (requested.length < 1)
        throw new TypeError('Repository source barrier requires at least one non-empty file path.');

    const resolvedEntries = await Promise.all(requested.map((filePath) => readBarrierEntry(workspace, filePath)));
    /** @type {Map<string, RepositorySourceBarrierEntry>} */
    const unique = new Map();
    for (const entry of resolvedEntries) unique.set(entry.path, entry);
    const entries = Object.freeze([...unique.values()].sort((left, right) => left.path.localeCompare(right.path)));
    const fingerprint = fingerprintRepositorySourceBarrierEntries(entries);
    return Object.freeze({
        schema: SOURCE_BARRIER_SCHEMA,
        version: SOURCE_BARRIER_VERSION,
        algorithm: 'sha256',
        domain: SOURCE_BARRIER_DOMAIN,
        capturedAt: new Date().toISOString(),
        entryCount: entries.length,
        fingerprint,
        entries,
    });
}

/**
 * Classify one drift row against persisted/observed mutation transitions. Classification is diagnostic only.
 *
 * @param {RepositorySourceDrift} drift
 * @param {readonly Record<string, unknown>[]} transitions
 */
export function classifyRepositorySourceDriftProvenance(drift, transitions) {
    const transition = transitions.find(
        (candidate) =>
            candidate['path'] === drift.path &&
            candidate['previousHash'] === drift.expectedSha256 &&
            candidate['contentHash'] === drift.actualSha256,
    );
    return Object.freeze({
        ...drift,
        provenance: transition
            ? /** @type {const} */ ('controlled-mcp-transition')
            : /** @type {const} */ ('unattributed'),
        traceId: transition && typeof transition['traceId'] === 'string' ? transition['traceId'] : null,
    });
}

/** @param {Record<string, unknown>} candidate */
function normalizeRepositorySourceTransition(candidate) {
    const path = typeof candidate['path'] === 'string' ? candidate['path'].replaceAll('\\', '/') : null;
    const previousHash = typeof candidate['previousHash'] === 'string' ? candidate['previousHash'] : null;
    const contentHash = typeof candidate['contentHash'] === 'string' ? candidate['contentHash'] : null;
    if (!path || !previousHash || !contentHash) return null;
    return Object.freeze({
        path,
        previousHash,
        contentHash,
        traceId: typeof candidate['traceId'] === 'string' ? candidate['traceId'] : null,
    });
}

/** @param {Record<string, unknown>} event */
function repositorySourceTransitionsFromAuditEvent(event) {
    const transitions = [];
    const direct = normalizeRepositorySourceTransition(event);
    if (direct) transitions.push(direct);
    if (Array.isArray(event['targetTransitions'])) {
        for (const candidate of event['targetTransitions']) {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
            const normalized = normalizeRepositorySourceTransition(/** @type {Record<string, unknown>} */ (candidate));
            if (normalized) transitions.push(normalized);
        }
    }
    return transitions;
}

/**
 * Project only mutation transitions relevant to the barrier from the bounded persisted MCP audit tail. Audit failure is
 * diagnostic: it can reduce attribution quality, but can never make a drifted barrier pass.
 *
 * @param {SourceBarrierAuditCapability} audit
 * @param {RepositorySourceBarrier} barrier
 */
async function readRepositorySourceTransitionsFromAudit(audit, barrier) {
    const tail = await audit.readTail({ tailBytes: 4 * 1024 * 1024, maxEvents: 25_000 });
    if (!tail.ok) {
        return {
            transitions: /** @type {Record<string, unknown>[]} */ ([]),
            evidence: {
                attempted: true,
                available: false,
                error: tail.error,
                parsedEvents: 0,
                relevantTransitions: 0,
                truncatedByBytes: false,
            },
        };
    }
    const barrierPaths = new Set(barrier.entries.map((entry) => entry.path));
    const transitions = tail.events
        .flatMap(repositorySourceTransitionsFromAuditEvent)
        .filter((transition) => barrierPaths.has(transition.path));
    return {
        transitions,
        evidence: {
            attempted: true,
            available: true,
            error: null,
            parsedEvents: tail.parsedEvents,
            relevantTransitions: transitions.length,
            truncatedByBytes: tail.truncatedByBytes,
            tailBytesRead: tail.tailBytesRead,
        },
    };
}

/**
 * Verify that every certified file still has exactly the same bytes. Any divergence throws `ERR_SOURCE_DRIFT`.
 * Known MCP provenance is diagnostic only and never converts drift into success.
 *
 * @param {SourceBarrierWorkspace} workspace
 * @param {RepositorySourceBarrier} barrierInput
 * @param {{ transitions?: readonly Record<string, unknown>[]; audit?: SourceBarrierAuditCapability }} [options]
 */
export async function verifyRepositorySourceBarrier(workspace, barrierInput, options = {}) {
    const barrier = assertRepositorySourceBarrier(barrierInput);
    const expectedFingerprint = fingerprintRepositorySourceBarrierEntries(barrier.entries);
    if (expectedFingerprint !== barrier.fingerprint) {
        const error = new Error('Repository source barrier fingerprint does not match its entries.');
        /** @type {Error & { code?: string }} */ (error).code = 'ERR_SOURCE_BARRIER_INVALID';
        throw error;
    }

    /** @type {RepositorySourceDrift[]} */
    const drift = [];
    /** @type {(RepositorySourceBarrierEntry | RepositorySourceBarrierLegacyEntry)[]} */
    const currentEntries = [];
    for (const expected of barrier.entries) {
        const legacy = barrier.version === 1;
        const expectedKind = legacy ? 'file' : /** @type {RepositorySourceBarrierEntry} */ (expected).kind;
        const expectedSha256 = expectedKind === 'file' ? /** @type {{sha256:string}} */ (expected).sha256 : null;
        const expectedBytes = expectedKind === 'file' ? /** @type {{bytes:number}} */ (expected).bytes : null;
        try {
            const current = await readBarrierEntry(workspace, expected.path);
            if (legacy) {
                if (current.kind === 'absent') {
                    drift.push({
                        path: expected.path,
                        kind: 'missing-or-unreadable',
                        expectedSha256,
                        actualSha256: null,
                        expectedBytes,
                        actualBytes: null,
                        provenance: 'unattributed',
                        traceId: null,
                    });
                    continue;
                }
                const legacyCurrent = Object.freeze({
                    path: current.path,
                    sha256: current.sha256,
                    bytes: current.bytes,
                });
                currentEntries.push(legacyCurrent);
                if (current.sha256 !== expectedSha256 || current.bytes !== expectedBytes) {
                    drift.push({
                        path: expected.path,
                        kind: 'content-changed',
                        expectedSha256,
                        actualSha256: current.sha256,
                        expectedBytes,
                        actualBytes: current.bytes,
                        provenance: 'unattributed',
                        traceId: null,
                    });
                }
                continue;
            }

            currentEntries.push(current);
            if (expectedKind === 'absent') {
                if (current.kind === 'file') {
                    drift.push({
                        path: expected.path,
                        kind: 'unexpected-file',
                        expectedSha256: null,
                        actualSha256: current.sha256,
                        expectedBytes: null,
                        actualBytes: current.bytes,
                        provenance: 'unattributed',
                        traceId: null,
                    });
                }
                continue;
            }
            if (current.kind === 'absent') {
                drift.push({
                    path: expected.path,
                    kind: 'missing-or-unreadable',
                    expectedSha256,
                    actualSha256: null,
                    expectedBytes,
                    actualBytes: null,
                    provenance: 'unattributed',
                    traceId: null,
                });
                continue;
            }
            if (current.sha256 !== expectedSha256 || current.bytes !== expectedBytes) {
                drift.push({
                    path: expected.path,
                    kind: 'content-changed',
                    expectedSha256,
                    actualSha256: current.sha256,
                    expectedBytes,
                    actualBytes: current.bytes,
                    provenance: 'unattributed',
                    traceId: null,
                });
            }
        } catch {
            drift.push({
                path: expected.path,
                kind: 'missing-or-unreadable',
                expectedSha256,
                actualSha256: null,
                expectedBytes,
                actualBytes: null,
                provenance: 'unattributed',
                traceId: null,
            });
        }
    }

    const currentFingerprint =
        currentEntries.length === barrier.entries.length
            ? fingerprintRepositorySourceBarrierEntries(
                  currentEntries.sort((left, right) => left.path.localeCompare(right.path)),
              )
            : null;
    if (drift.length > 0) {
        const transitions = [...(options.transitions ?? [])];
        let provenanceEvidence = {
            attempted: false,
            available: false,
            error: /** @type {string | null} */ (null),
            parsedEvents: 0,
            relevantTransitions: 0,
            truncatedByBytes: false,
        };
        if (options.audit) {
            try {
                const persisted = await readRepositorySourceTransitionsFromAudit(options.audit, barrier);
                transitions.push(...persisted.transitions);
                provenanceEvidence = { ...provenanceEvidence, ...persisted.evidence };
            } catch (auditError) {
                provenanceEvidence = {
                    ...provenanceEvidence,
                    attempted: true,
                    error: auditError instanceof Error ? auditError.message : String(auditError),
                };
            }
        }
        const classifiedDrift = drift.map((row) => classifyRepositorySourceDriftProvenance(row, transitions));
        const error = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (
            new Error(`Repository source drift detected in ${classifiedDrift.length} certified file(s).`)
        );
        error.code = 'ERR_SOURCE_DRIFT';
        error.details = {
            expectedFingerprint: barrier.fingerprint,
            currentFingerprint,
            drift: classifiedDrift,
            provenanceEvidence,
            mutationState: 'external-to-barrier',
            promotionAllowed: false,
        };
        throw error;
    }
    return Object.freeze({
        ok: true,
        fingerprint: barrier.fingerprint,
        currentFingerprint,
        entryCount: barrier.entryCount,
        verifiedAt: new Date().toISOString(),
    });
}

/**
 * Read a persisted barrier through the workspace authority using a physical, cache-bypassing snapshot.
 *
 * @param {SourceBarrierWorkspace} workspace
 * @param {string} manifestPath
 */
export async function readRepositorySourceBarrierManifest(workspace, manifestPath) {
    const resolved = await workspace.resolveReadPath(manifestPath);
    if (!resolved.ok) {
        const error = new Error(`Unable to resolve source-barrier manifest '${manifestPath}': ${resolved.reason}`);
        /** @type {Error & { code?: string }} */ (error).code = resolved.code;
        throw error;
    }
    const snapshot = await workspace.io.readTextFresh(resolved.resolved, {
        advisoryLimits: { operation: 'repository-source-barrier-manifest' },
    });
    return Object.freeze({
        manifestPath: resolved.relative.replaceAll('\\', '/'),
        barrier: parseRepositorySourceBarrierJson(snapshot.content),
    });
}

/**
 * Verify a persisted manifest and bind it to the fingerprint carried by the prior validation/promotion step.
 * A valid-but-different manifest is rejected before source verification.
 *
 * @param {SourceBarrierWorkspace} workspace
 * @param {string} manifestPath
 * @param {{ expectedFingerprint: string; audit?: SourceBarrierAuditCapability }} options
 */
export async function verifyRepositorySourceBarrierManifest(workspace, manifestPath, options) {
    const expectedFingerprint = String(options?.expectedFingerprint ?? '')
        .trim()
        .toLowerCase();
    if (!SOURCE_BARRIER_FINGERPRINT_RE.test(expectedFingerprint)) {
        throw new TypeError('Expected source-barrier fingerprint must be a SHA-256 digest.');
    }
    const loaded = await readRepositorySourceBarrierManifest(workspace, manifestPath);
    if (loaded.barrier.fingerprint !== expectedFingerprint) {
        const error = /** @type {Error & { code?: string; details?: Record<string, unknown> }} */ (
            new Error(
                `Source-barrier manifest fingerprint mismatch: expected ${expectedFingerprint}, got ${loaded.barrier.fingerprint}.`,
            )
        );
        error.code = 'ERR_SOURCE_BARRIER_FINGERPRINT_MISMATCH';
        error.details = {
            manifestPath: loaded.manifestPath,
            expectedFingerprint,
            manifestFingerprint: loaded.barrier.fingerprint,
            promotionAllowed: false,
        };
        throw error;
    }
    const verified = await verifyRepositorySourceBarrier(workspace, loaded.barrier, {
        ...(options.audit ? { audit: options.audit } : {}),
    });
    return Object.freeze({
        ...verified,
        manifestPath: loaded.manifestPath,
        expectedFingerprint,
    });
}

export const REPOSITORY_SOURCE_BARRIER_LIMITS = Object.freeze({
    version: SOURCE_BARRIER_VERSION,
    maxFiles: MAX_SOURCE_BARRIER_FILES,
    absentPathTombstones: true,
});
