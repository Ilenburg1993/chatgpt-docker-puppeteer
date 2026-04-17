// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('P4 — superfícies compartilhadas de health/config', () => {
    it('server/routes/health.js não depende mais de terminal/handlers/system-config.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/health.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/system-config.js'));
        assert.ok(!src.includes('../../terminal/handlers/system-config.js'));
    });

    it('server/routes/config.js não depende mais de terminal/handlers/system-config.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/config.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/system-config.js'));
        assert.ok(!src.includes('../../terminal/handlers/system-config.js'));
    });

    it('terminal/handlers/system-config.js virou adapter fino sobre presentation/system-config.js', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/handlers/system-config.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes('../../presentation/system-config.js'));
        assert.ok(!src.includes('getMcpStatus'));
        assert.ok(!src.includes('registerCustomTool'));
    });
});
