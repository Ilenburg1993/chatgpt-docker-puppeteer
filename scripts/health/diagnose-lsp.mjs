#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import { parseArgs } from 'node:util';

const DEFAULT_BASE = process.env.MCP_DIAG_URL || 'http://localhost:3008';
const REQUIRED_LSP_TOOLS = [
    'lsp_definition',
    'lsp_references',
    'lsp_hover',
    'lsp_document_symbols',
    'lsp_workspace_symbols',
    'lsp_diagnostics',
    'lsp_code_actions',
    'lsp_apply_code_action',
];

/**
 * @param {string} base
 * @param {string} method
 * @param {object} params
 * @param {number} id
 * @returns {Promise<{ ok: boolean, status: number, json: any, text: string }>}
 */
async function callMcp(base, method, params, id) {
    const url = `${base}/api/mcp`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
}

/**
 * @param {string} base
 */
async function fetchHealth(base) {
    const response = await fetch(`${base}/health`);
    return { ok: response.ok, status: response.status };
}

/**
 * @param {any} payload
 * @returns {string[]}
 */
function toolNamesFromList(payload) {
    const tools = payload?.result?.tools;
    if (!Array.isArray(tools)) {
        return [];
    }
    return tools
        .map(item => item?.name)
        .filter(Boolean);
}

/**
 * @param {any} response
 * @param {string} op
 */
function evaluateFunctionalResponse(response, op) {
    if (!response.ok || response.json?.error) {
        return { ok: false, reason: `${op} HTTP/MCP error` };
    }
    const data = response.json?.result?.structuredContent?.data;
    if (!data || typeof data !== 'object') {
        return { ok: false, reason: `${op} missing structuredContent.data` };
    }
    if (op === 'lsp_diagnostics' && !Array.isArray(data.diagnostics)) {
        return { ok: false, reason: 'lsp_diagnostics returned invalid diagnostics payload' };
    }
    if (op === 'lsp_definition' && !Array.isArray(data.locations)) {
        return { ok: false, reason: 'lsp_definition returned invalid locations payload' };
    }
    return { ok: true, reason: 'ok' };
}

async function main() {
    const { values } = parseArgs({
        options: {
            json: { type: 'boolean', default: false },
            base: { type: 'string', default: DEFAULT_BASE },
            file: { type: 'string', default: 'src/main.js' },
            line: { type: 'string', default: '1' },
            character: { type: 'string', default: '1' },
        },
    });

    const base = String(values.base || DEFAULT_BASE).replace(/\/+$/, '');
    const targetFile = path.normalize(String(values.file || 'src/main.js'));
    const line = Math.max(1, Number(values.line || 1));
    const character = Math.max(1, Number(values.character || 1));

    /** @type {string[]} */
    const issues = [];

    const health = await fetchHealth(base).catch(() => ({ ok: false, status: 0 }));
    if (!health.ok) {
        issues.push(`health endpoint unavailable (${health.status})`);
    }

    const toolsList = await callMcp(base, 'tools/list', {}, 1).catch(() => ({
        ok: false,
        status: 0,
        json: null,
        text: '',
    }));

    const toolNames = toolNamesFromList(toolsList.json);
    const missingTools = REQUIRED_LSP_TOOLS.filter(name => !toolNames.includes(name));
    if (missingTools.length > 0) {
        issues.push(`missing LSP tools: ${missingTools.join(', ')}`);
    }

    const diagnosticsCall = await callMcp(
        base,
        'tools/call',
        { name: 'lsp_diagnostics', arguments: { filePath: targetFile, maxResults: 20 } },
        2
    ).catch(() => ({
        ok: false,
        status: 0,
        json: null,
        text: '',
    }));
    const diagnosticsEval = evaluateFunctionalResponse(diagnosticsCall, 'lsp_diagnostics');
    if (!diagnosticsEval.ok) {
        issues.push(diagnosticsEval.reason);
    }

    const definitionCall = await callMcp(
        base,
        'tools/call',
        { name: 'lsp_definition', arguments: { filePath: targetFile, line, character, maxResults: 20 } },
        3
    ).catch(() => ({
        ok: false,
        status: 0,
        json: null,
        text: '',
    }));
    const definitionEval = evaluateFunctionalResponse(definitionCall, 'lsp_definition');
    if (!definitionEval.ok) {
        issues.push(definitionEval.reason);
    }

    const report = {
        ok: issues.length === 0,
        base,
        target_file: targetFile,
        health_ok: health.ok,
        mcp_tools_list_ok: toolsList.ok && !toolsList.json?.error,
        lsp_tools_present: missingTools.length === 0,
        lsp_tools_missing: missingTools,
        lsp_functional_ok: diagnosticsEval.ok && definitionEval.ok,
        checks: {
            lsp_diagnostics: diagnosticsEval,
            lsp_definition: definitionEval,
        },
        issues,
    };

    if (values.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('[LSP DIAG]');
        console.log(`base=${report.base}`);
        console.log(`health_ok=${report.health_ok}`);
        console.log(`lsp_tools_present=${report.lsp_tools_present}`);
        console.log(`lsp_functional_ok=${report.lsp_functional_ok}`);
        if (issues.length > 0) {
            console.log(`issues=${issues.join(' | ')}`);
        }
    }

    process.exit(report.ok ? 0 : 1);
}

main().catch(error => {
    console.error(`[LSP DIAG] Fatal: ${error?.message || String(error)}`);
    process.exit(1);
});
