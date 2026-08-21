#!/usr/bin/env node
// @ts-check

import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { buildIndexPathTreeRange, createIoIndexSqlite } from '#copilot/infra/public/diagnostic/indexing/storage';

/**
 * @param {string} name
 * @param {number} fallback
 * @param {number} maximum
 */
function positiveOption(name, fallback, maximum) {
    const prefix = `${name}=`;
    const inline = process.argv.find((argument) => argument.startsWith(prefix));
    const index = process.argv.indexOf(name);
    const raw = inline ? inline.slice(prefix.length) : index >= 0 ? process.argv[index + 1] : undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/**
 * @param {number} value
 */
function rounded(value) {
    return Number(value.toFixed(3));
}

/**
 * @param {() => unknown} operation
 */
function measureSync(operation) {
    const startedAt = performance.now();
    const value = operation();
    return { value, durationMs: performance.now() - startedAt };
}

/**
 * @param {() => Promise<unknown>} operation
 */
async function measureAsync(operation) {
    const startedAt = performance.now();
    const value = await operation();
    return { value, durationMs: performance.now() - startedAt };
}

async function main() {
    const fileCount = positiveOption('--files', 500, 5_000);
    const searchIterations = positiveOption('--search-iterations', 100, 5_000);
    const linesPerFile = positiveOption('--lines', 40, 1_000);
    const groupCount = Math.max(2, Math.min(20, Math.ceil(fileCount / 50)));
    const tmpRoot = path.resolve('tmp');
    await mkdir(tmpRoot, { recursive: true });
    const workspace = await mkdtemp(path.join(tmpRoot, '.io-index-workload-'));
    const db = new Database(':memory:');

    try {
        const writes = [];
        for (let index = 0; index < fileCount; index += 1) {
            const group = `group-${index % groupCount}`;
            const directory = path.join(workspace, group);
            await mkdir(directory, { recursive: true });
            const content = Array.from(
                { length: linesPerFile },
                (_, line) => `benchmark-token group-token-${index % groupCount} file-${index} line-${line + 1}`,
            ).join('\n');
            writes.push(writeFile(path.join(directory, `file-${index}.md`), content, 'utf8'));
        }
        await Promise.all(writes);

        const index = createIoIndexSqlite({ db });
        const initial = await measureAsync(() =>
            index.indexDirectory(workspace, {
                workspaceRoot: workspace,
                extensions: ['.md'],
                recursive: true,
                concurrency: 16,
                pruneMissing: true,
            }),
        );
        assert.equal(/** @type {{ indexed: number }} */ (initial.value).indexed, fileCount);

        const scopedPath = path.join(workspace, 'group-0');
        const search = measureSync(() => {
            let resultCount = 0;
            for (let iteration = 0; iteration < searchIterations; iteration += 1) {
                resultCount += index.search('benchmark-token', {
                    pathPrefix: scopedPath,
                    maxResults: 50,
                }).length;
            }
            return resultCount;
        });
        assert.ok(Number(search.value) > 0);

        const invalidate = measureSync(() => index.invalidatePath(scopedPath));
        assert.equal(invalidate.value, true);
        const filesAfterInvalidate = index.getStats().files;

        await index.indexDirectory(workspace, {
            workspaceRoot: workspace,
            extensions: ['.md'],
            recursive: true,
            concurrency: 16,
            pruneMissing: true,
        });

        const removedPath = path.join(workspace, 'group-1');
        await rm(removedPath, { recursive: true, force: true });
        const prune = await measureAsync(() =>
            index.indexDirectory(workspace, {
                workspaceRoot: workspace,
                extensions: ['.md'],
                recursive: true,
                concurrency: 16,
                pruneMissing: true,
            }),
        );
        assert.ok(/** @type {{ pruned: number }} */ (prune.value).pruned > 0);

        const range = buildIndexPathTreeRange(scopedPath);
        const queryPlan = db
            .prepare(
                `
                EXPLAIN QUERY PLAN
                SELECT id
                FROM copilot_io_index_chunks
                WHERE file_path = ? OR (file_path >= ? AND file_path < ?)
            `,
            )
            .all(range.exact, range.descendantStart, range.descendantEnd)
            .map((row) => String(/** @type {{ detail?: unknown }} */ (row).detail ?? ''));
        assert.ok(queryPlan.some((detail) => detail.includes('idx_io_index_chunks_file')));

        console.log(
            JSON.stringify(
                {
                    node: process.version,
                    files: fileCount,
                    groups: groupCount,
                    linesPerFile,
                    schemaVersion: index.getStats().schemaVersion,
                    initialBuildMs: rounded(initial.durationMs),
                    scopedSearch: {
                        iterations: searchIterations,
                        totalMs: rounded(search.durationMs),
                        averageMs: rounded(search.durationMs / searchIterations),
                        resultCount: search.value,
                    },
                    invalidate: {
                        durationMs: rounded(invalidate.durationMs),
                        filesAfter: filesAfterInvalidate,
                    },
                    prune: {
                        durationMs: rounded(prune.durationMs),
                        pruned: /** @type {{ pruned: number }} */ (prune.value).pruned,
                    },
                    queryPlan,
                },
                null,
                2,
            ),
        );
    } finally {
        db.close();
        await rm(workspace, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
});
