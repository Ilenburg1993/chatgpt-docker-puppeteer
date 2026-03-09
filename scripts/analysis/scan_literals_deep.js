#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

console.log('🚀 Iniciando Scan Profundo de Magic Strings\n');
console.log(`Root: ${ROOT}`);
console.log(`Src: ${SRC}\n`);

// ============================================
// ANÁLISE COMPLETA DE ARQUIVOS
// ============================================

/** @param {string} dir */
function getAllJsFiles(dir) {
    /** @type {string[]} */
    const files = [];
    /** @param {string} d */
    function walk(d) {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        entries.forEach((entry) => {
            const fullPath = path.join(d, entry.name);
            // Skip dist/build artifacts when recursing
            if (
                entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                entry.name !== 'node_modules' &&
                entry.name !== 'dist'
            ) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                files.push(fullPath);
            }
        });
    }
    walk(dir);
    return files;
}

const files = getAllJsFiles(SRC);
console.log(`📁 Analisando ${files.length} arquivos...\n`);

// ============================================
// CATEGORIAS DE ANÁLISE
// ============================================

const analysis = {
    // Task management
    taskStates: { values: new Map(), contexts: [] },
    taskPriorities: { values: new Map(), contexts: [] },

    // NERV events
    emitEvents: { values: new Map(), contexts: [] },
    onEvents: { values: new Map(), contexts: [] },

    // States & Status
    stateAssignments: { values: new Map(), contexts: [] },
    statusValues: { values: new Map(), contexts: [] },

    // Connection & Browser
    connectionModes: { values: new Map(), contexts: [] },
    browserStates: { values: new Map(), contexts: [] },

    // Logging
    logLevels: { values: new Map(), contexts: [] },
    logCategories: { values: new Map(), contexts: [] },

    // Errors
    errorTypes: { values: new Map(), contexts: [] },
    failureTypes: { values: new Map(), contexts: [] },

    // Driver
    driverTypes: { values: new Map(), contexts: [] },
    targetNames: { values: new Map(), contexts: [] },

    // Comparisons
    equalityComparisons: { values: new Map(), contexts: [] },

    // Switch cases
    switchCases: { values: new Map(), contexts: [] },
};

// ============================================
// PATTERNS DE ANÁLISE
// ============================================

