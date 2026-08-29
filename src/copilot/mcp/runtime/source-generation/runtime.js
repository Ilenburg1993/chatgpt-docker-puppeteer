// @ts-check
/**
 * Immutable identity of the MCP source generation loaded by the current Node process.
 *
 * A controlled reload binds the new process to the exact repository source-barrier fingerprint that was verified by
 * the reload owner. Manual/local starts remain explicit `manual-unbound` generations rather than inferring identity
 * from the mutable Git worktree. Promotion metadata is non-secret and must be complete and valid or process
 * composition fails closed.
 *
 * @module copilot/mcp/runtime/source-generation/runtime
 */

import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, posix } from 'node:path';
import { performance } from 'node:perf_hooks';

export const MCP_RUNTIME_SOURCE_GENERATION_SCHEMA_VERSION = 1;
export const MCP_RUNTIME_SOURCE_GENERATION_KIND = 'copilot-mcp-runtime-source-generation';
export const MCP_RUNTIME_GENERATION_CERTIFICATE_SCHEMA_VERSION = 1;
export const MCP_RUNTIME_GENERATION_CERTIFICATE_KIND = 'copilot-mcp-runtime-generation-certificate';
export const MCP_RUNTIME_GENERATION_CERTIFICATE_FINGERPRINT_KIND = 'sha256-stable-projection-v1';

export const MCP_RUNTIME_SOURCE_PROMOTION_ENV = Object.freeze({
    requestId: 'COPILOT_MCP_PROMOTION_REQUEST_ID',
    sourceBarrierFingerprint: 'COPILOT_MCP_PROMOTED_SOURCE_FINGERPRINT',
    sourceBarrierManifestPath: 'COPILOT_MCP_PROMOTED_MANIFEST_PATH',
});

const PROMOTION_REQUEST_ID_RE = /^mcp-reload-[a-z0-9-]{8,80}$/u;
const SOURCE_FINGERPRINT_RE = /^[a-f0-9]{64}$/u;
const MAX_MANIFEST_PATH_CHARS = 1024;

const PROCESS_STARTED_AT_MS = Math.trunc(performance.timeOrigin);
const PROCESS_IDENTITY = Object.freeze({
    runtimeEpochId: randomUUID(),
    processStartedAtMs: PROCESS_STARTED_AT_MS,
    processStartedAt: new Date(PROCESS_STARTED_AT_MS).toISOString(),
    pid: process.pid,
});

/**
 * @typedef {Readonly<{
 *     requestId: string;
 *     sourceBarrierFingerprint: string;
 *     sourceBarrierManifestPath: string;
 * }>} McpRuntimeSourcePromotionBinding
 *
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-runtime-source-generation';
 *     runtimeEpochId: string;
 *     processStartedAtMs: number;
 *     processStartedAt: string;
 *     pid: number;
 *     sourceBinding: 'controlled-promotion' | 'manual-unbound';
 *     promotionRequestId: string | null;
 *     sourceBarrierFingerprint: string | null;
 *     sourceBarrierManifestPath: string | null;
 * }>} McpRuntimeSourceGeneration
 *
 * @typedef {Readonly<{
 *     schemaVersion: 1;
 *     kind: 'copilot-mcp-runtime-generation-certificate';
 *     runtime: Readonly<{
 *         runtimeEpochId: string;
 *         processStartedAtMs: number;
 *         processStartedAt: string;
 *         pid: number;
 *         nodeVersion: string;
 *         platform: NodeJS.Platform;
 *         arch: string;
 *     }>;
 *     source: Readonly<{
 *         binding: 'controlled-promotion' | 'manual-unbound';
 *         proof: 'source-barrier-bound' | 'manual-unbound';
 *         promotionRequestId: string | null;
 *         sourceBarrierFingerprint: string | null;
 *         sourceBarrierManifestPath: string | null;
 *     }>;
 *     toolSurface: Readonly<{
 *         evidence: 'operation-context-frozen' | 'descriptor-observation-fallback' | 'unavailable';
 *         available: boolean;
 *         toolCount: number | null;
 *         descriptorFingerprint: string | null;
 *         descriptorFingerprintKind: string | null;
 *     }>;
 *     certificateFingerprintKind: 'sha256-stable-projection-v1';
 *     certificateFingerprint: string;
 * }>} McpRuntimeGenerationCertificate
 */

