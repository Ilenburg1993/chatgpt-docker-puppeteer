// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    parseJsoncWithDuplicateKeys,
    validateNetworkSummaryContractsFile,
    validateNetworkSummaryContractsValue,
} from '../../../../src/copilot/mcp/scripts/network-summary-contracts.js';

describe('network summary contracts validator', () => {
    it('accepts the canonical catalog with active zero-dependency validation', async () => {
        const result = await validateNetworkSummaryContractsFile();
        assert.equal(result.ok, true, result.errors.join('\n'));
        assert.equal(result.summary?.status, 'canonical');
        assert.ok(Number(result.summary?.artifactCount) > 0);
        assert.ok(Number(result.summary?.formatCount) > 0);
        assert.equal(result.summary?.duplicateObjectKeyCount, 0);
        assert.equal(result.summary?.secretBearingKeyCount, 0);
    });

    it('parses JSONC comments and trailing commas without corrupting strings', () => {
        const parsed = parseJsoncWithDuplicateKeys(`{
            // comment
            "url": "https://example.com/a//b/*literal*/",
            "nested": { "ok": true, },
            /* block */
            "items": [1, 2, 3,],
        }`);
        assert.deepEqual(parsed.duplicateKeys, []);
        assert.deepEqual(parsed.value, {
            url: 'https://example.com/a//b/*literal*/',
            nested: { ok: true },
            items: [1, 2, 3],
        });
    });

    it('detects duplicate object keys before object materialization', () => {
        const parsed = parseJsoncWithDuplicateKeys('{ "a": 1, "a": 2, "nested": { "a": 3 } }');
        assert.equal(parsed.duplicateKeys.length, 1);
        assert.equal(parsed.duplicateKeys[0]?.key, 'a');
        assert.equal(parsed.duplicateKeys[0]?.path, '$');
        assert.deepEqual(parsed.value, { a: 2, nested: { a: 3 } });
    });

    it('rejects duplicate keys, unknown formats, duplicate requiredKeys and secret-bearing declared fields', async () => {
        const source = `{
            "schemaVersion": "1.0.0",
            "status": "canonical",
            "canonicalPath": ".devcontainer/scripts/network/contracts/summary-contracts.jsonc",
            "common": { "fileFormats": { "kv": {} } },
            "artifacts": {
                "x": {
                    "path": "/tmp/x",
                    "format": "missing",
                    "producer": ".devcontainer/scripts/post-start.sh",
                    "producerVersion": "v3.0.3",
                    "requiredKeys": ["status", "status", "api_key"]
                }
            },
            "validatorProfile": {
                "implementationStatus": "active",
                "recommendedCommand": "bad",
                "explainerCommand": "bad",
                "requiredChecks": ["a", "a"]
            },
            "status": "canonical"
        }`;
        const parsed = parseJsoncWithDuplicateKeys(source);
        const result = await validateNetworkSummaryContractsValue(parsed.value, { duplicateKeys: parsed.duplicateKeys });
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((error) => error.includes("Duplicate object key 'status'")));
        assert.ok(result.errors.some((error) => error.includes("unknown format 'missing'")));
        assert.ok(result.errors.some((error) => error.includes("duplicates requiredKey 'status'")));
        assert.ok(result.errors.some((error) => error.includes("secret-bearing key 'api_key'")));
        assert.ok(result.errors.some((error) => error.includes('recommendedCommand')));
    });
});
