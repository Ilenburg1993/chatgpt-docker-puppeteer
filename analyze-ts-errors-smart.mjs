#!/usr/bin/env node
/**
 * Análise Inteligente de Erros TypeScript Categoriza erros e sugere correções em lote
 */

import fs from 'node:fs';

/** @typedef {{ code: number; file: string; line: number; column?: number; message: string }} DiagnosticEntry */
/** @type {{ errors: DiagnosticEntry[] }} */
const data = JSON.parse(fs.readFileSync('typescript-diagnostics.json', 'utf8'));

// Categorização de erros por tipo
/**
 * @type {Record<string, DiagnosticEntry[]> & {
 *     TS2554: DiagnosticEntry[];
 *     TS2339: DiagnosticEntry[];
 *     TS2345: DiagnosticEntry[];
 *     TS2322: DiagnosticEntry[];
 *     TS2351: DiagnosticEntry[];
 *     TS1064: DiagnosticEntry[];
 *     TS2694: DiagnosticEntry[];
 *     TS2300: DiagnosticEntry[];
 *     OTHER: DiagnosticEntry[];
 * }}
 */
const categories = {
    TS2554: [], // Expected X arguments, but got Y
    TS2339: [], // Property does not exist
    TS2345: [], // Type X is not assignable to parameter
    TS2322: [], // Type X is not assignable to type Y
    TS2351: [], // Not constructable
    TS1064: [], // Return type must be Promise<T>
    TS2694: [], // Namespace has no exported member
    TS2300: [], // Duplicate identifier
    OTHER: [],
};

// Agrupa erros por código
data.errors.forEach((err) => {
    const code = `TS${err.code}`;
    if (categories[code]) {
        categories[code].push(err);
    } else {
        categories.OTHER.push(err);
    }
});

console.log('📊 ANÁLISE INTELIGENTE DE ERROS TYPESCRIPT\n');
console.log('='.repeat(80));

// ============================================================
// CATEGORIA 1: TS2554 - Argument Count Mismatch
// ============================================================
if (categories.TS2554.length > 0) {
    console.log(`\n🔧 CATEGORIA 1: TS2554 - Argument Count Mismatch (${categories.TS2554.length} erros)`);
    console.log('─'.repeat(80));

    /** @type {Record<string, { line: number; message: string }[]>} */
    const byFile = {};
    categories.TS2554.forEach((err) => {
        const file = err.file.replace('/workspaces/chatgpt-docker-puppeteer/', '');
        const fileErrors = byFile[file] ?? (byFile[file] = []);
        fileErrors.push({ line: err.line, message: err.message });
    });

    Object.entries(byFile).forEach(([file, errors]) => {
        console.log(`\n📄 ${file} (${errors.length} erros)`);
        errors.forEach((e) => {
            console.log(`   Linha ${e.line}: ${e.message.slice(0, 100)}...`);
        });
    });

    console.log('\n💡 SOLUÇÃO:');
    console.log('   1. Abrir cada arquivo listado');
    console.log('   2. Verificar chamada real do método na linha indicada');
    console.log('   3. Atualizar signature no .d.ts correspondente');
    console.log('   Exemplo: typeText(el, text, delay, opts) → signature precisa ter 4 params');
}

// ============================================================
// CATEGORIA 2: TS2339 - Property Does Not Exist
// ============================================================
if (categories.TS2339.length > 0) {
    console.log(`\n\n🔧 CATEGORIA 2: TS2339 - Property Does Not Exist (${categories.TS2339.length} erros)`);
    console.log('─'.repeat(80));

    // Extrai propriedades faltantes
    const missingProps = new Map();
    categories.TS2339.forEach((err) => {
        const match = err.message.match(/Property '(\w+)' does not exist on type '(.+?)'/);
        if (match) {
            const [, prop, type] = match;
            if (!prop || !type) return;
            const key = type.includes('ConfigurationManager')
                ? 'ConfigurationManager'
                : type.includes('ConnectionOrchestrator')
                  ? 'ConnectionOrchestrator'
                  : type.includes('DRIVER_STATES')
                    ? 'DRIVER_STATES'
                    : type.includes('TargetDriver')
                      ? 'TargetDriver'
                      : type;

            const properties = missingProps.get(key) ?? new Set();
            properties.add(prop);
            missingProps.set(key, properties);
        }
    });

    missingProps.forEach((props, type) => {
        console.log(`\n📦 ${type}:`);
        console.log(`   Propriedades faltantes: ${Array.from(props).join(', ')}`);
    });

    console.log('\n💡 SOLUÇÃO:');
    console.log('   1. ConfigurationManager → Adicionar propriedades ao global.d.ts');
    console.log('   2. DRIVER_STATES → Adicionar STALLED ao fixes.d.ts');
    console.log('   3. TargetDriver → Adicionar config property ao driver.d.ts');
    console.log('   4. ConnectionOrchestrator → Adicionar synchronize() ao project.d.ts');
}

