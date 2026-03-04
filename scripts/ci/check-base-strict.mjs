// @ts-check
/**
 * CI gate: verifica que `tsconfig.base.json` tem `compilerOptions.strict: true`.
 *
 * Este gate deve falhar na Fase 5 do roadmap até que a base seja endurecida.
 * Antes da Fase 5, adicione este script ao job de CI mas com `continue-on-error: true`.
 *
 * @module check-base-strict
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TSCONFIG_BASE = resolve('tsconfig.base.json');

/** @type {Record<string, unknown>} */
let config;

try {
    config = JSON.parse(readFileSync(TSCONFIG_BASE, 'utf8'));
} catch (/** @type {unknown} */ e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`❌ check-base-strict: não foi possível ler ${TSCONFIG_BASE}: ${msg}`);
    process.exit(1);
}

const compilerOptions = /** @type {Record<string, unknown>} */ (config?.compilerOptions ?? {});
const strict = compilerOptions?.strict;

if (strict !== true) {
    console.error('\n❌ check-base-strict: tsconfig.base.json NÃO tem strict: true');
    console.error(`   compilerOptions.strict = ${JSON.stringify(strict ?? null)}`);
    console.error('\n   A Fase 5 do roadmap exige que a base seja completamente estrita.');
    console.error('   Ref: DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md — Fase 5\n');
    process.exit(1);
}

console.log('✅ check-base-strict: tsconfig.base.json tem strict: true.');
