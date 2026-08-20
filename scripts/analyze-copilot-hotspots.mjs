#!/usr/bin/env node
// @ts-check
/**
 * scripts/analyze-copilot-hotspots.mjs
 *
 * Gera mapa de hotspots de dependências para `src/copilot` (ou subtree), com foco em:
 *
 * - fan-out (quantas dependências um arquivo abre)
 * - fan-in (quantos arquivos dependem dele)
 * - pressão cross-module (arestas que atravessam módulos de topo)
 *
 * Uso: node scripts/analyze-copilot-hotspots.mjs node scripts/analyze-copilot-hotspots.mjs --root src/copilot --focus
 * agent --top 30 node scripts/analyze-copilot-hotspots.mjs --json-out /tmp/hotspots.json
 *
 * @module scripts/analyze-copilot-hotspots
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { buildDependencyGraph } from './analysis/dependency-graph.mjs';

/**
 * @typedef {{
 *     file: string;
 *     module: string;
 *     fanOut: number;
 *     fanIn: number;
 *     crossModuleOut: number;
 *     crossModuleIn: number;
 *     score: number;
 * }} HotspotRow
 */

/**
 * @typedef {{
 *     scannedRoot: string;
 *     focusModule: string;
 *     files: number;
 *     edges: number;
 *     modules: number;
 *     topByScore: HotspotRow[];
 *     topByFanOut: HotspotRow[];
 *     topByFanIn: HotspotRow[];
 *     topByCrossModulePressure: HotspotRow[];
 * }} HotspotReport
 */

const DEFAULT_ROOT = 'src/copilot';
const DEFAULT_FOCUS = 'agent';
const DEFAULT_TOP = 25;

/**
 * @param {string} filePath
 * @returns {string}
 */
function moduleOf(filePath) {
    const normalized = filePath.replace(/^\.\//, '');
    const [top] = normalized.split('/');
    return top || '(root-files)';
}

/**
 * @param {Record<string, string[]>} graph
 * @returns {Map<string, number>}
 */
function buildFanInMap(graph) {
    /** @type {Map<string, number>} */
    const fanInMap = new Map();
    for (const file of Object.keys(graph)) {
        fanInMap.set(file, fanInMap.get(file) ?? 0);
    }

    for (const deps of Object.values(graph)) {
        for (const dep of deps) {
            fanInMap.set(dep, (fanInMap.get(dep) ?? 0) + 1);
        }
    }

    return fanInMap;
}

/**
 * @param {Record<string, string[]>} graph
 * @returns {Map<string, number>}
 */
function buildCrossModuleInMap(graph) {
    /** @type {Map<string, number>} */
    const crossIn = new Map();
    for (const file of Object.keys(graph)) {
        crossIn.set(file, 0);
    }

    for (const [from, deps] of Object.entries(graph)) {
        const fromModule = moduleOf(from);
        for (const dep of deps) {
            const toModule = moduleOf(dep);
            if (fromModule !== toModule) {
                crossIn.set(dep, (crossIn.get(dep) ?? 0) + 1);
            }
        }
    }

    return crossIn;
}

/**
 * @param {HotspotRow[]} rows
 * @param {number} top
 * @returns {HotspotRow[]}
 */
function topRows(rows, top) {
    return [...rows].sort((a, b) => b.score - a.score || b.fanOut - a.fanOut || b.fanIn - a.fanIn).slice(0, top);
}

/**
 * @param {HotspotRow[]} rows
 * @param {number} top
 * @returns {HotspotRow[]}
 */
function topByFanOut(rows, top) {
    return [...rows]
        .sort((a, b) => b.fanOut - a.fanOut || b.crossModuleOut - a.crossModuleOut || b.fanIn - a.fanIn)
        .slice(0, top);
}

/**
 * @param {HotspotRow[]} rows
 * @param {number} top
 * @returns {HotspotRow[]}
 */
function topByFanIn(rows, top) {
    return [...rows]
        .sort((a, b) => b.fanIn - a.fanIn || b.crossModuleIn - a.crossModuleIn || b.fanOut - a.fanOut)
        .slice(0, top);
}

/**
 * @param {HotspotRow[]} rows
 * @param {number} top
 * @returns {HotspotRow[]}
 */
function topByCross(rows, top) {
    return [...rows]
        .sort(
            (a, b) =>
                b.crossModuleOut + b.crossModuleIn - (a.crossModuleOut + a.crossModuleIn) ||
                b.score - a.score ||
                b.fanOut - a.fanOut,
        )
        .slice(0, top);
}

/**
 * @param {string[]} args
 * @returns {{ root: string; focus: string; top: number; jsonOut: string | null }}
 */
function parseArgs(args) {
    let root = DEFAULT_ROOT;
    let focus = DEFAULT_FOCUS;
    let top = DEFAULT_TOP;
    let jsonOut = null;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--root') {
            root = args[i + 1] ?? root;
            i += 1;
            continue;
        }
        if (arg === '--focus') {
            focus = args[i + 1] ?? focus;
            i += 1;
            continue;
        }
        if (arg === '--top') {
            const parsed = Number(args[i + 1]);
            if (Number.isFinite(parsed) && parsed > 0) {
                top = Math.trunc(parsed);
            }
            i += 1;
            continue;
        }
        if (arg === '--json-out') {
            jsonOut = args[i + 1] ?? null;
            i += 1;
        }
    }

    return { root, focus, top, jsonOut };
}

