// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildCopilotDependencyGraphGovernanceReport } from '../../../scripts/ci/check-copilot-dependency-graph.mjs';

describe('Copilot source dependency graph governance', () => {
    it('não possui ciclos, imports locais não resolvidos nem parse errors', () => {
        const report = buildCopilotDependencyGraphGovernanceReport({ scope: 'src' });
        assert.equal(report.success, true, JSON.stringify(report.violations, null, 2));
        assert.deepEqual(report.violations, {
            parseErrors: [],
            unresolvedLocalImports: [],
            cycles: [],
        });
        assert.ok(report.files > 2_000);
        assert.ok(report.edges > 5_000);
    });
});
