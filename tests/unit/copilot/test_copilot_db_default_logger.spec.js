// @ts-check

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('copilot/db/sqlite default logger', () => {
    it('não imprime INFO no console antes da injeção do logger central', () => {
        const dir = mkdtempSync(join(tmpdir(), 'copilot-db-default-logger-'));
        const dbPath = join(dir, 'copilot.sqlite');
        const script = `
            const mod = await import('./src/copilot/db/sqlite.js');
            mod.getCopilotDb();
            mod.closeCopilotDb();
        `;

        const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: { ...process.env, COPILOT_DB_PATH: dbPath, NO_COLOR: '1' },
            maxBuffer: 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10_000,
        });

        expect(output).toBe('');
    });
});
