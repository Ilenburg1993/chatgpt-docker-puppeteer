#!/usr/bin/env node
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

const EXIT = Object.freeze({
    OK: 0,
    OLLAMA_UNAVAILABLE: 2,
    PM2_START_FAILED: 3,
    MCP_HEALTH_FAILED: 4,
    MCP_DIAG_FAILED: 5,
    RAG_RESET_FAILED: 6,
    RAG_INDEX_FAILED: 7,
    RAG_HEALTH_FAILED: 8,
    MCP_SMOKE_FAILED: 9,
    ARG_ERROR: 10
});

const { values } = parseArgs({
    options: {
        profile: { type: 'string', default: 'full' },
        'include-glob': { type: 'string', multiple: true },
        'exclude-glob': { type: 'string', multiple: true },
        'docs-mode': { type: 'string' },
        'max-file-bytes': { type: 'string' },
        'skip-pm2': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false }
    }
});

const baseUrl = process.env.MCP_DIAG_URL || 'http://localhost:3008';
const report = {
    ok: false,
    profile: values.profile || 'full',
    skipPm2: Boolean(values['skip-pm2']),
    baseUrl,
    steps: [],
    startedAt: new Date().toISOString(),
    finishedAt: null
};

function addStep(name, ok, details = {}) {
    report.steps.push({
        name,
        ok: Boolean(ok),
        at: new Date().toISOString(),
        ...details
    });
}

function log(msg) {
    if (!values.json) {
        console.log(msg);
    }
}

function logError(msg) {
    if (!values.json) {
        console.error(msg);
    }
}