const patterns = {
    // Task states: state = 'VALUE', state === 'VALUE', task.state
    taskState: /(?:state|taskState|currentState)\s*(?:===|!==|=)\s*['"]([A-Z_]+)['"]/g,

    // NERV emit
    emit: /\.emit\(['"]([A-Z_][A-Z_0-9]*)['"]/g,

    // NERV on/once
    on: /\.(?:on|once)\(['"]([A-Z_][A-Z_0-9]*)['"]/g,

    // State assignments: this.state = 'VALUE'
    stateAssign: /(?:this|self)\.state\s*=\s*['"]([A-Z_]+)['"]/g,

    // Status: status: 'VALUE', status === 'VALUE'
    status: /status\s*(?::|===|!==|=)\s*['"]([A-Z_]+)['"]/g,

    // Connection mode: mode: 'value', mode === 'value'
    mode: /mode\s*(?::|===|!==|=)\s*['"]([a-z]+)['"]/g,

    // Logger: logger.log('LEVEL', ...)
    loggerCall: /logger\.log\(['"]([A-Z]+)['"]/g,

    // Log category: [CATEGORY]
    logCategory: /\[([A-Z][A-Z_0-9]*)\]/g,

    // Error type: type: 'ERROR_TYPE'
    errorType: /(?:type|errorType|failureType)\s*:\s*['"]([A-Z_]+)['"]/g,

    // Driver/target: driver: 'name', target: 'name'
    driver: /(?:driver|target)\s*:\s*['"]([a-z]+)['"]/g,

    // Equality comparisons (uppercase literals)
    equality: /(?:===|!==)\s*['"]([A-Z_]+)['"]/g,

    // Switch case (uppercase literals)
    switchCase: /case\s+['"]([A-Z_]+)['"]/g,

    // Object property values (type, kind, action, etc.)
    objectProp: /(\w+)\s*:\s*['"]([A-Z_]+|[a-z_]+)['"]/g,
};

// ============================================
// PROCESSAMENTO
// ============================================

files.forEach((file) => {
    const relativePath = path.relative(ROOT, file);
    let content = '';
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch (_error) {
        console.error(`Erro ao processar ${file}:`, /** @type {any} */ (_error).message);
        return;
    }
    const _lines = content.split('\n');

    // Task states
    let match;
    while ((match = patterns.taskState.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.taskStates.values.has(value)) {
            analysis.taskStates.values.set(value, []);
        }
        analysis.taskStates.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Emit events
    patterns.emit.lastIndex = 0;
    while ((match = patterns.emit.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.emitEvents.values.has(value)) {
            analysis.emitEvents.values.set(value, []);
        }
        analysis.emitEvents.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // On events
    patterns.on.lastIndex = 0;
    while ((match = patterns.on.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.onEvents.values.has(value)) {
            analysis.onEvents.values.set(value, []);
        }
        analysis.onEvents.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // State assignments
    patterns.stateAssign.lastIndex = 0;
    while ((match = patterns.stateAssign.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.stateAssignments.values.has(value)) {
            analysis.stateAssignments.values.set(value, []);
        }
        analysis.stateAssignments.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Status values
    patterns.status.lastIndex = 0;
    while ((match = patterns.status.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.statusValues.values.has(value)) {
            analysis.statusValues.values.set(value, []);
        }
        analysis.statusValues.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Connection modes
    patterns.mode.lastIndex = 0;
    while ((match = patterns.mode.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.connectionModes.values.has(value)) {
            analysis.connectionModes.values.set(value, []);
        }
        analysis.connectionModes.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Logger calls
    patterns.loggerCall.lastIndex = 0;
    while ((match = patterns.loggerCall.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.logLevels.values.has(value)) {
            analysis.logLevels.values.set(value, []);
        }
        analysis.logLevels.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Log categories
    patterns.logCategory.lastIndex = 0;
    while ((match = patterns.logCategory.exec(content)) !== null) {
        const value = match[1] ?? '';
        if (value.length > 3 && !value.match(/^(INFO|WARN|ERROR|DEBUG)$/)) {
            const lineNum = content.substring(0, match.index).split('\n').length;
            if (!analysis.logCategories.values.has(value)) {
                analysis.logCategories.values.set(value, []);
            }
            analysis.logCategories.values.get(value).push({ file: relativePath, line: lineNum });
        }
    }

    // Error types
    patterns.errorType.lastIndex = 0;
    while ((match = patterns.errorType.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.errorTypes.values.has(value)) {
            analysis.errorTypes.values.set(value, []);
        }
        analysis.errorTypes.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Drivers/targets
    patterns.driver.lastIndex = 0;
    while ((match = patterns.driver.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.driverTypes.values.has(value)) {
            analysis.driverTypes.values.set(value, []);
        }
        analysis.driverTypes.values.get(value).push({ file: relativePath, line: lineNum });
    }

    // Switch cases
    patterns.switchCase.lastIndex = 0;
    while ((match = patterns.switchCase.exec(content)) !== null) {
        const value = match[1];
        const lineNum = content.substring(0, match.index).split('\n').length;
        if (!analysis.switchCases.values.has(value)) {
            analysis.switchCases.values.set(value, []);
        }
        analysis.switchCases.values.get(value).push({ file: relativePath, line: lineNum });
    }
});

// ============================================
// RELATÓRIO
// ============================================

console.log('📊 RELATÓRIO DETALHADO\n');
console.log('='.repeat(100));

/** @param {any} title @param {any} data */
function printCategory(title, data, minOccurrences = 1) {
    const entries = Array.from(data.values.entries())
        .filter(([_, locs]) => locs.length >= minOccurrences)
        .sort((a, b) => b[1].length - a[1].length);

    if (entries.length === 0) {
        return;
    }

    console.log(`\n📦 ${title} (${entries.length} valores únicos):\n`);

    entries.forEach(([value, locations]) => {
        console.log(`   ${value.padEnd(30)} → ${locations.length} uso(s)`);
        if (locations.length <= 3) {
            locations.forEach(
                /** @param {any} loc */ (loc) => {
                    console.log(`      ${loc.file}:${loc.line}`);
                },
            );
        } else {
            console.log(`      ${locations[0].file}:${locations[0].line}`);
            console.log(`      ... e mais ${locations.length - 1} arquivo(s)`);
        }
    });
}

printCategory('TASK STATES', analysis.taskStates);
printCategory('NERV EMIT EVENTS', analysis.emitEvents, 2);
printCategory('NERV ON EVENTS', analysis.onEvents, 2);
printCategory('STATE ASSIGNMENTS', analysis.stateAssignments);
printCategory('STATUS VALUES', analysis.statusValues, 2);
printCategory('CONNECTION MODES', analysis.connectionModes);
printCategory('LOG LEVELS', analysis.logLevels);
printCategory('LOG CATEGORIES', analysis.logCategories, 2);
printCategory('ERROR TYPES', analysis.errorTypes);
printCategory('DRIVER/TARGET TYPES', analysis.driverTypes);
printCategory('SWITCH CASE VALUES', analysis.switchCases, 2);

// ============================================
// RECOMENDAÇÕES
// ============================================

console.log('\n\n💡 RECOMENDAÇÕES DE CONSTANTES:\n');
console.log('='.repeat(100));

const recommendations = [];

if (analysis.taskStates.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/tasks.js',
        exports: ['TASK_STATES'],
        values: Array.from(analysis.taskStates.values.keys()),
    });
}

const allNervEvents = new Set([...analysis.emitEvents.values.keys(), ...analysis.onEvents.values.keys()]);
if (allNervEvents.size > 0) {
    recommendations.push({
        file: 'src/core/constants/nerv.js',
        exports: ['NERV_EVENTS'],
        values: Array.from(allNervEvents),
    });
}

if (analysis.connectionModes.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/browser.js',
        exports: ['CONNECTION_MODES'],
        values: Array.from(analysis.connectionModes.values.keys()),
    });
}

if (analysis.stateAssignments.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/browser.js',
        exports: ['BROWSER_STATES'],
        values: Array.from(analysis.stateAssignments.values.keys()),
    });
}

if (analysis.logLevels.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/logging.js',
        exports: ['LOG_LEVELS'],
        values: Array.from(analysis.logLevels.values.keys()),
    });
}

if (analysis.logCategories.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/logging.js',
        exports: ['LOG_CATEGORIES'],
        values: Array.from(analysis.logCategories.values.keys()),
    });
}

if (analysis.errorTypes.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/errors.js',
        exports: ['ERROR_TYPES'],
        values: Array.from(analysis.errorTypes.values.keys()),
    });
}

if (analysis.driverTypes.values.size > 0) {
    recommendations.push({
        file: 'src/core/constants/drivers.js',
        exports: ['DRIVER_TYPES'],
        values: Array.from(analysis.driverTypes.values.keys()),
    });
}

recommendations.forEach((rec, i) => {
    console.log(`\n${i + 1}. ${rec.file}`);
    console.log(`   Exports: ${rec.exports.join(', ')}`);
    console.log(`   Valores (${rec.values.length}):`);
    rec.values.sort().forEach((v) => console.log(`      - ${v}`));
});

console.log(`\n${'='.repeat(100)}`);
console.log('\n✅ Scan profundo concluído.\n');
console.log(`📈 Estatísticas:`);
console.log(`   - ${files.length} arquivos analisados`);
console.log(`   - ${recommendations.length} arquivos de constantes recomendados`);
console.log(`   - ${recommendations.reduce((sum, r) => sum + r.values.length, 0)} constantes totais identificadas`);
console.log('');
