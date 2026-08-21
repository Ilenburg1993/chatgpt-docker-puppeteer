// @ts-check

import { bootstrapApplicationInfraSqliteProvider, getApplicationInfraRuntime } from '#copilot/boot/application-infra';
import { closeCopilotDb } from '#copilot/db';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const previousDbPath = process.env['COPILOT_DB_PATH'];
/** @type {string | undefined} */
let tempDir;

function resetApplicationDbBinding() {
    getApplicationInfraRuntime().database.reset();
    closeCopilotDb();
}

afterEach(async () => {
    resetApplicationDbBinding();
    if (previousDbPath === undefined) delete process.env['COPILOT_DB_PATH'];
    else process.env['COPILOT_DB_PATH'] = previousDbPath;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
});

describe('application infra SQLite bootstrap', () => {
    it('coalesces concurrent bootstrap and can bind again after an explicit reset', async () => {
        resetApplicationDbBinding();
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'copilot-application-infra-db-'));
        process.env['COPILOT_DB_PATH'] = path.join(tempDir, 'copilot.sqlite');

        const results = await Promise.all(Array.from({ length: 12 }, () => bootstrapApplicationInfraSqliteProvider()));
        const firstRevision = results[0]?.revision ?? -1;

        expect(results).toHaveLength(12);
        expect(results.every((result) => result.configured)).toBe(true);
        expect(new Set(results.map((result) => result.revision))).toEqual(new Set([firstRevision]));
        expect(getApplicationInfraRuntime().database.status()).toEqual({ configured: true, revision: firstRevision });
        expect(getApplicationInfraRuntime().database.get().prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });

        resetApplicationDbBinding();
        const rebound = await bootstrapApplicationInfraSqliteProvider();
        expect(rebound.configured).toBe(true);
        expect(rebound.revision).toBeGreaterThan(firstRevision);
        expect(getApplicationInfraRuntime().database.get().open).toBe(true);
    });
});
