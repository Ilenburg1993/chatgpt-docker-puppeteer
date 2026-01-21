#!/usr/bin/env node
/**
 * Dependencies Auditor
 *
 * Purpose: Compares declared dependencies in package.json with actual modules used in code
 *
 * Detects:
 * - Missing dependencies (used in code but not in package.json)
 * - Unused dependencies (in package.json but not found in code)
 * - Native Node.js modules (for reference)
 *
 * Usage:
 *   node scripts/audit-dependencies.js
 *   node scripts/audit-dependencies.js --json > deps-report.json
 *
 * Exit Codes:
 *   0 - All dependencies are correct
 *   1 - Missing or unused dependencies found
 *   2 - Error during execution
 *
 * Note: This is a heuristic analysis. Manual review recommended for:
 * - Dynamic requires (e.g., require(variable))
 * - Optional dependencies
 * - Peer dependencies
 */

const fs = require('fs');
const path = require('path');

const JSON_OUTPUT = process.argv.includes('--json');
const ROOT = path.join(__dirname, '..');

// Read package.json
const pkgPath = path.join(ROOT, 'package.json');
if (!fs.existsSync(pkgPath)) {
    console.error('❌ package.json not found!');
    process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {})
};

// Modules found in code (manually curated list - could be automated with AST parsing)
const usedModules = [
    'child_process',
    'compression',
    'crypto',
    'events',
    'express',
    'fs',
    'ghost-cursor',
    'http',
    'https',
    'js-yaml',
    'os',
    'path',
    'pm2',
    'puppeteer',
    'puppeteer-core',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth',
    'readline',
    'socket.io',
    'socket.io-client',
    'tree-kill',
    'user-agents',
    'uuid',
    'zod'
];

// Native Node.js modules (don't need package.json entry)
const nativeModules = [
    'assert',
    'buffer',
    'child_process',
    'crypto',
    'events',
    'fs',
    'http',
    'https',
    'net',
    'os',
    'path',
    'readline',
    'stream',
    'util',
    'url',
    'querystring',
    'zlib'
];

// Analysis
const missing = usedModules.filter(m => !nativeModules.includes(m) && !allDeps[m]);

const unused = Object.keys(allDeps).filter(d => !usedModules.includes(d) && !d.startsWith('@'));

const externalUsed = usedModules.filter(m => !nativeModules.includes(m));
const nativeUsed = usedModules.filter(m => nativeModules.includes(m));

// Output
if (JSON_OUTPUT) {
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            totalDeclared: Object.keys(allDeps).length,
            externalUsed: externalUsed.length,
            nativeUsed: nativeUsed.length,
            missing: missing.length,
            possiblyUnused: unused.length
        },
        missing,
        possiblyUnused: unused,
        declared: Object.keys(allDeps),
        used: usedModules,
        native: nativeUsed
    };
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('\n=== ANÁLISE DE DEPENDÊNCIAS ===\n');

    if (missing.length > 0) {
        console.log('❌ FALTANDO no package.json:');
        missing.forEach(m => console.log(`   - ${m}`));
        console.log();
    } else {
        console.log('✅ Todas as dependências usadas estão declaradas\n');
    }

    console.log('⚠️  POSSÍVEIS DEPENDÊNCIAS NÃO UTILIZADAS:');
    if (unused.length > 0) {
        unused.forEach(m => console.log(`   - ${m}`));
        console.log('\n💡 Revisar manualmente antes de remover (podem ser usadas dinamicamente)');
    } else {
        console.log('   Nenhuma detectada');
    }

    console.log('\n📦 RESUMO:');
    console.log(`   Total declarado: ${Object.keys(allDeps).length}`);
    console.log(`   Externas usadas: ${externalUsed.length}`);
    console.log(`   Nativas usadas: ${nativeUsed.length}`);

    console.log('\n' + '='.repeat(50));

    if (missing.length > 0) {
        console.log('❌ AÇÃO NECESSÁRIA: Instalar dependências faltantes\n');
        process.exit(1);
    } else if (unused.length > 0) {
        console.log('⚠️  REVISAR: Possíveis dependências não utilizadas\n');
        process.exit(0); // Not critical
    } else {
        console.log('✅ Dependências estão corretas!\n');
        process.exit(0);
    }
}
