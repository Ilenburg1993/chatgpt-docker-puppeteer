// @ts-check
/**
 * Stable fingerprints for MCP `tools/list` wire descriptors.
 *
 * This module deliberately accepts already-projected wire descriptors. Registry code owns projection from internal
 * tool definitions; protocol/diagnostic code can hash descriptors received from a remote `tools/list` response without
 * importing the registry or duplicating canonicalization rules.
 *
 * @module copilot/mcp/protocol/catalog/descriptor-fingerprint
 */

import { createHash } from 'node:crypto';

export const MCP_TOOL_DESCRIPTOR_FINGERPRINT_KIND = 'tool-wire-sha256-v1';
export const MCP_TOOL_DESCRIPTOR_SET_FINGERPRINT_KIND = 'tools-list-wire-sha256-v1';
export const MCP_TOOL_DESCRIPTOR_REVISION_TOKEN_KIND = 'wire-v1';

/**
 * @param {unknown} descriptor
 * @returns {string}
 */
export function fingerprintMcpToolWireDescriptor(descriptor) {
    return sha256StableJson(descriptor);
}

/**
 * Preserve the established global tools/list fingerprint semantics: the descriptor array order remains significant,
 * while object keys are canonicalized recursively.
 *
 * @param {readonly unknown[]} descriptors
 * @returns {string}
 */
export function fingerprintMcpToolWireDescriptorSet(descriptors) {
    return sha256StableJson(descriptors);
}

/**
 * Build a name-addressable index over a descriptor set. Per-tool comparison is intentionally order-independent and
 * fails closed on duplicate or missing names because ambiguous descriptor identity cannot prove schema parity.
 *
 * @param {readonly unknown[]} descriptors
 * @returns {Readonly<Record<string, string>>}
 */
export function buildMcpToolWireFingerprintIndex(descriptors) {
    /** @type {Record<string, string>} */
    const index = {};
    for (const descriptor of descriptors) {
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw new TypeError('MCP tool descriptor fingerprint index requires object descriptors.');
        }
        const name = /** @type {Record<string, unknown>} */ (descriptor)['name'];
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('MCP tool descriptor fingerprint index requires every descriptor to have a name.');
        }
        if (Object.hasOwn(index, name)) {
            throw new TypeError(`Duplicate MCP tool descriptor name in fingerprint index: ${name}`);
        }
        index[name] = fingerprintMcpToolWireDescriptor(descriptor);
    }
    return Object.freeze(
        Object.fromEntries(Object.entries(index).sort(([left], [right]) => left.localeCompare(right))),
    );
}

/**
 * A stable revision identity suitable for logs/status across process restarts. This is not a monotonic revision number;
 * monotonic descriptorRevision remains process-local observation state.
 *
 * @param {string} fingerprint
 * @returns {string}
 */
export function buildMcpToolDescriptorRevisionToken(fingerprint) {
    const normalized = String(fingerprint ?? '')
        .trim()
        .toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(normalized)) {
        throw new TypeError('MCP tool descriptor revision token requires a SHA-256 fingerprint.');
    }
    return `${MCP_TOOL_DESCRIPTOR_REVISION_TOKEN_KIND}:${normalized.slice(0, 16)}`;
}

/**
 * @param {Readonly<Record<string, string>>} local
 * @param {Readonly<Record<string, string>>} remote
 * @param {readonly string[]} [selectedNames]
 */
export function compareMcpToolWireFingerprintIndexes(local, remote, selectedNames) {
    const universe = selectedNames
        ? [...new Set(selectedNames)].sort((left, right) => left.localeCompare(right))
        : [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort((left, right) =>
              left.localeCompare(right),
          );
    const missingRemoteTools = [];
    const unexpectedRemoteTools = [];
    const mismatchedTools = [];
    const matchingTools = [];
    for (const name of universe) {
        const localFingerprint = local[name];
        const remoteFingerprint = remote[name];
        if (localFingerprint === undefined && remoteFingerprint !== undefined) {
            unexpectedRemoteTools.push(name);
            continue;
        }
        if (localFingerprint !== undefined && remoteFingerprint === undefined) {
            missingRemoteTools.push(name);
            continue;
        }
        if (localFingerprint !== remoteFingerprint) mismatchedTools.push(name);
        else if (localFingerprint !== undefined) matchingTools.push(name);
    }
    return Object.freeze({
        matches: missingRemoteTools.length === 0 && unexpectedRemoteTools.length === 0 && mismatchedTools.length === 0,
        comparedToolCount: matchingTools.length + mismatchedTools.length,
        matchingToolCount: matchingTools.length,
        missingRemoteTools: Object.freeze(missingRemoteTools),
        unexpectedRemoteTools: Object.freeze(unexpectedRemoteTools),
        mismatchedTools: Object.freeze(mismatchedTools),
    });
}

/**
 * Extract wire descriptors from a JSON-RPC tools/list response or an array of response envelopes.
 *
 * @param {unknown} body
 * @returns {Record<string, unknown>[]}
 */
export function extractMcpToolWireDescriptors(body) {
    if (Array.isArray(body)) {
        const byName = new Map();
        for (const message of body) {
            for (const descriptor of extractMcpToolWireDescriptors(message)) {
                byName.set(String(descriptor['name']), descriptor);
            }
        }
        return [...byName.values()];
    }
    if (!body || typeof body !== 'object') return [];
    if (!('result' in body) || !body.result || typeof body.result !== 'object') return [];
    if (!('tools' in body.result) || !Array.isArray(body.result.tools)) return [];
    return body.result.tools.filter((tool) => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return false;
        return 'name' in tool && typeof tool.name === 'string' && tool.name.length > 0;
    });
}

/**
 * Build a bounded parity projection suitable for connector-smoke diagnostics.
 *
 * @param {readonly unknown[]} remoteDescriptors
 * @param {Readonly<Record<string, string>>} localToolFingerprints
 */
export function buildMcpToolWireParityProjection(remoteDescriptors, localToolFingerprints) {
    if (Object.keys(localToolFingerprints).length === 0) {
        return Object.freeze({
            required: false,
            available: false,
            matches: null,
            fingerprintKind: null,
            comparedToolCount: 0,
            matchingToolCount: 0,
            missingRemoteTools: Object.freeze([]),
            unexpectedRemoteTools: Object.freeze([]),
            mismatchedTools: Object.freeze([]),
        });
    }
    try {
        const comparison = compareMcpToolWireFingerprintIndexes(
            localToolFingerprints,
            buildMcpToolWireFingerprintIndex(remoteDescriptors),
        );
        return Object.freeze({
            required: true,
            available: remoteDescriptors.length > 0,
            fingerprintKind: MCP_TOOL_DESCRIPTOR_FINGERPRINT_KIND,
            ...comparison,
        });
    } catch (error) {
        return Object.freeze({
            required: true,
            available: false,
            matches: false,
            fingerprintKind: MCP_TOOL_DESCRIPTOR_FINGERPRINT_KIND,
            comparedToolCount: 0,
            matchingToolCount: 0,
            missingRemoteTools: Object.freeze([]),
            unexpectedRemoteTools: Object.freeze([]),
            mismatchedTools: Object.freeze([]),
            error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        });
    }
}

/** @param {string[]} values */
export function previewMcpToolNames(values) {
    return values.length <= 20
        ? values
        : [...values.slice(0, 10), `...${values.length - 20} omitted...`, ...values.slice(-10)];
}

/** @param {unknown} value */
function sha256StableJson(value) {
    return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}

/** @param {unknown} value @returns {string} */
function stableJsonStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(/** @type {Record<string, unknown>} */ (value))
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}
