#!/usr/bin/env node
// @ts-check
/**
 * Diagnóstico completo do workspace usando a API nativa do TypeScript 7.
 *
 * O diagnóstico histórico dependia da API JavaScript do TS6 e de um `jsconfig.json` que não existe mais. Esta versão
 * abre um snapshot real do compilador canônico TS7 e coleta diagnósticos do mesmo programa usado pelos gates modernos.
 */

import { DiagnosticCategory, API as TypeScriptNativeAPI } from 'typescript/unstable/sync';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const reportIndex = args.indexOf('--report');
const CONFIG_PATH = path.resolve(
    ROOT,
    configIndex >= 0 ? (args[configIndex + 1] ?? 'tsconfig.node.json') : 'tsconfig.node.json',
);
const REPORT_PATH = path.resolve(
    ROOT,
    reportIndex >= 0 ? (args[reportIndex + 1] ?? 'typescript-diagnostics.json') : 'typescript-diagnostics.json',
);

/** @typedef {import('typescript/unstable/sync').Diagnostic} NativeDiagnostic */

/** @param {NativeDiagnostic} diagnostic @returns {string} */
function flattenDiagnosticText(diagnostic) {
    /** @type {string[]} */
    const nested = diagnostic.messageChain?.map(flattenDiagnosticText).filter(Boolean) ?? [];
    return [diagnostic.text, ...nested].filter(Boolean).join('\n');
}

/** @param {number} category */
function categoryName(category) {
    const name = DiagnosticCategory[category];
    return typeof name === 'string' ? name.toLowerCase() : 'message';
}

/** @param {string | undefined} fileName @param {number} position */
function locate(fileName, position) {
    if (!fileName || position < 0) return { line: null, column: null };
    try {
        const source = fs.readFileSync(fileName, 'utf8');
        const safePosition = Math.min(position, source.length);
        const before = source.slice(0, safePosition);
        const line = before.split('\n').length;
        const lastBreak = before.lastIndexOf('\n');
        const column = safePosition - lastBreak;
        return { line, column };
    } catch {
        return { line: null, column: null };
    }
}

/** @param {string} source @param {readonly NativeDiagnostic[]} diagnostics */
function tagDiagnostics(source, diagnostics) {
    return diagnostics.map((diagnostic) => ({ source, diagnostic }));
}

console.log('🔍 DIAGNÓSTICO TYPESCRIPT 7 DO WORKSPACE\n');
console.log(`Root: ${ROOT}`);
console.log(`Config: ${CONFIG_PATH}`);
console.log('─'.repeat(80));

if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ Configuração inexistente: ${CONFIG_PATH}`);
    process.exit(1);
}

const api = new TypeScriptNativeAPI();
let snapshot;
try {
    snapshot = api.updateSnapshot({ openProjects: [CONFIG_PATH] });
    const project = snapshot.getProject(CONFIG_PATH) ?? snapshot.getProjects()[0];
    if (!project) throw new Error(`TypeScript 7 não abriu projeto para ${CONFIG_PATH}`);

    const program = project.program;
    const tagged = [
        ...tagDiagnostics('config', program.getConfigFileParsingDiagnostics()),
        ...tagDiagnostics('program', program.getProgramDiagnostics()),
        ...tagDiagnostics('global', program.getGlobalDiagnostics()),
        ...tagDiagnostics('syntactic', program.getSyntacticDiagnostics()),
        ...tagDiagnostics('bind', program.getBindDiagnostics()),
        ...tagDiagnostics('semantic', program.getSemanticDiagnostics()),
        ...tagDiagnostics('suggestion', program.getSuggestionDiagnostics()),
    ];

    const seen = new Set();
    const normalized = tagged
        .filter(({ source, diagnostic }) => {
            const key = [
                source,
                diagnostic.fileName ?? '',
                diagnostic.pos,
                diagnostic.end,
                diagnostic.code,
                diagnostic.text,
            ].join('|');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(({ source, diagnostic }) => {
            const location = locate(diagnostic.fileName, diagnostic.pos);
            return {
                source,
                category: categoryName(diagnostic.category),
                code: diagnostic.code,
                file: diagnostic.fileName ? path.relative(ROOT, diagnostic.fileName).replace(/\\/gu, '/') : null,
                line: location.line,
                column: location.column,
                start: diagnostic.pos,
                end: diagnostic.end,
                message: flattenDiagnosticText(diagnostic),
                reports_unnecessary: diagnostic.reportsUnnecessary ?? false,
                reports_deprecated: diagnostic.reportsDeprecated ?? false,
            };
        });

    const byCategory = Object.groupBy(normalized, (entry) => entry.category);
    const errors = byCategory['error'] ?? [];
    const warnings = byCategory['warning'] ?? [];
    const suggestions = byCategory['suggestion'] ?? [];
    const messages = byCategory['message'] ?? [];
    const sourceFiles = program.getSourceFileNames();

    console.log(`\n📂 Root files: ${project.rootFiles.length}`);
    console.log(`📚 Source files resolvidos: ${sourceFiles.length}`);
    console.log('\n📊 RESUMO DE DIAGNÓSTICOS');
    console.log(`Total: ${normalized.length}`);
    console.log(`  - Erros: ${errors.length}`);
    console.log(`  - Avisos: ${warnings.length}`);
    console.log(`  - Sugestões: ${suggestions.length}`);
    console.log(`  - Mensagens: ${messages.length}`);

    if (errors.length > 0) {
        console.log('\n❌ ERROS (primeiros 100):');
        for (const entry of errors.slice(0, 100)) {
            const location = entry.file
                ? `${entry.file}${entry.line == null ? '' : `:${entry.line}:${entry.column ?? 1}`}`
                : '[GLOBAL]';
            const compact = entry.message.replace(/\s+/gu, ' ').slice(0, 180);
            console.log(`  ${location} TS${entry.code}: ${compact}`);
        }
        if (errors.length > 100) console.log(`  ... e mais ${errors.length - 100} erro(s); consulte o JSON.`);
    }

    const errorCodes = Object.entries(
        errors.reduce((acc, entry) => {
            acc[String(entry.code)] = (acc[String(entry.code)] ?? 0) + 1;
            return acc;
        }, /** @type {Record<string, number>} */ ({})),
    )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10);

    const report = {
        schema_version: 2,
        engine: 'typescript/unstable/sync',
        typescript_version: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/typescript/package.json'), 'utf8')).version,
        timestamp: new Date().toISOString(),
        root: ROOT,
        config: path.relative(ROOT, CONFIG_PATH).replace(/\\/gu, '/'),
        root_files: project.rootFiles.length,
        source_files: sourceFiles.length,
        total_diagnostics: normalized.length,
        summary: {
            errors: errors.length,
            warnings: warnings.length,
            suggestions: suggestions.length,
            messages: messages.length,
        },
        top_error_codes: errorCodes.map(([code, count]) => ({ code: Number(code), count })),
        diagnostics: normalized,
    };

    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\n📝 Relatório: ${REPORT_PATH}`);
    console.log(errors.length === 0 ? '✅ TypeScript 7: zero erros.' : `❌ TypeScript 7: ${errors.length} erro(s).`);
    process.exitCode = errors.length > 0 ? 1 : 0;
} finally {
    snapshot?.dispose();
    api.close();
}
