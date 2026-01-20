#!/usr/bin/env node
/**
 * Code Graph Analyzer using TypeScript Language Server
 *
 * Generates dependency graphs, call graphs, and architectural insights
 * using TypeScript's Program API for accurate JavaScript analysis.
 *
 * Usage:
 *   node scripts/analyze-code-graph.js [options]
 *
 * Options:
 *   --deps          Show dependency graph
 *   --circular      Find circular dependencies
 *   --nerv          Map NERV event flows
 *   --orphans       Find orphaned modules
 *   --stats         Show architecture statistics
 *   --export-json   Export results to analysis/code-graph.json
 *   --export-dot    Export Graphviz DOT format
 */

const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JSCONFIG = path.join(ROOT, 'jsconfig.json');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    showDeps: args.includes('--deps'),
    findCircular: args.includes('--circular'),
    mapNerv: args.includes('--nerv'),
    findOrphans: args.includes('--orphans'),
    showStats: args.includes('--stats') || args.length === 0,
    exportJson: args.includes('--export-json'),
    exportDot: args.includes('--export-dot')
};

// Read jsconfig.json
const configFile = ts.readConfigFile(JSCONFIG, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

console.log('🔍 TypeScript Language Server Analysis\n');
console.log(`📁 Root: ${ROOT}`);
console.log(`📝 Config: ${JSCONFIG}`);
console.log(`📦 Files: ${parsedConfig.fileNames.length}\n`);

// Create TypeScript program
const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const typeChecker = program.getTypeChecker();

// Data structures for analysis
const dependencyGraph = new Map(); // file -> [dependencies]
const reverseGraph = new Map(); // file -> [dependents]
const nervEvents = { emitters: {}, listeners: {} };
const moduleStats = {
    total: 0,
    byDirectory: {},
    topImporters: [],
    topImported: []
};

/**
 * Normalize file path relative to root
 */
function normalizePath(filePath) {
    return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

/**
 * Get module category (nerv, kernel, driver, etc.)
 */
function getModuleCategory(filePath) {
    const normalized = normalizePath(filePath);
    if (normalized.startsWith('src/nerv/')) {
        return 'NERV';
    }
    if (normalized.startsWith('src/kernel/')) {
        return 'KERNEL';
    }
    if (normalized.startsWith('src/driver/')) {
        return 'DRIVER';
    }
    if (normalized.startsWith('src/server/')) {
        return 'SERVER';
    }
    if (normalized.startsWith('src/infra/')) {
        return 'INFRA';
    }
    if (normalized.startsWith('src/core/')) {
        return 'CORE';
    }
    if (normalized.startsWith('tests/')) {
        return 'TESTS';
    }
    if (normalized.startsWith('scripts/')) {
        return 'SCRIPTS';
    }
    return 'OTHER';
}

/**
 * Extract dependencies from a source file
 */
function extractDependencies(sourceFile) {
    const filePath = normalizePath(sourceFile.fileName);
    const deps = [];

    function visit(node) {
        // require() calls
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.Identifier &&
            node.expression.text === 'require' &&
            node.arguments.length > 0
        ) {
            const arg = node.arguments[0];
            if (ts.isStringLiteral(arg)) {
                deps.push(arg.text);
            }
        }

        // import statements (if any ES6 imports)
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            deps.push(node.moduleSpecifier.text);
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return deps;
}

/**
 * Extract NERV event emissions and listeners
 */
function extractNervEvents(sourceFile) {
    const filePath = normalizePath(sourceFile.fileName);
    const events = { emits: [], listens: [] };

    function visit(node) {
        // nerv.emit('EVENT_NAME', ...)
        if (ts.isCallExpression(node)) {
            const expr = node.expression;
            if (
                ts.isPropertyAccessExpression(expr) &&
                expr.name.text === 'emit' &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                events.emits.push(node.arguments[0].text);
            }

            // nerv.on('EVENT_NAME', ...)
            if (
                ts.isPropertyAccessExpression(expr) &&
                expr.name.text === 'on' &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                events.listens.push(node.arguments[0].text);
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return events;
}

/**
 * Build dependency graph
 */
function buildDependencyGraph() {
    program.getSourceFiles().forEach(sourceFile => {
        if (sourceFile.fileName.includes('node_modules')) {
            return;
        }

        const filePath = normalizePath(sourceFile.fileName);
        const deps = extractDependencies(sourceFile);

        dependencyGraph.set(filePath, deps);
        moduleStats.total++;

        const category = getModuleCategory(sourceFile.fileName);
        moduleStats.byDirectory[category] = (moduleStats.byDirectory[category] || 0) + 1;

        // Build reverse graph
        deps.forEach(dep => {
            if (!reverseGraph.has(dep)) {
                reverseGraph.set(dep, []);
            }
            reverseGraph.get(dep).push(filePath);
        });

        // Extract NERV events
        if (options.mapNerv) {
            const events = extractNervEvents(sourceFile);
            events.emits.forEach(evt => {
                if (!nervEvents.emitters[evt]) {
                    nervEvents.emitters[evt] = [];
                }
                nervEvents.emitters[evt].push(filePath);
            });
            events.listens.forEach(evt => {
                if (!nervEvents.listeners[evt]) {
                    nervEvents.listeners[evt] = [];
                }
                nervEvents.listeners[evt].push(filePath);
            });
        }
    });
}

/**
 * Find circular dependencies
 */
function findCircularDependencies() {
    const visited = new Set();
    const stack = new Set();
    const cycles = [];

    function dfs(node, path = []) {
        if (stack.has(node)) {
            const cycleStart = path.indexOf(node);
            cycles.push([...path.slice(cycleStart), node]);
            return;
        }

        if (visited.has(node)) {
            return;
        }

        visited.add(node);
        stack.add(node);
        path.push(node);

        const deps = dependencyGraph.get(node) || [];
        deps.forEach(dep => {
            // Resolve relative paths
            const resolvedDep = resolveImport(node, dep);
            if (resolvedDep) {
                dfs(resolvedDep, [...path]);
            }
        });

        stack.delete(node);
    }

    dependencyGraph.forEach((_, file) => dfs(file));
    return cycles;
}

/**
 * Resolve import path
 */
function resolveImport(fromFile, importPath) {
    if (importPath.startsWith('.')) {
        const dir = path.dirname(fromFile);
        const resolved = path.resolve(ROOT, dir, importPath);
        const withExt = resolved.endsWith('.js') ? resolved : `${resolved}.js`;
        return normalizePath(withExt);
    }
    return null;
}

/**
 * Find orphaned modules
 */
function findOrphans() {
    const orphans = [];
    dependencyGraph.forEach((deps, file) => {
        const dependents = reverseGraph.get(file) || [];
        if (dependents.length === 0 && !file.startsWith('src/main.js') && !file.startsWith('tests/')) {
            orphans.push(file);
        }
    });
    return orphans;
}

/**
 * Calculate statistics
 */
function calculateStats() {
    // Top importers (most dependencies)
    const importers = Array.from(dependencyGraph.entries())
        .map(([file, deps]) => ({ file, count: deps.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Top imported (most dependents)
    const imported = Array.from(reverseGraph.entries())
        .map(([file, deps]) => ({ file, count: deps.length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    return { importers, imported };
}

// ===== MAIN ANALYSIS =====

buildDependencyGraph();

// Show statistics
if (options.showStats) {
    console.log('📊 Architecture Statistics\n');
    console.log(`Total modules: ${moduleStats.total}`);
    console.log('\nModules by category:');
    Object.entries(moduleStats.byDirectory)
        .sort((a, b) => b[1] - a[1])
        .forEach(([cat, count]) => {
            console.log(`  ${cat.padEnd(10)} ${count}`);
        });

    const stats = calculateStats();

    console.log('\n🔝 Top 10 Importers (most dependencies):');
    stats.importers.forEach(({ file, count }, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${file} (${count} deps)`);
    });

    console.log('\n🎯 Top 10 Imported (most dependents):');
    stats.imported.forEach(({ file, count }, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. ${file} (${count} refs)`);
    });
}

// Find circular dependencies
if (options.findCircular) {
    console.log('\n🔄 Circular Dependencies\n');
    const cycles = findCircularDependencies();
    if (cycles.length === 0) {
        console.log('✅ No circular dependencies found!');
    } else {
        console.log(`⚠️  Found ${cycles.length} circular dependencies:\n`);
        cycles.forEach((cycle, i) => {
            console.log(`${i + 1}. ${cycle.join(' → ')}`);
        });
    }
}

// Find orphans
if (options.findOrphans) {
    console.log('\n🏝️  Orphaned Modules\n');
    const orphans = findOrphans();
    if (orphans.length === 0) {
        console.log('✅ No orphaned modules found!');
    } else {
        console.log(`Found ${orphans.length} orphaned modules:\n`);
        orphans.forEach(file => console.log(`  - ${file}`));
    }
}

// Map NERV events
if (options.mapNerv) {
    console.log('\n📡 NERV Event Flow Map\n');
    const allEvents = new Set([...Object.keys(nervEvents.emitters), ...Object.keys(nervEvents.listeners)]);

    if (allEvents.size === 0) {
        console.log('ℹ️  No NERV events detected (requires .emit() and .on() calls)');
    } else {
        allEvents.forEach(event => {
            const emitters = nervEvents.emitters[event] || [];
            const listeners = nervEvents.listeners[event] || [];

            console.log(`Event: ${event}`);
            if (emitters.length > 0) {
                console.log(`  📤 Emitters: ${emitters.join(', ')}`);
            }
            if (listeners.length > 0) {
                console.log(`  📥 Listeners: ${listeners.join(', ')}`);
            }
            console.log('');
        });
    }
}

// Export results
if (options.exportJson) {
    const outputPath = path.join(ROOT, 'analysis', 'code-graph.json');
    const output = {
        timestamp: new Date().toISOString(),
        stats: moduleStats,
        dependencies: Object.fromEntries(dependencyGraph),
        reverseDependencies: Object.fromEntries(reverseGraph),
        nervEvents,
        circular: options.findCircular ? findCircularDependencies() : [],
        orphans: options.findOrphans ? findOrphans() : []
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Exported to: ${outputPath}`);
}

// Export DOT format for Graphviz
if (options.exportDot) {
    const outputPath = path.join(ROOT, 'analysis', 'dependency-graph.dot');
    let dot = 'digraph Dependencies {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box, style=rounded];\n\n';

    dependencyGraph.forEach((deps, file) => {
        const color = getModuleCategory(path.join(ROOT, file));
        const colorMap = {
            NERV: 'lightblue',
            KERNEL: 'lightgreen',
            DRIVER: 'lightyellow',
            SERVER: 'lightpink',
            INFRA: 'lightgray',
            CORE: 'orange'
        };

        deps.forEach(dep => {
            const resolvedDep = resolveImport(file, dep);
            if (resolvedDep) {
                dot += `  "${file}" -> "${resolvedDep}";\n`;
            }
        });
    });

    dot += '}\n';

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, dot);
    console.log(`\n📊 Exported Graphviz DOT to: ${outputPath}`);
    console.log('   Generate image: dot -Tsvg analysis/dependency-graph.dot -o analysis/graph.svg');
}

console.log('\n✅ Analysis complete!\n');
