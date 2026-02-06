#!/usr/bin/env nodeimport fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const IGNORED_DIRS = ['node_modules', 'backups', 'tests', 'backups', '.git'];

const patterns = [
    {
        id: 'puppeteer-launch',
        regex: /\bpuppeteer\.launch\s*\(/g,
        message: 'Uso de puppeteer.launch() detectado — arquitetura exige connect-only (puppeteer.connect()).',
        allowFiles: []
    },
    {
        id: 'process-exit',
        regex: /process\.exit\s*\(/g,
        message: 'Uso de process.exit() detectado — permitido apenas em entrypoints autorizados.',
        allowFiles: [
            path.join('src', 'main.js'),
            path.join('src', 'server', 'main.js'),
            path.join('src', 'server', 'engine', 'lifecycle.js')
        ]
    },
    {
        id: 'hardcoded-ports',
        regex: /\b9222\b|\b9224\b/g,
        message: 'Porta hardcoded detectada (9222/9224) — use configuração via env/CONFIG.',
        allowFiles: [
            path.join('src', 'core', 'config.js'),
            path.join('src', 'infra', 'ConnectionOrchestrator.js'),
            path.join('src', 'core', 'boot_resilience_manager.js'),
            path.join('src', 'core', 'doctor.js'),
            path.join('src', 'infra', 'browser_pool', 'pool_manager.js'),
            path.join('src', 'driver', 'nerv_adapter', 'driver_nerv_adapter.js'),
            path.join('src', 'server', 'main.js')
        ]
    },
    {
        id: 'file-ipc',
        regex: /estado\.json/g,
        message: 'Uso de discovery por arquivo (estado.json) detectado — migre para NERV SERVER_READY.',
        allowFiles: []
    }
];

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat && stat.isDirectory()) {
            if (IGNORED_DIRS.includes(file)) continue;
            results = results.concat(walk(full));
        } else {
            if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
            results.push(full);
        }
    }
    return results;
}

function relative(p) {
    return path.relative(ROOT, p).split(path.sep).join('/');
}

const files = walk(SRC);
const findings = [];

for (const file of files) {
    const rel = relative(file);
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const pat of patterns) {
        if (pat.allowFiles && pat.allowFiles.includes(rel)) {
            continue; // arquivo permitido
        }

        let match;
        const re = new RegExp(pat.regex);
        while ((match = re.exec(content)) !== null) {
            // compute line number
            const idx = match.index;
            let lineNum = 1;
            let acc = 0;
            for (let i = 0; i < lines.length; i++) {
                acc += lines[i].length + 1; // +1 for newline
                if (acc > idx) {
                    lineNum = i + 1;
                    break;
                }
            }

            // Determine if match is in a comment or inside a string/template;
            // if so, ignore it (we only want runtime occurrences).
            const line = lines[lineNum - 1] || '';
            const lineStart = acc - ((lines[lineNum - 1] || '').length + 1);
            const column = idx - (lineStart >= 0 ? lineStart : 0);
            const pre = line.slice(0, Math.max(0, column));

            // Inline comment (//) after code — if match occurs after //, skip
            const inlineCommentIdx = line.indexOf('//');
            if (inlineCommentIdx !== -1 && column >= inlineCommentIdx) {
                continue;
            }

            // Block comment style lines often start with '*', skip those
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/')) {
                continue;
            }

            // If the match is inside quotes/backticks, skip (string literal)
            const dq = (pre.match(/"/g) || []).length;
            const sq = (pre.match(/'/g) || []).length;
            const bt = (pre.match(/`/g) || []).length;
            if (dq % 2 === 1 || sq % 2 === 1 || bt % 2 === 1) {
                continue;
            }

            findings.push({
                id: pat.id,
                file: rel,
                line: lineNum,
                excerpt: line.trim(),
                message: pat.message
            });
        }
    }
}

if (findings.length > 0) {
    console.error('\n[check_forbidden_patterns] Foram detectados padrões proibidos:');
    for (const f of findings) {
        console.error(`- [${f.id}] ${f.file}#L${f.line}: ${f.excerpt}`);
        console.error(`  -> ${f.message}\n`);
    }
    console.error('[check_forbidden_patterns] Falha: remova ou justifique itens antes de prosseguir.');
    process.exit(2);
}

console.log('[check_forbidden_patterns] OK — nenhum padrão proibido encontrado em src/.');
process.exit(0);