/**
 * Capture the immutable source identity for this process generation.
 *
 * The process epoch/start identity is module-stable, so multiple composition roots created inside the same Node
 * process cannot fabricate different process generations. Only an explicit complete promotion binding may claim a
 * source fingerprint; otherwise the process is truthfully `manual-unbound`.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {McpRuntimeSourceGeneration}
 */
export function createMcpRuntimeSourceGeneration(env) {
    if (!env) throw new TypeError('MCP runtime source generation requires an explicit process environment.');
    const promotion = readMcpRuntimeSourcePromotionBinding(env);
    return Object.freeze({
        schemaVersion: MCP_RUNTIME_SOURCE_GENERATION_SCHEMA_VERSION,
        kind: MCP_RUNTIME_SOURCE_GENERATION_KIND,
        ...PROCESS_IDENTITY,
        sourceBinding: promotion
            ? /** @type {const} */ ('controlled-promotion')
            : /** @type {const} */ ('manual-unbound'),
        promotionRequestId: promotion?.requestId ?? null,
        sourceBarrierFingerprint: promotion?.sourceBarrierFingerprint ?? null,
        sourceBarrierManifestPath: promotion?.sourceBarrierManifestPath ?? null,
    });
}

/**
 * Project one immutable, non-secret certificate for the process generation plus the exact registered tool-surface
 * evidence available to the caller. Repository/worktree state is intentionally excluded: it is mutable observation,
 * not boot identity. The tiny projection hash is safe to recompute and never hashes repository files.
 *
 * @param {McpRuntimeSourceGeneration} generation
 * @param {{
 *     evidence?: 'operation-context-frozen' | 'descriptor-observation-fallback' | 'unavailable';
 *     toolCount?: number | null;
 *     descriptorFingerprint?: string | null;
 *     descriptorFingerprintKind?: string | null;
 * }} [surface]
 * @returns {McpRuntimeGenerationCertificate}
 */
export function buildMcpRuntimeGenerationCertificate(generation, surface = {}) {
    if (!generation || generation.kind !== MCP_RUNTIME_SOURCE_GENERATION_KIND) {
        throw new TypeError('MCP runtime generation certificate requires a valid source generation.');
    }
    const descriptorFingerprint = normalizeCertificateToken(surface.descriptorFingerprint, 512);
    const descriptorFingerprintKind = normalizeCertificateToken(surface.descriptorFingerprintKind, 256);
    const toolCount =
        Number.isInteger(surface.toolCount) && Number(surface.toolCount) >= 0 ? Number(surface.toolCount) : null;
    const evidence =
        surface.evidence === 'operation-context-frozen' || surface.evidence === 'descriptor-observation-fallback'
            ? surface.evidence
            : /** @type {const} */ ('unavailable');
    const payload = {
        schemaVersion: /** @type {1} */ (1),
        kind: /** @type {'copilot-mcp-runtime-generation-certificate'} */ ('copilot-mcp-runtime-generation-certificate'),
        runtime: Object.freeze({
            runtimeEpochId: generation.runtimeEpochId,
            processStartedAtMs: generation.processStartedAtMs,
            processStartedAt: generation.processStartedAt,
            pid: generation.pid,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
        }),
        source: Object.freeze({
            binding: generation.sourceBinding,
            proof:
                generation.sourceBinding === 'controlled-promotion'
                    ? /** @type {const} */ ('source-barrier-bound')
                    : /** @type {const} */ ('manual-unbound'),
            promotionRequestId: generation.promotionRequestId,
            sourceBarrierFingerprint: generation.sourceBarrierFingerprint,
            sourceBarrierManifestPath: generation.sourceBarrierManifestPath,
        }),
        toolSurface: Object.freeze({
            evidence,
            available: descriptorFingerprint !== null,
            toolCount,
            descriptorFingerprint,
            descriptorFingerprintKind,
        }),
    };
    const certificateFingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return Object.freeze({
        ...payload,
        certificateFingerprintKind: MCP_RUNTIME_GENERATION_CERTIFICATE_FINGERPRINT_KIND,
        certificateFingerprint,
    });
}

/**
 * Read and validate promotion metadata from an environment boundary. All three values are atomic: partial or malformed
 * metadata is rejected rather than silently degrading to a manual generation.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {McpRuntimeSourcePromotionBinding | null}
 */
