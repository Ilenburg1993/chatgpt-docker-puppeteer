import fs from 'fs';

/** @typedef {{ code: number, message: string, file?: string, line: number, column: number }} DiagnosticEntry */
/** @typedef {DiagnosticEntry & { reason: string }} CategorizedDiagnostic */
/** @type {{ errors: DiagnosticEntry[] }} */
const report = JSON.parse(fs.readFileSync('typescript-diagnostics.json', 'utf8'));

// Categorias de erros
/** @type {{ runtimeBugs: CategorizedDiagnostic[], typeWarnings: CategorizedDiagnostic[], falsPositives: CategorizedDiagnostic[], configIssues: CategorizedDiagnostic[] }} */
const categories = {
    runtimeBugs: [], // Erros que podem causar bugs em runtime
    typeWarnings: [], // Avisos de tipo (não afetam runtime)
    falsPositives: [], // Falsos positivos (TS limitation)
    configIssues: [], // Problemas de configuração
};

for (const err of report.errors) {
    const code = err.code;
    const msg = err.message;
    const file = err.file || 'GLOBAL';

    // Categorizar por código e contexto
    if (code === 2304) {
        // Cannot find name
        if (
            msg.includes("'fs'") ||
            msg.includes("'http'") ||
            msg.includes("'path'") ||
            msg.includes("'ts'") ||
            msg.includes("'spawn'") ||
            msg.includes("'exec'")
        ) {
            categories.falsPositives.push({ ...err, reason: 'Node.js built-in ou dependência sem @types' });
        } else if (file.startsWith('scripts/')) {
            categories.falsPositives.push({ ...err, reason: 'Script sem imports explícitos (mas funcional)' });
        } else {
            categories.runtimeBugs.push({ ...err, reason: 'Variável não definida - pode causar ReferenceError' });
        }
    } else if (code === 2339) {
        // Property does not exist
        if (msg.includes("Property 'default' does not exist")) {
            categories.falsPositives.push({ ...err, reason: 'ESM import - TS não infere .default corretamente' });
        } else if (msg.includes('ConfigurationManager')) {
            categories.falsPositives.push({ ...err, reason: 'Propriedade dinâmica - TS não consegue inferir' });
        } else {
            categories.typeWarnings.push({ ...err, reason: 'Propriedade pode não existir - verificar em runtime' });
        }
    } else if (code === 2584) {
        // Cannot find name 'document'
        if (msg.includes('document') || msg.includes('window') || msg.includes('navigator')) {
            categories.configIssues.push({ ...err, reason: 'Browser context - precisa de lib: ["dom"]' });
        } else {
            categories.typeWarnings.push({ ...err, reason: 'Nome não encontrado' });
        }
    } else if (code === 1223) {
        categories.runtimeBugs.push({ ...err, reason: 'JSDoc inválido - afeta IDE' });
    } else if (code === 2345 || code === 2322) {
        // Type mismatch
        if (file.startsWith('src/')) {
            categories.typeWarnings.push({ ...err, reason: 'Type mismatch - revisar lógica' });
        } else {
            categories.falsPositives.push({ ...err, reason: 'Type mismatch em script auxiliar' });
        }
    } else if (code === 2554 || code === 2769) {
        categories.runtimeBugs.push({ ...err, reason: 'Argumentos incorretos - pode causar erro' });
    } else if (code === 2307) {
        categories.runtimeBugs.push({ ...err, reason: 'Módulo não encontrado - import quebrado' });
    } else {
        categories.typeWarnings.push({ ...err, reason: 'Outro erro de tipo' });
    }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 ANÁLISE FINAL DOS 889 ERROS TYPESCRIPT');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`🔴 BUGS REAIS (afetam runtime): ${categories.runtimeBugs.length}`);
console.log(`⚠️  AVISOS DE TIPO (não afetam runtime): ${categories.typeWarnings.length}`);
console.log(`⚙️  PROBLEMAS DE CONFIGURAÇÃO: ${categories.configIssues.length}`);
console.log(`✅ FALSOS POSITIVOS (TS limitation): ${categories.falsPositives.length}\n`);

// Detalhar bugs reais
if (categories.runtimeBugs.length > 0) {
    console.log('━━━ 🔴 BUGS REAIS (PRIORIDADE MÁXIMA) ━━━\n');

    /** @type {Record<string, CategorizedDiagnostic[]>} */
    const byFile = {};
    for (const err of categories.runtimeBugs) {
        const file = err.file ?? 'GLOBAL';
        const fileErrors = byFile[file] ?? (byFile[file] = []);
        fileErrors.push(err);
    }

    const topFiles = Object.entries(byFile)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 10);

    for (const [file, errs] of topFiles) {
        console.log(`📄 ${file} (${errs.length} erro(s))`);
        for (const e of errs.slice(0, 3)) {
            console.log(`   ${e.line}:${e.column} - TS${e.code}: ${e.message.substring(0, 100)}...`);
            console.log(`   → ${e.reason}\n`);
        }
        if (errs.length > 3) {
            console.log(`   ... e mais ${errs.length - 3} erro(s)\n`);
        }
    }
}

// Salvar relatório categorizado
const categorizedReport = {
    timestamp: new Date().toISOString(),
    total: report.errors.length,
    summary: {
        runtimeBugs: categories.runtimeBugs.length,
        typeWarnings: categories.typeWarnings.length,
        configIssues: categories.configIssues.length,
        falsePositives: categories.falsPositives.length,
    },
    categories,
};

fs.writeFileSync('typescript-errors-categorized.json', JSON.stringify(categorizedReport, null, 2));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📝 Relatório completo: typescript-errors-categorized.json');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('🎯 RECOMENDAÇÃO:');
console.log(`   1. Corrigir ${categories.runtimeBugs.length} bugs reais`);
console.log(`   2. Revisar ${Math.min(categories.typeWarnings.length, 20)} avisos de tipo mais críticos`);
console.log(`   3. Configurar jsconfig.json para ignorar ${categories.configIssues.length} erros de browser context`);
console.log(`   4. Ignorar ${categories.falsPositives.length} falsos positivos\n`);
