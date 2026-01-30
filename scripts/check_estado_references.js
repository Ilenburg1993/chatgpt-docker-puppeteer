#!/usr/bin/env node
// scripts/check_estado_references.js
// Lista referências a 'estado.json' em todo o repositório e falha
// se encontrar usos fora das áreas permitidas.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const ALLOWED_PATTERNS = [
    'DOCUMENTAÇÃO/DEPRECATIONS/',
    'backups/',
    'tools/outputs/',
    'DOCUMENTAÇÃO/', // allow docs generally if they contain DEPRECATED annotations
    'ecosystem.config.js',
    'analysis/',
    'logs/',
    'scripts/'
];

function walk(dir) {
    const results = [];
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git') continue;
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            results.push(...walk(full));
        } else {
            results.push(full);
        }
    }
    return results;
}

const allFiles = walk(ROOT);
const matches = [];

for (const file of allFiles) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('estado.json')) {
            // Check allowed
            const allowed = ALLOWED_PATTERNS.some(p => rel.startsWith(p) || rel === p);
            matches.push({ file: rel, allowed });
        }
    } catch (_e) {
        // ignore binary or unreadable files
    }
}

if (matches.length === 0) {
    console.log('[check_estado_references] OK — nenhuma referência a estado.json encontrada no repositório.');
    process.exit(0);
}

const offending = matches.filter(m => !m.allowed);
if (offending.length > 0) {
    console.error('[check_estado_references] Foram encontradas referências NÃO permitidas a estado.json:');
    for (const o of offending) {
        console.error(` - ${o.file}`);
    }
    console.error('\nAções sugeridas: atualizar os arquivos acima para usar NERV SERVER_READY ou mover referências para DOCUMENTAÇÃO/DEPRECATIONS.');
    process.exit(2);
}

console.log('[check_estado_references] Apenas ocorrências permitidas encontradas (docs/backups). OK');
process.exit(0);
