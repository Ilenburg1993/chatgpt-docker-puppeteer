// @ts-check

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
    analyzeConfiguredFsGrantSource,
    checkCopilotConfiguredFsGrants,
    configuredFsAuthorityShapeKey,
} from '../../../../scripts/ci/check-copilot-configured-fs-grants.mjs';

const CONFIGURED_ALIAS = '#copilot/infra/public/composition/filesystem/configured';

describe('ConfiguredFsGrant governance', () => {
    it('normalizes the complete static authority shape including kernel defaults', () => {
        const report = analyzeConfiguredFsGrantSource(
            `import { createConfiguredFsGrant, createConfiguredFsIo } from '${CONFIGURED_ALIAS}';\n` +
                `const GRANT_ID = 'unit.owner';\n` +
                `const grant = createConfiguredFsGrant({ id: GRANT_ID, exactPaths: ['/tmp/a'], operations: ['read'] });\n` +
                `export const io = createConfiguredFsIo(grant);\n`,
            'src/copilot/example/owner.js',
        );
        assert.ok(report);
        assert.deepEqual(report.issues, []);
        assert.deepEqual(report.grantIds, ['unit.owner']);
        assert.deepEqual(report.grants, [
            {
                id: 'unit.owner',
                pathMode: 'exact',
                operations: ['read'],
                symlinkPolicy: 'deny',
                durability: ['file-and-directory'],
            },
        ]);
        assert.equal(report.grantCalls, 1);
    });

    it('rejects dynamic grant identity because policy drift would become invisible', () => {
        const report = analyzeConfiguredFsGrantSource(
            `import { createConfiguredFsGrant } from '${CONFIGURED_ALIAS}';\n` +
                `export function mint(id) { return createConfiguredFsGrant({ id, exactPaths: ['/tmp/a'], operations: ['read'] }); }\n`,
            'src/copilot/example/dynamic-owner.js',
        );
        assert.ok(report);
        assert.ok(report.issues.some((issue) => issue.includes('configured-fs-grant-missing-static-id')));
    });

    it('rejects dynamic operation sets and unknown declaration fields fail-closed', () => {
        const report = analyzeConfiguredFsGrantSource(
            `import { createConfiguredFsGrant } from '${CONFIGURED_ALIAS}';\n` +
                `export function mint(operations) { return createConfiguredFsGrant({ id: 'unit.dynamic', roots: ['/tmp'], operations, filenamePattern: '*.json' }); }\n`,
            'src/copilot/example/dynamic-authority.js',
        );
        assert.ok(report);
        assert.ok(report.issues.some((issue) => issue.includes('configured-fs-grant-nonstatic-operations')));
        assert.ok(report.issues.some((issue) => issue.includes('configured-fs-grant-unknown-property')));
    });

    it('makes path-mode and operation widening observable even when the grant id is unchanged', () => {
        const narrow = analyzeConfiguredFsGrantSource(
            `import { createConfiguredFsGrant } from '${CONFIGURED_ALIAS}';\n` +
                `export const grant = createConfiguredFsGrant({ id: 'unit.owner', exactPaths: ['/tmp/a'], operations: ['read'] });\n`,
            'src/copilot/example/narrow-owner.js',
        );
        const widened = analyzeConfiguredFsGrantSource(
            `import { createConfiguredFsGrant } from '${CONFIGURED_ALIAS}';\n` +
                `export const grant = createConfiguredFsGrant({ id: 'unit.owner', roots: ['/tmp'], operations: ['read', 'write'] });\n`,
            'src/copilot/example/widened-owner.js',
        );
        assert.ok(narrow);
        assert.ok(widened);
        assert.deepEqual(narrow.issues, []);
        assert.deepEqual(widened.issues, []);
        assert.equal(narrow.grants[0]?.id, widened.grants[0]?.id);
        assert.notEqual(
            configuredFsAuthorityShapeKey(narrow.grants[0]),
            configuredFsAuthorityShapeKey(widened.grants[0]),
        );
    });

    it('covers the production repository exactly with the fail-closed owner-and-authority manifest', async () => {
        const report = await checkCopilotConfiguredFsGrants();
        assert.deepEqual(report.issues, [], `ConfiguredFsGrant governance drift:\n${report.issues.join('\n')}`);
        assert.equal(report.schemaVersion, 2);
        assert.equal(report.ok, true);
        assert.equal(report.importerCount, report.policyEntries);
        assert.ok(report.grantCount >= report.importerCount);
    });
});
