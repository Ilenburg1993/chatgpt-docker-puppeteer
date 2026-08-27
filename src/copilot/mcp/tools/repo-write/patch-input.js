// @ts-check
/**
 * Canonicalize repository patch-batch target-group inputs at the MCP exposure boundary.
 *
 * Patch Target Groups V3 is the only accepted wire representation. Target identity, baseline hash and durability are
 * target-owned; operations contain only relative edit semantics.
 *
 * @module copilot/mcp/tools/repo-write/patch-input
 */

import path from 'node:path';

/** @typedef {import('#copilot/mcp/public/workspace/repository/patch').RepositoryPatchDurability} PatchDurability */
/** @typedef {import('#copilot/mcp/public/workspace/repository/patch').RepositoryPatchTarget} CanonicalPatchTarget */
/**
 * @typedef {{
 *   ok: true;
 *   targets: CanonicalPatchTarget[];
 *   operationCount: number;
 *   targetCount: number;
 *   inputBytes: number;
 * } | {
 *   ok: false;
 *   code: 'ERR_PATCH_BATCH_INPUT_SHAPE' | 'ERR_PATCH_BATCH_DUPLICATE_TARGET' |
 *       'ERR_PATCH_BATCH_OPERATION_LIMIT' | 'ERR_PATCH_BATCH_TARGET_LIMIT' |
 *       'ERR_PATCH_BATCH_INPUT_BYTES_LIMIT' | 'ERR_PATCH_BATCH_INPUT_SERIALIZATION';
 *   operationCount: number;
 *   targetCount: number;
 *   inputBytes: number | null;
 *   duplicatePath?: string;
 * }} PatchBatchInputNormalization
 */

/**
 * @param {Record<string, unknown>} input
 * @param {{ maxOperations: number; maxTargets: number; maxInputBytes: number }} limits
 * @returns {PatchBatchInputNormalization}
 */
export function normalizePatchBatchWireInput(input, limits) {
    const inputBytes = measureInputBytes(input);
    if (inputBytes === null) {
        return {
            ok: false,
            code: 'ERR_PATCH_BATCH_INPUT_SERIALIZATION',
            operationCount: 0,
            targetCount: 0,
            inputBytes: null,
        };
    }
    const targets = input['targets'];
    if (
        !Array.isArray(targets) ||
        targets.length === 0 ||
        input['operations'] !== undefined ||
        input['durability'] !== undefined
    ) {
        return {
            ok: false,
            code: 'ERR_PATCH_BATCH_INPUT_SHAPE',
            operationCount: 0,
            targetCount: 0,
            inputBytes,
        };
    }

    const normalized = normalizeTargets(/** @type {Record<string, unknown>[]} */ (targets));
    if (!normalized.ok) return { ...normalized, inputBytes };
    if (normalized.operationCount > limits.maxOperations) {
        return {
            ok: false,
            code: 'ERR_PATCH_BATCH_OPERATION_LIMIT',
            operationCount: normalized.operationCount,
            targetCount: normalized.targets.length,
            inputBytes,
        };
    }
    if (normalized.targets.length > limits.maxTargets) {
        return {
            ok: false,
            code: 'ERR_PATCH_BATCH_TARGET_LIMIT',
            operationCount: normalized.operationCount,
            targetCount: normalized.targets.length,
            inputBytes,
        };
    }
    if (inputBytes > limits.maxInputBytes) {
        return {
            ok: false,
            code: 'ERR_PATCH_BATCH_INPUT_BYTES_LIMIT',
            operationCount: normalized.operationCount,
            targetCount: normalized.targets.length,
            inputBytes,
        };
    }
    return {
        ok: true,
        targets: normalized.targets,
        operationCount: normalized.operationCount,
        targetCount: normalized.targets.length,
        inputBytes,
    };
}

/**
 * @param {Record<string, unknown>[]} targets
 * @returns {{ok:true;targets:CanonicalPatchTarget[];operationCount:number} | {ok:false;code:'ERR_PATCH_BATCH_DUPLICATE_TARGET';operationCount:number;targetCount:number;duplicatePath:string}}
 */
function normalizeTargets(targets) {
    /** @type {CanonicalPatchTarget[]} */
    const normalized = [];
    const seen = new Set();
    let operationIndex = 0;
    for (const target of targets) {
        const targetPath = String(target['path'] ?? '');
        const targetKey = normalizeTargetIdentity(targetPath);
        if (seen.has(targetKey)) {
            return {
                ok: false,
                code: 'ERR_PATCH_BATCH_DUPLICATE_TARGET',
                operationCount: operationIndex,
                targetCount: normalized.length + 1,
                duplicatePath: targetPath,
            };
        }
        seen.add(targetKey);
        const operations = /** @type {Record<string, unknown>[]} */ (target['operations']);
        const entries = operations.map((operation) => ({ index: operationIndex++, operation: { ...operation } }));
        const expectedHash = readPatchExpectedHash(target);
        const durability = readPatchDurability(target['durability']);
        normalized.push({
            path: targetPath,
            expectedHashMode: expectedHash ? 'target-baseline' : 'none',
            ...(expectedHash ? { expectedHash } : {}),
            ...(durability ? { durability } : {}),
            entries,
        });
    }
    return { ok: true, targets: normalized, operationCount: operationIndex };
}

/** @param {Record<string, unknown>} value */
function readPatchExpectedHash(value) {
    return typeof value['expectedHash'] === 'string' && value['expectedHash'] ? value['expectedHash'] : null;
}

/** @param {unknown} value @returns {PatchDurability | undefined} */
function readPatchDurability(value) {
    return value === 'file-and-directory' || value === 'file' || value === 'none' ? value : undefined;
}

/** @param {string} value */
function normalizeTargetIdentity(value) {
    return path.posix.normalize(value.replaceAll('\\', '/').replace(/^\.\//u, ''));
}

/** @param {Record<string, unknown>} input */
function measureInputBytes(input) {
    try {
        return Buffer.byteLength(JSON.stringify(input), 'utf8');
    } catch {
        return null;
    }
}