// ============================================================
// CATEGORIA 3: TS2345 - Type Not Assignable to Parameter
// ============================================================
if (categories.TS2345.length > 0) {
    console.log(`\n\n🔧 CATEGORIA 3: TS2345 - Type Not Assignable to Parameter (${categories.TS2345.length} erros)`);
    console.log('─'.repeat(80));

    const iDriverErrors = categories.TS2345.filter((e) => e.message.includes('IDriver'));

    if (iDriverErrors.length > 0) {
        console.log(`\n🎯 IDriver errors: ${iDriverErrors.length}`);
        console.log('   Problema: BaseDriver não implementa TODAS as propriedades de IDriver');
        console.log('   no momento da construção (propriedades criadas progressivamente)');

        console.log('\n💡 SOLUÇÃO:');
        console.log('   Tornar TODAS as propriedades de IDriver opcionais com "?"');
        console.log('   Exemplo: driverId: string → driverId?: string');
    }

    const otherErrors = categories.TS2345.filter((e) => !e.message.includes('IDriver'));
    if (otherErrors.length > 0) {
        console.log(`\n📋 Outros TS2345: ${otherErrors.length}`);
        otherErrors.slice(0, 3).forEach((e) => {
            const file = e.file.replace('/workspaces/chatgpt-docker-puppeteer/', '');
            console.log(`   ${file}:${e.line} - ${e.message.slice(0, 80)}...`);
        });
    }
}

// ============================================================
// CATEGORIA 4: TS2322 - Type Mismatch
// ============================================================
if (categories.TS2322.length > 0) {
    console.log(`\n\n🔧 CATEGORIA 4: TS2322 - Type Mismatch (${categories.TS2322.length} erros)`);
    console.log('─'.repeat(80));

    // Agrupa por padrão
    const literalTypes = categories.TS2322.filter(
        (e) =>
            e.message.includes("is not assignable to type '1000'") ||
            e.message.includes('is not assignable to type \'"UNATTACHED"\'') ||
            e.message.includes('is not assignable to type \'"OPERATIONAL"\''),
    );

    if (literalTypes.length > 0) {
        console.log(`\n🔢 Literal Types (${literalTypes.length} erros):`);
        console.log('   Problema: TypeScript inferiu tipo literal muito específico');
        console.log('   Exemplos: number → 1000, string → "UNATTACHED"');

        console.log('\n💡 SOLUÇÃO:');
        console.log('   Usar union types: TimeoutMode = 500 | 1000 | 1500 | number');
        console.log('   Ou tornar tipo mais genérico: DriverState = string (ao invés de literais)');
    }

    const arrayTypes = categories.TS2322.filter(
        (e) => e.message.includes('is not assignable to type') && e.message.includes('[]'),
    );
    if (arrayTypes.length > 0) {
        console.log(`\n📚 Array Types (${arrayTypes.length} erros):`);
        arrayTypes.slice(0, 2).forEach((e) => {
            const file = e.file.replace('/workspaces/chatgpt-docker-puppeteer/', '');
            console.log(`   ${file}:${e.line}`);
        });
    }
}

// ============================================================
// CATEGORIA 5: TS2694 - Namespace Export
// ============================================================
if (categories.TS2694.length > 0) {
    console.log(`\n\n🔧 CATEGORIA 5: TS2694 - Namespace Export (${categories.TS2694.length} erros)`);
    console.log('─'.repeat(80));
    console.log('   Problema: puppeteer module não exporta tipos Page, Browser');
    console.log('\n💡 SOLUÇÃO:');
    console.log('   npm install --save-dev @types/puppeteer');
}

// ============================================================
// CATEGORIA 6: TS2351 - Not Constructable
// ============================================================
if (categories.TS2351.length > 0) {
    console.log(`\n\n🔧 CATEGORIA 6: TS2351 - Not Constructable (${categories.TS2351.length} erros)`);
    console.log('─'.repeat(80));
    categories.TS2351.slice(0, 3).forEach((e) => {
        const file = e.file.replace('/workspaces/chatgpt-docker-puppeteer/', '');
        console.log(`   ${file}:${e.line} - ${e.message.slice(0, 100)}...`);
    });
    console.log('\n💡 SOLUÇÃO:');
    console.log('   Problema com union types de imports - class | typeof import(...)');
    console.log('   Ajustar declaration para ser mais específica');
}

// ============================================================
// RESUMO E PLANO DE AÇÃO
// ============================================================
console.log('\n\n' + '='.repeat(80));
console.log('📋 RESUMO E PLANO DE AÇÃO');
console.log('='.repeat(80));

const totalErrors = data.errors.length;
const fixable =
    categories.TS2554.length + categories.TS2339.length + categories.TS2345.length + categories.TS2322.length;

console.log(`\nTotal de erros: ${totalErrors}`);
console.log(`Facilmente corrigíveis: ${fixable} (${Math.round((fixable / totalErrors) * 100)}%)`);

console.log('\n🎯 ORDEM DE EXECUÇÃO RECOMENDADA:');
console.log('   1️⃣  Instalar @types/puppeteer (elimina TS2694)');
console.log('   2️⃣  Tornar IDriver properties opcionais (elimina maioria TS2345)');
console.log('   3️⃣  Adicionar propriedades faltantes (elimina TS2339)');
console.log('   4️⃣  Ajustar signatures de métodos (elimina TS2554)');
console.log('   5️⃣  Fix literal types (elimina TS2322)');
console.log('   6️⃣  Ajustar constructable types (elimina TS2351)');

console.log('\n📊 Estimativa de redução:');
console.log(`   Após Fase 1: ~${totalErrors - categories.TS2694.length} erros`);
console.log(`   Após Fase 2: ~${totalErrors - categories.TS2694.length - categories.TS2345.length} erros`);
console.log(
    `   Após Fase 3: ~${totalErrors - categories.TS2694.length - categories.TS2345.length - categories.TS2339.length} erros`,
);
console.log(`   Após Fases 4-6: ~0-20 erros`);

console.log('\n✅ Começar? Execute os comandos na ordem recomendada!\n');
