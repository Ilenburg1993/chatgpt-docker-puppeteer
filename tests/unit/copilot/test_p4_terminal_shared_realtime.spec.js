// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

describe('P4 — superfícies compartilhadas de realtime', () => {
    it('server/routes/sse.js não depende mais de terminal/dialog/sse.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/sse.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/realtime.js'));
        assert.ok(!src.includes('../../terminal/dialog/sse.js'));
    });

    it('server/middleware/rate-limiter-state.js não depende mais de terminal/rate-limiter-state.js', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/server/middleware/rate-limiter-state.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes('../../presentation/realtime.js'));
        assert.ok(!src.includes('../../terminal/rate-limiter-state.js'));
    });

    it('terminal/dialog/sse.js consome CRITICAL_EVENTS da camada shared', async () => {
        const src = await readFile(new URL('../../../src/copilot/terminal/dialog/sse.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/realtime.js'));
        assert.ok(!src.includes("new Set(['dialog.stalled', 'fatal', 'system'])"));
    });

    it('terminal/rate-limiter-state.js virou adapter fino da camada shared', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/state/rate-limiter-state.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes('../presentation/realtime.js'));
        assert.ok(!src.includes('let _clearFn'));
    });
});
