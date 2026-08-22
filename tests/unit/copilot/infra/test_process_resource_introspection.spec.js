// @ts-check

import { readProcessResourceSnapshot } from '#copilot/infra/public/platform/process/introspection';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
    parseCgroupMemoryEvents,
    parseCgroupMemoryLimit,
} from '../../../../src/copilot/infra/platform/process/introspection/resources.js';

describe('platform/process resource introspection', () => {
    it('parses bounded cgroup v2 memory evidence with a fixed key surface', () => {
        assert.deepEqual(
            parseCgroupMemoryEvents('low 1\nhigh 2\nmax 3\noom 4\noom_kill 5\noom_group_kill 6\nunknown 99\n'),
            {
                low: 1,
                high: 2,
                max: 3,
                oom: 4,
                oom_kill: 5,
                oom_group_kill: 6,
            },
        );
        assert.equal(parseCgroupMemoryLimit('max\n'), null);
        assert.equal(parseCgroupMemoryLimit('1073741824\n'), 1_073_741_824);
        assert.equal(parseCgroupMemoryLimit('not-a-number'), null);
    });

    it('captures portable process/system metrics and fail-soft cgroup evidence without subprocesses', async () => {
        const snapshot = await readProcessResourceSnapshot();
        assert.match(snapshot.observedAt, /^\d{4}-\d{2}-\d{2}T/u);
        assert.ok(snapshot.processRssBytes > 0);
        assert.ok(snapshot.systemTotalBytes > 0);
        assert.ok(snapshot.systemFreeBytes >= 0);
        assert.ok(snapshot.availableParallelism >= 1);
        assert.equal(snapshot.loadAverage.length, 3);
        assert.ok(snapshot.cgroup.memoryCurrentBytes === null || snapshot.cgroup.memoryCurrentBytes >= 0);
        assert.ok(snapshot.cgroup.memoryMaxBytes === null || snapshot.cgroup.memoryMaxBytes >= 0);
        assert.ok(snapshot.cgroup.events === null || Object.isFrozen(snapshot.cgroup.events));
        assert.equal(Object.isFrozen(snapshot), true);
        assert.equal(Object.isFrozen(snapshot.cgroup), true);
    });
});
