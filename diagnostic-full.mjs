#!/usr/bin/env node
/**
 * Script de Diagnóstico Completo do Projeto Usa a API do TypeScript para analisar TODO o projeto
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from './scripts/analysis/typescript-compat.mjs';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'jsconfig.json');

console.log('🔍 DIAGNÓSTICO COMPLETO DO PROJETO\n');
console.log('Root:', ROOT);
console.log('Config:', CONFIG_PATH);
console.log('─'.repeat(80));

// Ler jsconfig.json
const configFile = ts.readConfigFile(CONFIG_PATH, ts.sys.readFile);
if (configFile.error) {
    console.error('❌ Erro ao ler jsconfig.json:', configFile.error.messageText);
    process.exit(1);
}

// Parse config
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT, {}, CONFIG_PATH);

console.log('\n📂 Arquivos incluídos:', parsedConfig.fileNames.length);
console.log('─'.repeat(80));

// Criar programa TypeScript
console.log('\n⏳ Criando programa TypeScript e analisando...\n');
const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
});

// Coletar todos os diagnósticos
const allDiagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getGlobalDiagnostics(),
];

// Categorizar diagnósticos
/** @type {Record<string, ts.Diagnostic[]> & { error: ts.Diagnostic[], warning: ts.Diagnostic[], suggestion: ts.Diagnostic[], message: ts.Diagnostic[] }} */
const categories = {
    error: [],
    warning: [],
    suggestion: [],
    message: [],
};

for (const diagnostic of allDiagnostics) {
    const category = ts.DiagnosticCategory[diagnostic.category].toLowerCase();
    categories[category]?.push(diagnostic);
}

// Formatar e exibir
console.log('📊 RESUMO DE DIAGNÓSTICOS\n');
console.log(`Total: ${allDiagnostics.length}`);
console.log(`  - Erros: ${categories.error.length}`);
console.log(`  - Avisos: ${categories.warning.length}`);
console.log(`  - Sugestões: ${categories.suggestion.length}`);
console.log(`  - Mensagens: ${categories.message.length}`);
console.log('─'.repeat(80));

// Exibir erros (limitado a 100 primeiros)
if (categories.error.length > 0) {
    console.log('\n❌ ERROS (primeiros 100):\n');

    const errors = categories.error.slice(0, 100);
    /** @type {Record<string, { line: number, column: number, code: number, message: string }[]>} */
    const errorsByFile = {};

    for (const diagnostic of errors) {
        if (!diagnostic.file) {
            console.log(`  [GLOBAL] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
            continue;
        }

        const fileName = path.relative(ROOT, diagnostic.file.fileName);
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        const code = diagnostic.code;

        const fileErrors = errorsByFile[fileName] ?? (errorsByFile[fileName] = []);
        fileErrors.push({
            line: line + 1,
            column: character + 1,
            code,
            message,
        });
    }

    // Agrupar por arquivo e ordenar
    const sortedFiles = Object.keys(errorsByFile).sort();

    for (const file of sortedFiles) {
        const diagnostics = errorsByFile[file] ?? [];
        console.log(`\n📄 ${file} (${diagnostics.length} erro(s))`);
        for (const d of diagnostics) {
            console.log(
                `   ${d.line}:${d.column} - TS${d.code}: ${d.message.substring(0, 120)}${d.message.length > 120 ? '...' : ''}`,
            );
        }
    }

    if (categories.error.length > 100) {
        console.log(`\n... e mais ${categories.error.length - 100} erros (veja relatório JSON)`);
    }
}

// Exibir avisos (limitado a 30 primeiros)
if (categories.warning.length > 0) {
    console.log('\n⚠️  AVISOS (primeiros 30):\n');

    const warnings = categories.warning.slice(0, 30);
    for (const diagnostic of warnings) {
        if (!diagnostic.file) continue;

        const fileName = path.relative(ROOT, diagnostic.file.fileName);
        const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

        console.log(`   ${fileName}:${line + 1} - ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);
    }

    if (categories.warning.length > 30) {
        console.log(`\n... e mais ${categories.warning.length - 30} avisos`);
    }
}

console.log('\n' + '─'.repeat(80));

// Salvar relatório completo
const report = {
    timestamp: new Date().toISOString(),
    root: ROOT,
    totalFiles: parsedConfig.fileNames.length,
    totalDiagnostics: allDiagnostics.length,
    summary: {
        errors: categories.error.length,
        warnings: categories.warning.length,
        suggestions: categories.suggestion.length,
        messages: categories.message.length,
    },
    errors: categories.error.map((d) => {
        if (!d.file)
            return { global: true, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), code: d.code };

        const fileName = path.relative(ROOT, d.file.fileName);
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);

        return {
            file: fileName,
            line: line + 1,
            column: character + 1,
            code: d.code,
            message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
            category: 'error',
        };
    }),
    warnings: categories.warning.map((d) => {
        if (!d.file)
            return { global: true, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'), code: d.code };

        const fileName = path.relative(ROOT, d.file.fileName);
        const { line, character } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);

        return {
            file: fileName,
            line: line + 1,
            column: character + 1,
            code: d.code,
            message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
            category: 'warning',
        };
    }),
};

const reportPath = path.join(ROOT, 'typescript-diagnostics.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n📝 Relatório completo salvo: ${reportPath}`);
console.log('\n✅ Análise concluída!');

// Análise de padrões de erros
if (categories.error.length > 0) {
    /** @type {Record<string, number>} */
    const errorCodes = {};
    for (const err of categories.error) {
        const code = String(err.code);
        errorCodes[code] = (errorCodes[code] ?? 0) + 1;
    }

    console.log('\n📈 Top 10 códigos de erro mais frequentes:');
    const sortedCodes = Object.entries(errorCodes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    for (const [code, count] of sortedCodes) {
        console.log(`   TS${code}: ${count} ocorrência(s)`);
    }
}

process.exit(categories.error.length > 0 ? 1 : 0);
