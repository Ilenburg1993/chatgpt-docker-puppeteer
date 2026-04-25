#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'src', 'copilot');
const ALLOWED_SEGMENT = `${path.sep}src${path.sep}copilot${path.sep}sdk${path.sep}`;

/** @typedef {{ file: string; line: number; kind: string; text: string }} Finding */

/** @type {{ kind: string; regex: RegExp }[]} */
const RULES = [
    { kind: 'new CopilotClient', regex: /\bnew\s+CopilotClient\s*\(/ },
    { kind: 'client.rpc direct', regex: /\bclient\.rpc\./ },
    { kind: 'session.rpc direct', regex: /\bsession\.rpc\./ },
    { kind: 'session.sendAndWait direct', regex: /\bsession\.sendAndWait\s*\(/ },
    { kind: 'session.disconnect direct', regex: /\bsession\.disconnect\s*\(/ },
    { kind: 'session.send direct', regex: /\bsession\.send\s*\(/ },
    { kind: 'session.on direct', regex: /\bsession\.on\s*\(/ },
    { kind: 'session.getMessages direct', regex: /\bsession\.getMessages\s*\(/ },
];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full));
        } else if (entry.isFile() && full.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isCommentOnly(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/');
}

/**
 * Retorna true se a linha contém o marcador de supressão "crude-ok". Use apenas para casos documentados (ex: ocorrência
 * em string de log).
 *
 * @param {string} line
 * @returns {boolean}
 */
function isSuppressed(line) {
    return line.includes('// crude-ok');
}

/** @type {Finding[]} */
const findings = [];
for (const file of walk(TARGET)) {
    if (file.includes(ALLOWED_SEGMENT)) continue;
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
        if (isCommentOnly(line)) return;
        if (isSuppressed(line)) return;
        for (const rule of RULES) {
            if (rule.regex.test(line)) {
                findings.push({ file: rel, line: index + 1, kind: rule.kind, text: line.trim() });
            }
        }
    });
}

if (findings.length === 0) {
    console.log('[check-copilot-crude-calls] OK — nenhuma chamada crude executável fora de src/copilot/sdk/.');
    process.exit(0);
}

console.error('[check-copilot-crude-calls] Falhas encontradas:');
for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`);
}
process.exit(2);
