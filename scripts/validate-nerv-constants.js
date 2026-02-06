#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');

// Import constants
const constantsPath = path.join(import.meta.dirname, '..', 'src', 'shared', 'nerv', 'constants.js');
const constants = await import(pathToFileURL(path.resolve(constantsPath)).href).then(m => m.default ?? m);

// ActionCodes used in production code (manually curated)
// TODO: Automate by parsing src/ with AST
const usedActionCodes = [
    'BROWSER_REBOOT',
    'CACHE_CLEAR',
    'DRIVER_ABORT',
    'DRIVER_ANOMALY',
    'DRIVER_ERROR',
    'DRIVER_EXECUTE_TASK',
    'DRIVER_HEALTH_CHECK',
    'DRIVER_HEALTH_REPORT',
    'DRIVER_STATE_OBSERVED',
    'DRIVER_TASK_ABORTED',
    'DRIVER_TASK_COMPLETED',
    'DRIVER_TASK_FAILED',
    'DRIVER_TASK_STARTED',
    'DRIVER_VITAL',
    'ENGINE_PAUSE',
    'ENGINE_RESUME',
    'ENGINE_STOP',
    'KERNEL_HEALTH_CHECK',
    'KERNEL_INTERNAL_ERROR',
    'KERNEL_TELEMETRY',
    'PROPOSE_TASK',
    'SECURITY_VIOLATION',
    'STALL_DETECTED',
    'TASK_CANCEL',
    'TASK_FAILED',
    'TASK_REJECTED',
    'TASK_RETRY',
    'TASK_START',
    'TELEMETRY_DISCARDED'
];

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
            coverage: ((usedActionCodes.length / defined.length) * 100).toFixed(1) + '%'
        },
        missing,
        unused,
        allDefined: defined,
        allUsed: usedActionCodes
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