export function readMcpRuntimeSourcePromotionBinding(env) {
    if (!env) throw new TypeError('MCP runtime source promotion binding requires an explicit environment.');
    const requestId = normalizeOptional(env[MCP_RUNTIME_SOURCE_PROMOTION_ENV.requestId]);
    const sourceBarrierFingerprint = normalizeOptional(env[MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierFingerprint]);
    const sourceBarrierManifestPath = normalizeOptional(
        env[MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierManifestPath],
    );
    const present = [requestId, sourceBarrierFingerprint, sourceBarrierManifestPath].filter(
        (value) => value !== null,
    ).length;
    if (present === 0) return null;
    if (present !== 3) {
        throw new TypeError(
            'MCP runtime source promotion metadata must provide request id, fingerprint and manifest path together.',
        );
    }
    return validatePromotionBinding({
        requestId: /** @type {string} */ (requestId),
        sourceBarrierFingerprint: /** @type {string} */ (sourceBarrierFingerprint),
        sourceBarrierManifestPath: /** @type {string} */ (sourceBarrierManifestPath),
    });
}

/**
 * Build the exact non-secret environment overrides used to relay a controlled promotion across internal subprocess
 * boundaries. No parent environment or unrelated MCP configuration is copied here.
 *
 * @param {McpRuntimeSourcePromotionBinding} binding
 * @returns {Readonly<Record<string, string>>}
 */
export function buildMcpRuntimeSourcePromotionEnvironment(binding) {
    const validated = validatePromotionBinding(binding);
    return Object.freeze({
        [MCP_RUNTIME_SOURCE_PROMOTION_ENV.requestId]: validated.requestId,
        [MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierFingerprint]: validated.sourceBarrierFingerprint,
        [MCP_RUNTIME_SOURCE_PROMOTION_ENV.sourceBarrierManifestPath]: validated.sourceBarrierManifestPath,
    });
}

/**
 * Project only validated promotion metadata from a broader parent environment. Unknown variables and credentials are
 * excluded by construction.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Readonly<Record<string, string>>}
 */
export function projectMcpRuntimeSourcePromotionEnvironment(env) {
    const binding = readMcpRuntimeSourcePromotionBinding(env);
    return binding ? buildMcpRuntimeSourcePromotionEnvironment(binding) : Object.freeze({});
}

/** @param {McpRuntimeSourcePromotionBinding} binding */
function validatePromotionBinding(binding) {
    if (!binding || typeof binding !== 'object') {
        throw new TypeError('MCP runtime source promotion binding must be an object.');
    }
    const requestId = String(binding.requestId ?? '').trim();
    const sourceBarrierFingerprint = String(binding.sourceBarrierFingerprint ?? '').trim();
    const sourceBarrierManifestPath = String(binding.sourceBarrierManifestPath ?? '').trim();
    if (!PROMOTION_REQUEST_ID_RE.test(requestId)) {
        throw new TypeError('MCP runtime source promotion request id is invalid.');
    }
    if (!SOURCE_FINGERPRINT_RE.test(sourceBarrierFingerprint)) {
        throw new TypeError('MCP runtime source promotion fingerprint must be a lowercase SHA-256 digest.');
    }
    assertCanonicalManifestPath(sourceBarrierManifestPath);
    return Object.freeze({ requestId, sourceBarrierFingerprint, sourceBarrierManifestPath });
}

/** @param {string} manifestPath */
function assertCanonicalManifestPath(manifestPath) {
    if (!manifestPath || manifestPath.length > MAX_MANIFEST_PATH_CHARS || manifestPath.includes('\0')) {
        throw new TypeError('MCP runtime source promotion manifest path is invalid.');
    }
    if (manifestPath.includes('\\') || isAbsolute(manifestPath) || /^[A-Za-z]:[\\/]/u.test(manifestPath)) {
        throw new TypeError('MCP runtime source promotion manifest path must be workspace-relative POSIX syntax.');
    }
    if (posix.isAbsolute(manifestPath) || posix.normalize(manifestPath) !== manifestPath) {
        throw new TypeError('MCP runtime source promotion manifest path must be canonical and workspace-relative.');
    }
    const segments = manifestPath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new TypeError('MCP runtime source promotion manifest path contains an invalid segment.');
    }
}

/** @param {unknown} value @param {number} maxLength */
function normalizeCertificateToken(value, maxLength) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new TypeError('MCP runtime generation certificate evidence token is too long.');
    }
    return normalized;
}

/** @param {string | undefined} value */
function normalizeOptional(value) {
    if (value === undefined) return null;
    const normalized = String(value).trim();
    return normalized || null;
}
