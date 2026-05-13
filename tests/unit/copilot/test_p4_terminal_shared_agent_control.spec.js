// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'vitest';

describe('P4 — superfícies compartilhadas de agent-control', () => {
    it('server/routes/agent.js não depende mais de terminal/handlers/agent.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/agent.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/agent/index.js'));
        assert.ok(!src.includes('../../terminal/handlers/agent.js'));
    });

    it('terminal/handlers/agent.js virou adapter fino sobre presentation/agent/index.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/terminal/handlers/agent.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/agent/index.js'));
        assert.ok(!src.includes('const ALLOWED_FROM = new Set'));
        assert.ok(!src.includes('recordInjectHistory'));
    });

    it('presentation/agent/control/handlers.js não conhece mais terminal/* diretamente', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/presentation/agent/control/handlers.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes("'../../runtime/index.js'"));
        assert.ok(src.includes("'../../state/index.js'"));
        assert.ok(!src.includes("'../../terminal/"));
    });
});
