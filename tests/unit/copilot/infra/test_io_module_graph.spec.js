// @ts-check

import {
    buildIndexedModuleGraph,
    computeModuleChangeImpact,
    findModuleGraphCycles,
    findModuleGraphPath,
    graphRelativePath,
    summarizeModuleGraph,
    traverseModuleGraph,
} from '#copilot/infra/public/indexing/graph';
import { createLocalModuleResolver } from '#copilot/infra/public/indexing/module-resolution';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';

describe('indexed module graph', () => {
    it('builds local edges once and supports cycles, paths, reverse closures and summary facts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'copilot-module-graph-'));
        try {
            await mkdir(join(root, 'src'), { recursive: true });
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({ type: 'module', imports: { '#app/c': './src/c.js' } }),
                'utf8',
            );
            const [a, b, c, d] = ['a.js', 'b.js', 'c.js', 'd.js'].map((name) => join(root, 'src', name));
            const fileRows = [a, b, c, d].map((filePath) => ({ filePath }));
            const importRows = [
                { filePath: a, relativePath: 'src/a.js', source: './b.js', isDynamic: 0, line: 1 },
                { filePath: b, relativePath: 'src/b.js', source: '#app/c', isDynamic: 0, line: 2 },
                { filePath: c, relativePath: 'src/c.js', source: './a.js', isDynamic: 1, line: 3 },
                { filePath: d, relativePath: 'src/d.js', source: './b.js', isDynamic: 0, line: 4 },
                { filePath: d, relativePath: 'src/d.js', source: 'zod', isDynamic: 0, line: 5 },
                { filePath: d, relativePath: 'src/d.js', source: './missing.js', isDynamic: 0, line: 6 },
            ];
            const moduleResolver = await createLocalModuleResolver({ workspaceRoot: root });
            const graph = buildIndexedModuleGraph({
                workspaceRoot: root,
                scopeRoot: join(root, 'src'),
                fileRows,
                importRows,
                moduleResolver,
            });

            assert.equal(graph.nodes.length, 4);
            assert.equal(graph.externalImportCount, 1);
            assert.equal(graph.unresolvedLocal.length, 1);
            assert.equal(graph.dynamicEdgeCount, 1);
            assert.equal((graph.outgoing.get(a) ?? []).length, 1);
            assert.equal((graph.incoming.get(b) ?? []).length, 2);
            assert.equal(graphRelativePath(graph, c), 'src/c.js');

            const dependencies = traverseModuleGraph(graph, d, 'dependencies', { maxDepth: 3 });
            assert.deepEqual(
                dependencies.map((row) => [graphRelativePath(graph, row.path), row.distance]),
                [
                    ['src/b.js', 1],
                    ['src/c.js', 2],
                    ['src/a.js', 3],
                ],
            );

            const dependents = traverseModuleGraph(graph, b, 'dependents', { maxDepth: 3 });
            assert.deepEqual(
                dependents.map((row) => [graphRelativePath(graph, row.path), row.distance]),
                [
                    ['src/a.js', 1],
                    ['src/d.js', 1],
                    ['src/c.js', 2],
                ],
            );

            const cycles = findModuleGraphCycles(graph);
            assert.equal(cycles.length, 1);
            assert.deepEqual(cycles[0]?.map((path) => graphRelativePath(graph, path)), [
                'src/a.js',
                'src/b.js',
                'src/c.js',
            ]);

            const path = findModuleGraphPath(graph, d, a, { maxDepth: 4 });
            assert.deepEqual(path?.map((item) => graphRelativePath(graph, item)), [
                'src/d.js',
                'src/b.js',
                'src/c.js',
                'src/a.js',
            ]);

            const impact = computeModuleChangeImpact(graph, [b], { maxDepth: 3 });
            assert.deepEqual(
                impact.map((row) => [graphRelativePath(graph, row.path), row.distance]),
                [
                    ['src/a.js', 1],
                    ['src/d.js', 1],
                    ['src/c.js', 2],
                ],
            );

            const summary = summarizeModuleGraph(graph);
            assert.deepEqual(
                {
                    nodeCount: summary.nodeCount,
                    edgeCount: summary.edgeCount,
                    cycleComponentCount: summary.cycleComponentCount,
                    cyclicNodeCount: summary.cyclicNodeCount,
                },
                { nodeCount: 4, edgeCount: 4, cycleComponentCount: 1, cyclicNodeCount: 3 },
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
