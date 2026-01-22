#!/usr/bin/env node
/* ==========================================================================
   scripts/refactor-to-aliases.js
   Script de Migração: Caminhos Relativos → Aliases

   Converte todos os require() do projeto para usar os aliases @core, @infra, etc.
========================================================================== */

const fs = require('fs');
const path = require('path');

// Mapeamento de aliases
const ALIAS_MAP = {
    "'../../core/": "'@core/",
    '"../../core/': '"@core/',
    "'../../../core/": "'@core/",
    '"../../../core/': '"@core/',
    "'../core/": "'@core/",
    '"../core/': '"@core/',

    "'../../shared/": "'@shared/",
    '"../../shared/': '"@shared/',
    "'../../../shared/": "'@shared/",
    '"../../../shared/': '"@shared/',
    "'../shared/": "'@shared/",
    '"../shared/': '"@shared/',

    "'../../infra/": "'@infra/",
    '"../../infra/': '"@infra/',
    "'../../../infra/": "'@infra/",
    '"../../../infra/': '"@infra/',
    "'../infra/": "'@infra/",
    '"../infra/': '"@infra/',

    "'../../server/engine/": "'@server/engine/",
    '"../../server/engine/': '"@server/engine/',
    "'../engine/": "'@server/engine/",
    '"../engine/': '"@server/engine/',

    "'../../nerv/": "'@nerv/",
    '"../../nerv/': '"@nerv/',
    "'../../../nerv/": "'@nerv/",
    '"../../../nerv/': '"@nerv/',
    "'../nerv/": "'@nerv/",
    '"../nerv/': '"@nerv/',

    "'../../kernel/": "'@kernel/",
    '"../../kernel/': '"@kernel/',
    "'../../../kernel/": "'@kernel/",
    '"../../../kernel/': '"@kernel/',
    "'../kernel/": "'@kernel/",
    '"../kernel/': '"@kernel/',

    "'../../driver/": "'@driver/",
    '"../../driver/': '"@driver/',
    "'../../../driver/": "'@driver/",
    '"../../../driver/': '"@driver/',
    "'../driver/": "'@driver/",
    '"../driver/': '"@driver/',

    "'../../logic/": "'@logic/",
    '"../../logic/': '"@logic/',
    "'../../../logic/": "'@logic/",
    '"../../../logic/': '"@logic/',
    "'../logic/": "'@logic/",
    '"../logic/': '"@logic/'
};

// Arquivos para processar
const filesToProcess = [];

function findJSFiles(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // Ignorar node_modules, logs, etc.
            if (
                ![
                    'node_modules',
                    'logs',
                    'tmp',
                    'fila',
                    'respostas',
                    'profile',
                    'backups',
                    'analysis',
                    '.git'
                ].includes(file)
            ) {
                findJSFiles(filePath);
            }
        } else if (file.endsWith('.js') && !file.includes('.min.')) {
            filesToProcess.push(filePath);
        }
    }
}

function refactorFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;

    // Aplicar todas as substituições
    for (const [oldPath, newPath] of Object.entries(ALIAS_MAP)) {
        if (content.includes(oldPath)) {
            content = content.split(oldPath).join(newPath);
            hasChanges = true;
        }
    }

    if (hasChanges) {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    }

    return false;
}

// Executar
console.log('🔍 Buscando arquivos JavaScript em src/...');
findJSFiles(path.join(__dirname, '../src'));

console.log(`📊 Encontrados ${filesToProcess.length} arquivos para processar`);

let changedCount = 0;
let errorCount = 0;

for (const file of filesToProcess) {
    try {
        const relativePath = path.relative(process.cwd(), file);
        if (refactorFile(file)) {
            console.log(`✅ ${relativePath}`);
            changedCount++;
        }
    } catch (error) {
        console.error(`❌ Erro em ${file}:`, error.message);
        errorCount++;
    }
}

console.log('\n' + '='.repeat(60));
console.log(`✅ Arquivos modificados: ${changedCount}`);
console.log(`⏭️  Arquivos inalterados: ${filesToProcess.length - changedCount - errorCount}`);
if (errorCount > 0) {
    console.log(`❌ Erros: ${errorCount}`);
}
console.log('='.repeat(60));
console.log('\n🎯 Próximos passos:');
console.log('1. Verificar mudanças: git diff');
console.log('2. Testar: npm test');
console.log('3. Lint: npm run lint');
console.log('4. Commit: git add . && git commit -m "refactor: migrar para aliases @core, @infra, etc"');
