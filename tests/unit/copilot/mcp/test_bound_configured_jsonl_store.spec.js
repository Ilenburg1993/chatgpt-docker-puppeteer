// @ts-check

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoundConfiguredJsonlStore } from '../../../../src/copilot/mcp/control-plane/persistence/index.js';

/** @type {string[]} */
const roots = [];
afterEach(async () => {
    for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true });
});

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'bound-configured-jsonl-'));
    roots.push(root);
    const filePath = join(root, 'history.jsonl');
    const io = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'test.mcp.bound-jsonl',
            exactPaths: [filePath],
            operations: ['append', 'read', 'write'],
            durability: ['none'],
        }),
    );
    return {
        filePath,
        io,
        store: createBoundConfiguredJsonlStore({ filePath, io, maxReadBytes: 64 * 1024, durability: 'none' }),
    };
}

describe('bound configured JSONL store', () => {
    it('não perde appends concorrentes e faz trim dentro da mesma seção crítica', async () => {
        const { filePath, store } = await fixture();
        await Promise.all(Array.from({ length: 24 }, (_, index) => store.appendRecord({ index }, { maxEntries: 100 })));
        const all = await store.readTail({ maxLines: 100 });
        expect(all.invalidLines).toBe(0);
        expect(all.records).toHaveLength(24);
        expect(
            all.records
                .map((record) => /** @type {{index:number}} */ (record).index)
                .sort((left, right) => left - right),
        ).toEqual(Array.from({ length: 24 }, (_, index) => index));

        for (let index = 24; index < 30; index += 1) {
            await store.appendRecord({ index }, { maxEntries: 5 });
        }
        const retained = await store.readTail({ maxLines: 100 });
        expect(retained.records).toHaveLength(5);
        expect(retained.records.map((record) => /** @type {{index:number}} */ (record).index)).toEqual([
            25, 26, 27, 28, 29,
        ]);
        expect((await readFile(filePath, 'utf8')).trim().split('\n')).toHaveLength(5);
    });

    it('descarta fragmento inicial de tail bounded e conta linhas JSON inválidas sem abortar leitura', async () => {
        const { filePath, store } = await fixture();
        const prefix = `${JSON.stringify({ large: 'x'.repeat(400) })}\n`;
        await writeFile(filePath, `${prefix}not-json\n${JSON.stringify({ ok: true })}\n`, { mode: 0o600 });
        const tail = await store.readTail({ maxLines: 10, maxBytes: 128 });
        expect(tail.truncatedByByteLimit).toBe(true);
        expect(tail.invalidLines).toBe(1);
        expect(tail.records).toEqual([{ ok: true }]);
    });
});
