// @ts-check

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('P4 — superfícies compartilhadas de sessions/memory/hub-health', () => {
    it('server/routes/sessions.js não depende mais de terminal/handlers/dialog.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/sessions.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/conversation-hub.js'));
        assert.ok(!src.includes('../../terminal/handlers/dialog.js'));
    });

    it('server/routes/memory.js não depende mais de terminal/handlers/dialog.js', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/memory.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/conversation-hub.js'));
        assert.ok(!src.includes('../../terminal/handlers/dialog.js'));
    });

    it('server/routes/health.js não depende mais de terminal/handlers/dialog.js para hub health', async () => {
        const src = await readFile(new URL('../../../src/copilot/server/routes/health.js', import.meta.url), 'utf8');

        assert.ok(src.includes('../../presentation/conversation-hub.js'));
        assert.ok(!src.includes('../../terminal/handlers/dialog.js'));
    });

    it('terminal/handlers/dialog.js virou adapter fino sobre presentation/conversation-hub.js', async () => {
        const src = await readFile(
            new URL('../../../src/copilot/terminal/handlers/dialog.js', import.meta.url),
            'utf8',
        );

        assert.ok(src.includes('../../presentation/conversation-hub.js'));
        assert.ok(!src.includes('container.resolve'));
        assert.ok(!src.includes('countHubSessions'));
    });
});
