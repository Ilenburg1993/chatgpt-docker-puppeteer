// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneAuditRuns } from '../../../scripts/audit/lib/retention.mjs';

test('pruneAuditRuns keeps max runs and preserves current run', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-retention-'));
    const runsRoot = path.join(base, 'runs');
    fs.mkdirSync(runsRoot, { recursive: true });

    const ids = ['run-a', 'run-b', 'run-c', 'run-d'];
    ids.forEach((id, index) => {
        const dir = path.join(runsRoot, id);
        fs.mkdirSync(dir, { recursive: true });
        const when = Date.now() - (10000 - index * 1000);
        fs.utimesSync(dir, new Date(when), new Date(when));
    });

    const result = pruneAuditRuns({
        runsRoot,
        maxRuns: 2,
        keepRunId: 'run-a',
    });

    assert.ok(result.pruned.length >= 1);
    assert.equal(fs.existsSync(path.join(runsRoot, 'run-a')), true);
    assert.ok(fs.existsSync(path.join(runsRoot, 'run-c')) || fs.existsSync(path.join(runsRoot, 'run-d')));
});