/**
 * @param {string} root
 * @param {string} focusModule
 * @param {number} top
 * @returns {Promise<HotspotReport>}
 */
async function analyzeHotspots(root, focusModule, top) {
    const dependencyReport = buildDependencyGraph(root);
    if (dependencyReport.parseErrors.length > 0) {
        const first = dependencyReport.parseErrors[0];
        throw new Error(
            `Dependency graph parse failed (${dependencyReport.parseErrors.length} errors): ${first?.file ?? '?'}: ${first?.message ?? 'unknown'}`,
        );
    }
    const graph = dependencyReport.graph;
    const fanInMap = buildFanInMap(graph);
    const crossModuleInMap = buildCrossModuleInMap(graph);

    const files = Object.keys(graph);
    const edges = files.reduce((acc, file) => acc + (graph[file]?.length ?? 0), 0);
    const modules = new Set(files.map((file) => moduleOf(file))).size;

    /** @type {HotspotRow[]} */
    const rows = [];

    for (const file of files) {
        const deps = graph[file] ?? [];
        const fileModule = moduleOf(file);
        const crossModuleOut = deps.filter((dep) => moduleOf(dep) !== fileModule).length;
        const fanOut = deps.length;
        const fanIn = fanInMap.get(file) ?? 0;
        const crossModuleIn = crossModuleInMap.get(file) ?? 0;

        // Score simples e interpretável para ranking arquitetural.
        const score = fanOut * 2 + fanIn * 2 + crossModuleOut * 3 + crossModuleIn * 3;

        rows.push({
            file,
            module: fileModule,
            fanOut,
            fanIn,
            crossModuleOut,
            crossModuleIn,
            score,
        });
    }

    const scoped = rows.filter((row) => row.module === focusModule);

    return {
        scannedRoot: root,
        focusModule,
        files: files.length,
        edges,
        modules,
        topByScore: topRows(scoped, top),
        topByFanOut: topByFanOut(scoped, top),
        topByFanIn: topByFanIn(scoped, top),
        topByCrossModulePressure: topByCross(scoped, top),
    };
}

/**
 * @param {HotspotReport} report
 */
function printHumanReport(report) {
    console.log('Copilot hotspot analysis');
    console.log(`root=${report.scannedRoot} focus=${report.focusModule}`);
    console.log(`files=${report.files} edges=${report.edges} modules=${report.modules}`);

    /**
     * @param {string} title
     * @param {HotspotRow[]} rows
     */
    const printRows = (title, rows) => {
        console.log(`\n${title}`);
        if (rows.length === 0) {
            console.log('- (sem linhas para exibir)');
            return;
        }

        for (const row of rows) {
            const pressure = row.crossModuleOut + row.crossModuleIn;
            console.log(`- ${row.file} | score=${row.score} fanOut=${row.fanOut} fanIn=${row.fanIn} cross=${pressure}`);
        }
    };

    printRows('Top score', report.topByScore);
    printRows('Top fan-out', report.topByFanOut);
    printRows('Top fan-in', report.topByFanIn);
    printRows('Top cross-module pressure', report.topByCrossModulePressure);
}

/**
 * @returns {Promise<void>}
 */
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const report = await analyzeHotspots(options.root, options.focus, options.top);
    printHumanReport(report);

    if (options.jsonOut) {
        writeFileSync(options.jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`\njson written: ${options.jsonOut}`);
    }
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
    await main();
}

export { analyzeHotspots };
