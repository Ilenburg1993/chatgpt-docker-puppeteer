#!/usr/bin/env node
/**
 * Scan híbrido: Grep + AST para identificar magic strings candidatos a constantes
 * Fase 1: Grep patterns (rápido, wide net)
 * Fase 2: AST analysis (preciso, validação)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const TESTS = path.join(ROOT, 'tests');

// ============================================
// FASE 1: GREP PATTERNS (Quick Scan)
// ============================================

const GREP_PATTERNS = [
    // Task states
    { pattern: 'state\\s*[=!]=\\s*[\'"]([A-Z_]+)[\'"]', category: 'TASK_STATES' },
    { pattern: 'setState\\([\'"]([A-Z_]+)[\'"]\\)', category: 'TASK_STATES' },

    // NERV events
    { pattern: '\\.emit\\([\'"]([A-Z_]+)[\'"]', category: 'NERV_EVENTS' },
    { pattern: '\\.on\\([\'"]([A-Z_]+)[\'"]', category: 'NERV_EVENTS' },

    // Connection modes
    { pattern: 'mode:\\s*[\'"]([a-z]+)[\'"]', category: 'CONNECTION_MODES' },
    { pattern: 'mode\\s*[=!]=\\s*[\'"]([a-z]+)[\'"]', category: 'CONNECTION_MODES' },

    // Driver types
    { pattern: 'driver:\\s*[\'"]([a-z]+)[\'"]', category: 'DRIVER_TYPES' },
    { pattern: 'target:\\s*[\'"]([a-z]+)[\'"]', category: 'DRIVER_TYPES' },

    // Log levels
    { pattern: 'logger\\.log\\([\'"]([A-Z]+)[\'"]', category: 'LOG_LEVELS' },
    { pattern: 'level:\\s*[\'"]([A-Z]+)[\'"]', category: 'LOG_LEVELS' },

    // Browser states
    { pattern: 'this\\.state\\s*=\\s*[\'"]([A-Z_]+)[\'"]', category: 'BROWSER_STATES' }
];

function grepScan() {
    console.log('🔍 FASE 1: Grep Pattern Scan\n');
    const results = {};

    GREP_PATTERNS.forEach(({ pattern, category }) => {
        try {
            const cmd = `grep -rn -E "${pattern}" ${SRC} ${TESTS} --include="*.js" 2>/dev/null || true`;
            const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

            if (output.trim()) {
                const matches = output.trim().split('\n');
                if (!results[category]) {
                    results[category] = new Set();
                }

                matches.forEach(match => {
                    const regex = new RegExp(pattern);
                    const found = match.match(regex);
                    if (found && found[1]) {
                        results[category].add(found[1]);
                    }
                });
            }
        } catch (error) {
            // Grep não encontrou nada (exit code 1) - ok
        }
    });

    // Convert Sets to Arrays
    Object.keys(results).forEach(key => {
        results[key] = Array.from(results[key]).sort();
    });

    return results;
}

// ============================================
// FASE 2: AST ANALYSIS (Deep Scan)
// ============================================

function astScan() {
    console.log('\n🔬 FASE 2: AST Deep Analysis\n');

    // Buscar todos arquivos .js em src/
    const files = [];
    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        entries.forEach(entry => {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                files.push(fullPath);
            }
        });
    }
    walk(SRC);

    const literalsByContext = {
        objectProperties: new Map(), // { mode: 'launcher' }
        comparisons: new Map(), // state === 'RUNNING'
        emitCalls: new Map(), // emit('EVENT')
        logCalls: new Map() // logger.log('INFO')
    };

    console.log(`Analisando ${files.length} arquivos...\n`);

    // Análise simplificada via regex (AST parser seria esprima/acorn)
    files.forEach(file => {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const relativePath = path.relative(ROOT, file);

            // Object property: mode: 'value'
            const propMatches = content.matchAll(/(\w+):\s*['"]([^'"]+)['"]/g);
            for (const match of propMatches) {
                const key = match[1];
                const value = match[2];
                if (!literalsByContext.objectProperties.has(key)) {
                    literalsByContext.objectProperties.set(key, new Set());
                }
                literalsByContext.objectProperties.get(key).add(value);
            }

            // Comparisons: === 'value'
            const compMatches = content.matchAll(/[=!]=\s*['"]([A-Z_]+)['"]/g);
            for (const match of compMatches) {
                const value = match[1];
                if (!literalsByContext.comparisons.has(value)) {
                    literalsByContext.comparisons.set(value, []);
                }
                literalsByContext.comparisons.get(value).push(relativePath);
            }

            // Emit calls: .emit('EVENT')
            const emitMatches = content.matchAll(/\.emit\(['"]([A-Z_]+)['"]/g);
            for (const match of emitMatches) {
                const event = match[1];
                if (!literalsByContext.emitCalls.has(event)) {
                    literalsByContext.emitCalls.set(event, []);
                }
                literalsByContext.emitCalls.get(event).push(relativePath);
            }

            // Log calls: logger.log('LEVEL')
            const logMatches = content.matchAll(/logger\.log\(['"]([A-Z]+)['"]/g);
            for (const match of logMatches) {
                const level = match[1];
                if (!literalsByContext.logCalls.has(level)) {
                    literalsByContext.logCalls.set(level, []);
                }
                literalsByContext.logCalls.get(level).push(relativePath);
            }
        } catch (error) {
            console.error(`Erro ao processar ${file}:`, error.message);
        }
    });

    return literalsByContext;
}

// ============================================
// MERGE & REPORT
// ============================================

function generateReport(grepResults, astResults) {
    console.log('\n📊 RELATÓRIO CONSOLIDADO\n');
    console.log('='.repeat(80));

    // GREP Results
    console.log('\n🔍 FASE 1 - Grep Scan Results:\n');
    Object.entries(grepResults).forEach(([category, values]) => {
        if (values.length > 0) {
            console.log(`\n📦 ${category} (${values.length} valores):`);
            values.forEach(v => console.log(`   - ${v}`));
        }
    });

    // AST Results
    console.log('\n\n🔬 FASE 2 - AST Analysis:\n');

    console.log('\n📝 Object Properties (key: values):');
    const topProps = Array.from(astResults.objectProperties.entries())
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 20);
    topProps.forEach(([key, values]) => {
        const vals = Array.from(values).slice(0, 5);
        console.log(`   ${key}: [${vals.join(', ')}] (${values.size} total)`);
    });

    console.log('\n⚖️  Comparisons (valores mais usados):');
    const topComps = Array.from(astResults.comparisons.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 10);
    topComps.forEach(([value, files]) => {
        console.log(`   "${value}" - usado em ${files.length} arquivo(s)`);
    });

    console.log('\n📡 Emit Events:');
    const events = Array.from(astResults.emitCalls.keys()).sort();
    events.forEach(event => {
        const count = astResults.emitCalls.get(event).length;
        console.log(`   ${event} - ${count} emissão(ões)`);
    });

    console.log('\n📋 Log Levels:');
    const levels = Array.from(astResults.logCalls.keys()).sort();
    levels.forEach(level => {
        const count = astResults.logCalls.get(level).length;
        console.log(`   ${level} - ${count} uso(s)`);
    });

    // Recommendations
    console.log('\n\n💡 RECOMENDAÇÕES:\n');

    const recommendations = [];

    if (grepResults.TASK_STATES?.length > 0) {
        recommendations.push({
            file: 'src/core/constants/tasks.js',
            enum: 'TASK_STATES',
            values: grepResults.TASK_STATES
        });
    }

    if (astResults.emitCalls.size > 0) {
        recommendations.push({
            file: 'src/core/constants/nerv.js',
            enum: 'NERV_EVENTS',
            values: Array.from(astResults.emitCalls.keys())
        });
    }

    if (astResults.logCalls.size > 0) {
        recommendations.push({
            file: 'src/core/constants/logging.js',
            enum: 'LOG_LEVELS',
            values: Array.from(astResults.logCalls.keys())
        });
    }

    // Check for 'mode' property
    if (astResults.objectProperties.has('mode')) {
        const modes = Array.from(astResults.objectProperties.get('mode'));
        recommendations.push({
            file: 'src/core/constants/browser.js',
            enum: 'CONNECTION_MODES',
            values: modes
        });
    }

    recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. Criar ${rec.file}`);
        console.log(`   Enum: ${rec.enum}`);
        console.log(`   Valores: ${rec.values.join(', ')}`);
        console.log('');
    });

    console.log('='.repeat(80));
    console.log('\n✅ Scan completo. Próximo passo: revisar e implementar constantes.\n');
}

// ============================================
// MAIN
// ============================================

function main() {
    console.log('🚀 Iniciando Scan Híbrido de Magic Strings\n');
    console.log(`Root: ${ROOT}`);
    console.log(`Src: ${SRC}`);
    console.log('');

    const grepResults = grepScan();
    const astResults = astScan();
    generateReport(grepResults, astResults);
}

main();
