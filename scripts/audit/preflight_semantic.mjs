#!/usr/bin/env node
// @ts-check
import { parseArgs } from 'node:util';
import { parseJsonFromMixedOutput, runCommand } from './lib/exec.mjs';

/**
 * @typedef {object} SummarizeResultResult
 * @property {boolean} ok
 * @property {number|null} exitCode
 * @property {string} stdout
 * @property {string} stderr
 */
/**
 * @param {SummarizeResultResult} result
 */
function summarizeResult(result) {
    return {
        ok: result.ok,
        exit_code: result.exitCode,
        stderr: String(result.stderr || '').slice(0, 2000),
        stdout: String(result.stdout || '').slice(0, 2000),
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            json: { type: 'boolean', default: false },
            'no-fail': { type: 'boolean', default: false },
            'timeout-ms': { type: 'string', default: '180000' },
        },
    });

    const timeoutMs = Math.max(15000, Number(values['timeout-ms'] || 180000));

    const pm2Status = await runCommand('npm', ['run', 'daemon:status'], { timeoutMs });
    const mcpDiagnose = await runCommand('npm', ['run', 'mcp:diagnose'], { timeoutMs });
    const ragHealth = await runCommand('npm', ['run', 'rag:health', '--', '--json'], { timeoutMs });
    const lspHealth = await runCommand('npm', ['run', 'lsp:health', '--', '--json'], { timeoutMs });

    const ragJson = parseJsonFromMixedOutput(`${ragHealth.stdout}\n${ragHealth.stderr}`);
    const lspJson = parseJsonFromMixedOutput(`${lspHealth.stdout}\n${lspHealth.stderr}`);
    const ragOkFromText = /"ok"\s*:\s*true/.test(String(ragHealth.stdout || ''));
    const ragAvailableFromText = /"available"\s*:\s*true/.test(String(ragHealth.stdout || ''));

    const components = {
        pm2: {
            ...summarizeResult(pm2Status),
            ok: pm2Status.ok,
            details: pm2Status.ok ? 'daemon-status-ok' : 'daemon-status-failed',
        },
        mcp: {
            ...summarizeResult(mcpDiagnose),
            ok: mcpDiagnose.ok,
            details: mcpDiagnose.ok ? 'mcp-diagnose-ok' : 'mcp-diagnose-failed',
        },
        rag: {
            ...summarizeResult(ragHealth),
            ok: ragHealth.ok && Boolean(ragJson?.ok || ragOkFromText),
            available:
                ragJson && Object.prototype.hasOwnProperty.call(ragJson, 'available')
                    ? Boolean(ragJson.available)
                    : ragAvailableFromText
                      ? true
                      : null,
            details: ragHealth.ok ? 'rag-health-command-ok' : 'rag-health-command-failed',
        },
        lsp: {
            ...summarizeResult(lspHealth),
            ok: lspHealth.ok && Boolean(lspJson?.ok),
            lsp_tools_present: Boolean(lspJson?.lsp_tools_present),
            lsp_functional_ok: Boolean(lspJson?.lsp_functional_ok),
            details: lspHealth.ok ? 'lsp-health-command-ok' : 'lsp-health-command-failed',
        },
    };

    /** @type {string[]} */
    const issues = [];
    for (const [name, info] of Object.entries(components)) {
        if (!info.ok) {
            issues.push(`${name} not ready`);
        }
    }
    if (components.rag.ok && components.rag.available === false) {
        issues.push('rag index unavailable');
    }
    if (components.lsp.ok && !components.lsp.lsp_functional_ok) {
        issues.push('lsp functional checks failed');
    }

    const report = {
        ok: issues.length === 0,
        ts: new Date().toISOString(),
        timeout_ms: timeoutMs,
        components,
        issues,
    };

    if (values.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('[SEMANTIC PREFLIGHT]');
        console.log(`ok=${report.ok}`);
        console.log(
            `pm2=${components.pm2.ok} mcp=${components.mcp.ok} rag=${components.rag.ok} lsp=${components.lsp.ok}`
        );
        if (issues.length > 0) {
            console.log(`issues=${issues.join(' | ')}`);
        }
    }

    if (!report.ok && !values['no-fail']) {
        process.exit(1);
    }
    process.exit(0);
}

main().catch(error => {
    console.error(`[semantic-preflight] fatal: ${error?.message || String(error)}`);
    process.exit(1);
});
