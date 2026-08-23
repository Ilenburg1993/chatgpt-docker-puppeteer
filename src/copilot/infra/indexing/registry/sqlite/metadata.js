// @ts-check
/**
 * Metadata projection policy for persistent index rows.
 *
 * @module copilot/infra/indexing/registry/sqlite/metadata
 */

import { BABEL_PARSER_POLICY_VERSION } from '#copilot/infra/internal/code-analysis';
import { utf8ByteLength } from '#copilot/infra/internal/platform/buffer';
import { extname } from 'node:path';
import { SYMBOL_EXTENSIONS } from './content.js';

/** @param {{ schemaVersion: number }} context */
export function createIoIndexMetadataPolicy({ schemaVersion }) {
    /**
     * @param {Record<string, unknown> | undefined} metadata
     * @param {number} [maxBytes=4096]
     * @param {Record<string, unknown>} [criticalMetadata]
     */
    function safeMetaJson(metadata, maxBytes = 4096, criticalMetadata = {}) {
        try {
            const json = JSON.stringify(metadata ?? {});
            if (typeof json !== 'string') return JSON.stringify({ ...criticalMetadata, _error: 'non-serializable' });
            if (utf8ByteLength(json, 'index metadata') <= maxBytes) return json;
            return JSON.stringify({ ...criticalMetadata, _truncated: true, _maxBytes: maxBytes });
        } catch {
            return JSON.stringify({ ...criticalMetadata, _error: 'non-serializable' });
        }
    }

    /** @param {string} filePath @param {string | null | undefined} metadataJson */
    function parserProjectionIsCurrent(filePath, metadataJson) {
        if (!SYMBOL_EXTENSIONS.has(extname(filePath).toLowerCase())) return true;
        if (typeof metadataJson !== 'string' || metadataJson.length === 0) return false;
        try {
            const metadata = /** @type {{ parserPolicyVersion?: unknown }} */ (JSON.parse(metadataJson));
            return metadata.parserPolicyVersion === BABEL_PARSER_POLICY_VERSION;
        } catch {
            return false;
        }
    }

    /**
     * @param {string} filePath
     * @param {Record<string, unknown> | undefined} metadata
     * @param {Record<string, unknown>} fingerprint
     */
    function buildIndexMetadataJson(filePath, metadata, fingerprint) {
        const critical = {
            indexVersion: schemaVersion,
            ...(SYMBOL_EXTENSIONS.has(extname(filePath).toLowerCase())
                ? { parserPolicyVersion: BABEL_PARSER_POLICY_VERSION }
                : {}),
            fingerprint,
        };
        return safeMetaJson({ ...(metadata ?? {}), ...critical }, 4096, critical);
    }

    return Object.freeze({ buildIndexMetadataJson, parserProjectionIsCurrent });
}
