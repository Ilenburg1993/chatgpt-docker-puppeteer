#!/usr/bin/env node
/**
 * NERV Constants Validator
 *
 * Purpose: Validates that all ActionCodes used in production code are defined in constants.js
 *
 * Validates:
 * - All used ActionCodes are defined
 * - Reports unused defined ActionCodes (for cleanup consideration)
 * - Ensures constants.js completeness
 *
 * Usage:
 *   node scripts/validate-nerv-constants.js
 *   node scripts/validate-nerv-constants.js --strict    # Exit 1 if unused constants found
 *   node scripts/validate-nerv-constants.js --json      # JSON output
 *
 * Exit Codes:
 *   0 - All constants are valid
 *   1 - Missing constants or unused (in --strict mode)
 *   2 - Error during execution
 *
 * Note: Update the 'used' array manually when new ActionCodes are added to code.
 * Future improvement: Parse code automatically to extract used ActionCodes.
 */

const path = require('path');
const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');

// Import constants
const constantsPath = path.join(__dirname, '..', 'src', 'shared', 'nerv', 'constants.js');
const constants = require(constantsPath);

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
