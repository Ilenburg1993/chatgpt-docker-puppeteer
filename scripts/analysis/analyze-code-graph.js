#!/usr/bin/env node
// @ts-check
/**
 * CLI canônica de análise do grafo de dependências.
 *
 * O grafo é construído por `dependency-graph.mjs` via Babel + resolvedor Node; não depende da API AST do TypeScript.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildDependencyGraph } from './dependency-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);

/** @param {string} name @param {string} fallback */
function valueAfter(name, fallback) {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

const options = {
    scope: valueAfter('--root', 'src'),
    findCircular: args.includes('--circular'),
    mapNerv: args.includes('--nerv'),
    findOrphans: args.includes('--orphans'),
    showStats: args.includes('--stats') || args.length === 0,
    exportJson: args.includes('--export-json'),
    exportDot: args.includes('--export-dot'),
    jsonStdout: args.includes('--json-stdout'),
};

const report = buildDependencyGraph(options.scope, { workspaceRoot: ROOT });
const edgeCount = Object.values(report.graph).reduce((total, dependencies) => total + dependencies.length, 0);
const topLevelCounts = new Map();
for (const file of report.files) {
    const top = file.split('/')[0] || '(root)';
    topLevelCounts.set(top, (topLevelCounts.get(top) ?? 0) + 1);
}

const rank = (/** @type {Record<string, string[]>} */ graph) =>
    Object.entries(graph)
        .map(([file, dependencies]) => ({ file, count: dependencies.length }))
        .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
        .slice(0, 15);

const payload = {
    schemaVersion: 2,
    scopeRoot: report.scopeRoot,
    files: report.files.length,
    edges: edgeCount,
    cycles: report.cycles,
    orphans: report.orphans,
    parseErrors: report.parseErrors,
    unresolvedLocalImports: report.unresolvedLocalImports,
    topFanOut: rank(report.graph),
    topFanIn: rank(report.reverseGraph),
    nervEvents: report.nervEvents,
};

if (options.jsonStdout) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
} else {
    console.log('Dependency graph analysis');
    console.log(`root=${report.scopeRoot} files=${report.files.length} edges=${edgeCount}`);

    if (options.showStats) {
        console.log('\nModules by top-level directory:');
        for (const [name, count] of [...topLevelCounts.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`  ${name.padEnd(24)} ${count}`);
        }
        console.log('\nTop fan-out:');
        for (const row of payload.topFanOut.slice(0, 10))
            console.log(`  ${row.count.toString().padStart(3)}  ${row.file}`);
        console.log('\nTop fan-in:');
        for (const row of payload.topFanIn.slice(0, 10))
            console.log(`  ${row.count.toString().padStart(3)}  ${row.file}`);
    }

    if (options.findCircular) {
        console.log('\nCircular dependency components:');
        if (report.cycles.length === 0) console.log('  none');
        for (const [index, cycle] of report.cycles.entries()) console.log(`  ${index + 1}. ${cycle.join(' <-> ')}`);
    }

    if (options.findOrphans) {
        console.log(`\nOrphan candidates (${report.orphans.length}):`);
        for (const file of report.orphans) console.log(`  - ${file}`);
    }

    if (options.mapNerv) {
        const events = new Set([
            ...Object.keys(report.nervEvents.emitters),
            ...Object.keys(report.nervEvents.listeners),
        ]);
        console.log(`\nNERV events (${events.size}):`);
        for (const event of [...events].sort()) {
            console.log(`  ${event}`);
            if (report.nervEvents.emitters[event]?.length)
                console.log(`    emit: ${report.nervEvents.emitters[event].join(', ')}`);
            if (report.nervEvents.listeners[event]?.length)
                console.log(`    on:   ${report.nervEvents.listeners[event].join(', ')}`);
        }
    }

    if (report.unresolvedLocalImports.length > 0) {
        console.warn(`\nwarning: ${report.unresolvedLocalImports.length} local imports could not be resolved`);
    }
    if (report.parseErrors.length > 0) {
        console.error(`\nparse errors (${report.parseErrors.length}):`);
        for (const error of report.parseErrors.slice(0, 30)) console.error(`  ${error.file}: ${error.message}`);
    }
}

if (options.exportJson) {
    const output = path.join(ROOT, 'analysis', 'code-graph.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(
        output,
        `${JSON.stringify({ ...payload, dependencies: report.graph, reverseDependencies: report.reverseGraph }, null, 2)}\n`,
    );
    if (!options.jsonStdout) console.log(`\nJSON: ${path.relative(ROOT, output)}`);
}

if (options.exportDot) {
    const output = path.join(ROOT, 'analysis', 'dependency-graph.dot');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const lines = ['digraph Dependencies {', '  rankdir=LR;', '  node [shape=box, style=rounded];'];
    for (const [file, dependencies] of Object.entries(report.graph)) {
        if (dependencies.length === 0) lines.push(`  ${JSON.stringify(file)};`);
        for (const dependency of dependencies)
            lines.push(`  ${JSON.stringify(file)} -> ${JSON.stringify(dependency)};`);
    }
    lines.push('}');
    fs.writeFileSync(output, `${lines.join('\n')}\n`);
    if (!options.jsonStdout) console.log(`DOT: ${path.relative(ROOT, output)}`);
}

if (report.parseErrors.length > 0 || report.unresolvedLocalImports.length > 0) process.exitCode = 2;
else if (options.findCircular && report.cycles.length > 0) process.exitCode = 1;
