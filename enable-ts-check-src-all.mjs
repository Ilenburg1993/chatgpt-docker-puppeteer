#!/usr/bin/env node
// Adiciona @ts-check em QUASE TODA a pasta src/ (excluindo dashboard-ui e node_modules)

import fs from 'node:fs';
import path from 'node:path';

const TS_CHECK_HEADER = '// @ts-check - Type checking rigoroso habilitado (arquivo core)\n';

function shouldSkipDirectory(dir) {
    const basename = path.basename(dir);
    return basename === 'dashboard-ui' ||
           basename === 'node_modules' ||
           basename === '.git';
}

function getAllJsFiles(dir, files = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (!shouldSkipDirectory(fullPath)) {
                getAllJsFiles(fullPath, files);
            }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function hasTypeCheckDirective(content) {
    const firstLine = content.split('\n')[0];
    return firstLine.includes('@ts-check') || firstLine.includes('@ts-nocheck');
}

const srcDir = '/workspaces/chatgpt-docker-puppeteer/src';
const files = getAllJsFiles(srcDir);

let added = 0;
let skipped = 0;

for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');

    if (hasTypeCheckDirective(content)) {
        skipped++;
        continue;
    }

    const newContent = TS_CHECK_HEADER + content;
    fs.writeFileSync(file, newContent, 'utf8');
    console.log(`✅ ${file}`);
    added++;
}

console.log(`\n📊 RESUMO:`);
console.log(`   ✅ Type checking habilitado: ${added} arquivos`);
console.log(`   ⏭️  Já tinham diretiva: ${skipped} arquivos`);
console.log(`   📁 Total processado: ${added + skipped} arquivos`);