async function runCommand(label, cmd, args, { allowFailure = false } = {}) {
    log(`[RAG Rebuild] ${label}: ${cmd} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            stdio: 'inherit',
            env: process.env
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0 || allowFailure) {
                resolve(code ?? 0);
                return;
            }
            reject(new Error(`${label} failed with exit code ${code}`));
        });
    });
}

async function fetchJson(url, init) {
    const response = await fetch(url, init);
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { ok: response.ok, status: response.status, text, json };
}

async function waitForHttp(url, timeoutMs = 90000, intervalMs = 2000) {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await fetchJson(url);
            if (res.ok) return res;
            lastError = new Error(`HTTP ${res.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Timeout waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

async function isPm2FullyOnline() {
    return new Promise((resolve) => {
        const child = spawn('npx', ['pm2', 'jlist'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env
        });

        let stdout = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });

        child.on('error', () => resolve(false));
        child.on('exit', (code) => {
            if (code !== 0) {
                resolve(false);
                return;
            }
            try {
                const parsed = JSON.parse(stdout || '[]');
                const required = new Set(['agente-gpt', 'dashboard-web', 'chrome-proxy']);
                const online = new Set(
                    parsed
                        .filter((proc) => proc?.pm2_env?.status === 'online')
                        .map((proc) => proc?.name)
                        .filter(Boolean)
                );
                resolve([...required].every((name) => online.has(name)));
            } catch {
                resolve(false);
            }
        });
    });
}

async function smokeRagSearch() {
    const payload = {
        jsonrpc: '2.0',
        id: 91,
        method: 'tools/call',
        params: {
            name: 'rag_search',
            arguments: {
                query: 'MCP tool timeout',
                topK: 1,
                profile: 'core',
                mode: 'auto',
                includeDiagnostics: true
            }
        }
    };

    const res = await fetchJson(`${baseUrl}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        throw new Error(`rag_search MCP call failed with status ${res.status}`);
    }

    const hasContent = Array.isArray(res?.json?.result?.content);
    if (!hasContent) {
        throw new Error('rag_search MCP response missing result.content');
    }

    return res?.json?.result?.structuredContent || null;
}

async function main() {
    try {
        const profile = String(values.profile || 'full').trim();
        if (!profile) {
            addStep('validate-args', false, { reason: 'invalid profile' });
            report.finishedAt = new Date().toISOString();
            if (values.json) console.log(JSON.stringify(report, null, 2));
            process.exit(EXIT.ARG_ERROR);
        }
        addStep('validate-args', true, { profile });

        const ollamaVersion = await fetchJson('http://host.docker.internal:11434/api/version');
        if (!ollamaVersion.ok) {
            addStep('check-ollama', false, { status: ollamaVersion.status });
            throw Object.assign(new Error('Ollama local unavailable'), { exitCode: EXIT.OLLAMA_UNAVAILABLE });
        }
        addStep('check-ollama', true, { version: ollamaVersion?.json?.version || null });

        if (!values['skip-pm2']) {
            const pm2Online = await isPm2FullyOnline();
            if (!pm2Online) {
                try {
                    await runCommand('daemon:start', 'npm', ['run', 'daemon:start']);
                } catch (error) {
                    addStep('pm2-start', false, { reason: error.message });
                    throw Object.assign(error, { exitCode: EXIT.PM2_START_FAILED });
                }
                addStep('pm2-start', true, { action: 'started' });
            } else {
                addStep('pm2-start', true, { action: 'already-online' });
            }
        } else {
            addStep('pm2-start', true, { action: 'skipped' });
        }

        try {
            await waitForHttp(`${baseUrl}/health`, 90000, 2000);
            await waitForHttp(`${baseUrl}/api/mcp`, 90000, 2000);
            addStep('wait-mcp-http', true);
        } catch (error) {
            addStep('wait-mcp-http', false, { reason: error.message });
            throw Object.assign(error, { exitCode: EXIT.MCP_HEALTH_FAILED });
        }

        try {
            await runCommand('mcp:diagnose', 'npm', ['run', 'mcp:diagnose']);
            addStep('mcp-diagnose', true);
        } catch (error) {
            addStep('mcp-diagnose', false, { reason: error.message });
            throw Object.assign(error, { exitCode: EXIT.MCP_DIAG_FAILED });
        }

        try {
            await runCommand('rag:reset', 'npm', ['run', 'rag:reset', '--', '--yes']);
            addStep('rag-reset', true);
        } catch (error) {
            addStep('rag-reset', false, { reason: error.message });
            throw Object.assign(error, { exitCode: EXIT.RAG_RESET_FAILED });
        }

        try {
            const ragIndexArgs = ['run', 'rag:index', '--', '--profile', profile];
            if (values['docs-mode']) {
                ragIndexArgs.push('--docs-mode', String(values['docs-mode']));
            }
            if (values['max-file-bytes']) {
                ragIndexArgs.push('--max-file-bytes', String(values['max-file-bytes']));
            }
            for (const includeGlob of values['include-glob'] || []) {
                ragIndexArgs.push('--include-glob', String(includeGlob));
            }
            for (const excludeGlob of values['exclude-glob'] || []) {
                ragIndexArgs.push('--exclude-glob', String(excludeGlob));
            }
            await runCommand('rag:index', 'npm', ragIndexArgs);
            addStep('rag-index', true, {
                profile,
                docsMode: values['docs-mode'] || process.env.RAG_DOCS_MODE || 'include',
                includeGlobs: values['include-glob'] || [],
                excludeGlobs: values['exclude-glob'] || [],
                maxFileBytes: values['max-file-bytes'] ? Number(values['max-file-bytes']) : null
            });
        } catch (error) {
            addStep('rag-index', false, { reason: error.message, profile });
            throw Object.assign(error, { exitCode: EXIT.RAG_INDEX_FAILED });
        }

        try {
            await runCommand('rag:health', 'npm', ['run', 'rag:health', '--', '--json']);
            addStep('rag-health', true);
        } catch (error) {
            addStep('rag-health', false, { reason: error.message });
            throw Object.assign(error, { exitCode: EXIT.RAG_HEALTH_FAILED });
        }

        try {
            const smokeStructured = await smokeRagSearch();
            addStep('mcp-rag-smoke', true, { structured: smokeStructured });
        } catch (error) {
            addStep('mcp-rag-smoke', false, { reason: error.message });
            throw Object.assign(error, { exitCode: EXIT.MCP_SMOKE_FAILED });
        }

        report.ok = true;
        report.finishedAt = new Date().toISOString();
        if (values.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            log('[RAG Rebuild] ✅ Rebuild do zero concluído com sucesso.');
        }
        process.exit(EXIT.OK);
    } catch (error) {
        report.ok = false;
        report.error = error?.message || String(error);
        report.finishedAt = new Date().toISOString();
        if (values.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            logError(`[RAG Rebuild] ❌ Falha: ${report.error}`);
        }
        process.exit(error?.exitCode || 1);
    }
}

main();
