// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

describe('P4 — superfícies compartilhadas de agent/system-metrics', () => {
    it('server/routes/observability.js não depende mais de terminal/handlers/system-metrics.js', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/server/routes/observability.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes('../../presentation/system/index.js'));
        assert.ok(!src.includes('../../terminal/handlers/system-metrics.js'));
    });

    it('server/routes/git.js não depende mais de terminal/handlers/system-metrics.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/git.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/system/index.js'));
        assert.ok(!src.includes('../../terminal/handlers/system-metrics.js'));
    });

    it('server/routes/agent.js não depende mais de terminal/handlers/system-metrics.js para quota/pr-budget', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/agent.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/system/index.js'));
        assert.ok(!src.includes('../../terminal/handlers/system-metrics.js'));
    });

    it('terminal/handlers/system-metrics.js virou adapter fino sobre presentation/system/index.js', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/handlers/system-metrics.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes('../../presentation/system/index.js'));
        assert.ok(!src.includes('function handleMetrics'));
        assert.ok(!src.includes('function handleGetQuota'));
    });
});
