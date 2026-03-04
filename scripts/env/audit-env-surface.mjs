#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';

if (process.env.FORCE_COLOR && process.env.NO_COLOR) {
    delete process.env.NO_COLOR;
}

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCAN_ROOTS = ['src', 'scripts', '.devcontainer'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const TEMPLATE_FILES = ['.env.example', '.env.local.example', '.env.expert.example'];
const RUNTIME_ONLY = new Set([
    'FORCE_COLOR',
    'NO_COLOR',
    'NODE_APP_INSTANCE',
    'PM2_INSTANCE_ID',
    'PM2_HOME',
    'KUBERNETES_SERVICE_HOST',
    'CHATGPT_ENV_HAS_DIST',
    'CHATGPT_ENV_IN_DIST',
    'CHATGPT_ENV_IS_PRODUCTION',
    'AUDIT_RUNNER_TEST_FORCE_FATAL_FALLBACK',
    'ANALYZE',
    'BIND_ADDR',
    'CHROME_WSE',
    'CHROME_URL',
    'SERVER_HOST',
    'DB_PATH',
    'ARTIFACTS_DIR',
    'OLLAMA_HOST',
    'PORT',
    'CHROME_WS_PATH',
    'MOCK_CHROME_HOST',
    'MOCK_CHROME_PORT',
    'ROBOT_ID',
]);

function walk(/** @type {string} */ dirPath, /** @type {string[]} */ files = []) {
    let entries = [];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return files;
    }

    for (const entry of entries) {
        const abs = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
                continue;
            }
            walk(abs, files);
            continue;
        }
        if (entry.isFile()) {
            files.push(abs);
        }
    }
    return files;
}

function collectEnvVarsFromCode() {
    const files = SCAN_ROOTS.flatMap(rel => walk(path.join(ROOT, rel)));
    const vars = new Set();
    const pattern = /process\.env\.([A-Z0-9_]+)/g;

    for (const file of files) {
        let content = '';
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const match of content.matchAll(pattern)) {
            vars.add(match[1]);
        }
    }

    return [...vars].sort();
}

function collectEnvVarsFromTemplates() {
    const vars = new Set();
    const pattern = /^([A-Z_][A-Z0-9_]*)=/gm;

    for (const file of TEMPLATE_FILES) {
        const abs = path.join(ROOT, file);
        let content = '';
        try {
            content = fs.readFileSync(abs, 'utf8');
        } catch {
            continue;
        }
        for (const match of content.matchAll(pattern)) {
            vars.add(match[1]);
        }
    }

    return vars;
}

function main() {
    const codeVars = collectEnvVarsFromCode();
    const templateVars = collectEnvVarsFromTemplates();
    const uncovered = codeVars.filter(key => !templateVars.has(key) && !RUNTIME_ONLY.has(key));

    const report = {
        scanned_roots: SCAN_ROOTS,
        template_files: TEMPLATE_FILES,
        runtime_only_allowlist: [...RUNTIME_ONLY].sort(),
        code_var_count: codeVars.length,
        template_var_count: templateVars.size,
        uncovered_count: uncovered.length,
        uncovered,
    };

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(report, null, 2));
        process.exit(uncovered.length ? 2 : 0);
    }

    console.log('[env-audit] scanned roots:', SCAN_ROOTS.join(', '));
    console.log('[env-audit] templates:', TEMPLATE_FILES.join(', '));
    console.log('[env-audit] env vars referenced in code:', codeVars.length);
    console.log('[env-audit] env vars covered by templates:', templateVars.size);

    if (uncovered.length === 0) {
        console.log('[env-audit] OK: no uncovered env vars outside the runtime-only allowlist');
        process.exit(0);
    }

    console.log('[env-audit] uncovered env vars:');
    for (const key of uncovered) {
        console.log(`- ${key}`);
    }
    process.exit(2);
}

main();
