// @ts-check

import { describe, expect, it } from 'vitest';
import { buildCopilotPackageImportGovernanceReport } from '../../../../scripts/ci/check-copilot-package-imports.mjs';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/u, '');

describe('Copilot package-import governance', () => {
    it('mantém exactness, audiences, manifests e targets físicos convergentes', () => {
        const report = buildCopilotPackageImportGovernanceReport({ repoRoot: ROOT });
        expect(report.violations).toEqual({
            brokenAliases: [],
            wildcardAliases: [],
            nonExactUsages: [],
            parseErrors: [],
            forbiddenTestingUsages: [],
            unusedTestingAliases: [],
            staleAliases: [],
            missingSdkAliases: [],
            undeclaredSdkAliases: [],
            missingSdkExports: [],
            undeclaredSdkExports: [],
            sdkExportTargetMismatches: [],
        });
        expect(report.success).toBe(true);
        expect(report.scannedFiles).toBeGreaterThan(3_000);
        expect(report.usageCount).toBeGreaterThan(3_000);
        expect(report.testingAliasCount).toBeGreaterThan(0);
    });
});
