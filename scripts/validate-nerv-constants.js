// @ts-check
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');

// Import constants
const constantsPath = path.join(import.meta.dirname, '..', 'src', 'shared', 'nerv', 'constants.js');
const constants = await import(pathToFileURL(path.resolve(constantsPath)).href).then(m => m.default ?? m);

/**
 * Extracts ActionCodes from JavaScript files using grep
 * @returns {Promise<string[]>}
 */
async function extractUsedActionCodes() {
    const { execa } = await import('execa');
    try {
        const { stdout } = await execa('grep', ['-r', 'ActionCode\\.', 'src/', '--include=*.js']);
        const matches = stdout.split('\n').filter(line => line.trim());
        const codes = new Set();
        for (const line of matches) {
            // Match ActionCode.SOMETHING, handling line breaks
            const fullLine = line.replace(/\s+/g, '');
            const match = fullLine.match(/ActionCode\.([A-Z_]+)(?:\(|,|\)|;|$)/);
            if (match) {
                codes.add(match[1]);
            }
        }
        return Array.from(codes).sort();
    } catch (_) {
        return [];
    }
}

// ActionCodes used in production code (automated extraction)
const usedActionCodes = await extractUsedActionCodes();

const defined = Object.keys(constants.ActionCode);
const missing = usedActionCodes.filter(code => !defined.includes(code));
const unused = defined.filter(code => !usedActionCodes.includes(code));

// Output
if (JSON_OUTPUT) {
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            defined: defined.length,
            used: usedActionCodes.length,
            missing: missing.length,
            unused: unused.length,
            coverage: ((usedActionCodes.length / defined.length) * 100).toFixed(1) + '%',
        },
        missing,
        unused,
        allDefined: defined,
        allUsed: usedActionCodes,
    };
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log('\n=== ANÁLISE DE CONSTANTES NERV ===\n');
    console.log(`📋 ActionCodes DEFINIDOS: ${defined.length}`);
    console.log(`🔧 ActionCodes USADOS no código: ${usedActionCodes.length}`);
    console.log(`📊 Cobertura: ${((usedActionCodes.length / defined.length) * 100).toFixed(1)}%`);
    console.log();

    if (missing.length > 0) {
        console.log(`❌ FALTAM nas constantes (${missing.length}):`);
        missing.forEach(code => console.log(`   - ${code}`));
        console.log();
    } else {
        console.log('✅ Todas as constantes usadas estão definidas!\n');
    }

    if (unused.length > 0) {
        console.log(`⚠️  DEFINIDOS mas NÃO USADOS (${unused.length}):`);
        unused.forEach(code => console.log(`   - ${code}`));
        console.log('\n💡 Considerar se são para uso futuro ou podem ser removidos');
        console.log();
    }

    console.log('='.repeat(50));

    if (missing.length > 0) {
        console.log('🔴 AÇÃO NECESSÁRIA: Adicionar', missing.length, 'constantes faltantes\n');
        process.exit(1);
    } else if (STRICT && unused.length > 0) {
        console.log('⚠️  MODO STRICT: Constantes não utilizadas encontradas\n');
        process.exit(1);
    } else {
        console.log('🟢 Constantes estão completas e alinhadas com o código\n');
        process.exit(0);
    }
}
