#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

// Padrão regex para encontrar o problema
const PATTERN = /new Promise\(r => setTimeout\(r, (\d+)\)\)/g;
const REPLACEMENT = 'new Promise(r => { setTimeout(r, $1); })';

function fixFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(PATTERN);

    if (!matches) {
        return 0;
    }

    const fixed = content.replace(PATTERN, REPLACEMENT);
    fs.writeFileSync(filePath, fixed, 'utf-8');

    return matches.length;
}

function walkDir(dir) {
    let totalFixed = 0;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'logs'].includes(file)) {
                totalFixed += walkDir(fullPath);
            }
        } else if (file.endsWith('.js')) {
            const fixed = fixFile(fullPath);
            if (fixed > 0) {
                console.log(`✅ ${fullPath}: ${fixed} ocorrências corrigidas`);
                totalFixed += fixed;
            }
        }
    }

    return totalFixed;
}

// Executa
console.log('🔧 Corrigindo padrão no-promise-executor-return...\n');
const total = walkDir('./src');
console.log(`\n✅ Total: ${total} ocorrências corrigidas`);
