// @ts-check
/**
 * CI gate: verifies the canonical TypeScript base carries the workspace full-strict contract.
 *
 * @module check-base-strict
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TSCONFIG_BASE = resolve('tsconfig.base.json');
const REQUIRED_OPTIONS = Object.freeze({
    allowJs: true,
    checkJs: true,
    strict: true,
    alwaysStrict: true,
    noImplicitAny: true,
    noImplicitThis: true,
    strictNullChecks: true,
    strictFunctionTypes: true,
    strictBindCallApply: true,
    strictPropertyInitialization: true,
    strictBuiltinIteratorReturn: true,
    useUnknownInCatchVariables: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noUncheckedSideEffectImports: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitOverride: true,
    forceConsistentCasingInFileNames: true,
    isolatedModules: true,
    erasableSyntaxOnly: true,
    moduleDetection: 'force',
    allowUnreachableCode: false,
    allowUnusedLabels: false,
});

/** @type {Record<string, unknown>} */
let config;
try {
    config = JSON.parse(readFileSync(TSCONFIG_BASE, 'utf8'));
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ check-base-strict: cannot read ${TSCONFIG_BASE}: ${message}`);
    process.exit(1);
}

const compilerOptions = config['compilerOptions'];
if (!compilerOptions || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions)) {
    console.error('❌ check-base-strict: compilerOptions is missing or invalid.');
    process.exit(1);
}
const options = /** @type {Record<string, unknown>} */ (compilerOptions);
const mismatches = Object.entries(REQUIRED_OPTIONS).filter(([key, expected]) => options[key] !== expected);
if (mismatches.length > 0) {
    console.error('\n❌ check-base-strict: canonical full-strict contract is not satisfied:\n');
    for (const [key, expected] of mismatches) {
        console.error(`  ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(options[key])}`);
    }
    process.exit(1);
}

console.log(`✅ check-base-strict: ${Object.keys(REQUIRED_OPTIONS).length} canonical strict options verified.`);
