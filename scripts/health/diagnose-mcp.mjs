// @ts-check
import 'dotenv/config';
import { parseArgs } from 'node:util';

const DEFAULT_BASE = process.env.MCP_DIAG_URL || 'http://localhost:3008';
const LSP_ENABLED = String(process.env.LSP_ENABLED || 'true') !== 'false';

const REQUIRED_CORE_TOOLS = [
    'rag_search',
    'rag_health',
    'rag_expand',
    'ollama_generate',
    'ollama_embed',
    'ollama_models',
];
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
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchJson(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }
    return { ok: res.ok, status: res.status, text, json };
}

/**
 * @typedef {object} PrintResultResult
 * @property {boolean} ok
 * @property {number} status
 * @property {string} text
 */
/**
 * @param {string} label
 * @param {PrintResultResult} result
 */
function printResult(label, result) {
    const status = `${result.status}${result.ok ? ' OK' : ' FAIL'}`;
    console.log(`${label}: ${status}`);
    if (!result.ok) {
        const preview = (result.text || '').slice(0, 500);
        if (preview) {
            console.log(preview);
        }
    }
}

/**
 * @param {string} base
 * @param {number} id
 * @param {string} name
 * @param {any} args
 */
async function callTool(base, id, name, args) {
    return fetchJson(`${base}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    });
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
    const filePath = String(values.file || 'src/main.js');
    const line = Math.max(1, Number(values.line || 1));
    const character = Math.max(1, Number(values.character || 1));

    console.log(`[MCP DIAG] Base: ${base}`);

    const health = await fetchJson(`${base}/health`);
    printResult('GET /health', health);

    const ready = await fetchJson(`${base}/ready`);
    printResult('GET /ready', ready);
    if (ready.ok && ready.json?.mcp) {
        console.log(`[MCP DIAG] ready.mcp: ${JSON.stringify(ready.json.mcp)}`);
    }
    if (ready.ok && ready.json?.rag) {
        console.log(`[MCP DIAG] ready.rag: ${JSON.stringify(ready.json.rag)}`);
    }

    const discovery = await fetchJson(`${base}/api/mcp`);
    printResult('GET /api/mcp', discovery);

    const ping = await fetchJson(`${base}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
    });
    printResult('POST /api/mcp ping', ping);

    const toolsList = await fetchJson(`${base}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    printResult('POST /api/mcp tools/list', toolsList);

    const toolNames = Array.isArray(toolsList.json?.result?.tools)
        ? toolsList.json.result.tools.map((/** @type {any} */ item) => item?.name).filter(Boolean)
        : [];
    if (toolNames.length > 0) {
        console.log(`[MCP DIAG] tools/list count: ${toolNames.length}`);
    }

    const missingCoreTools = REQUIRED_CORE_TOOLS.filter((/** @type {any} */ name) => !toolNames.includes(name));
    const missingLspTools = LSP_ENABLED
        ? REQUIRED_LSP_TOOLS.filter((/** @type {any} */ name) => !toolNames.includes(name))
        : [];
    const lspToolsPresent = !LSP_ENABLED || missingLspTools.length === 0;

    const ragProbe = await callTool(base, 3, 'rag_search', {
        query: 'CHROME_PROXY_PORT',
        topK: 1,
        mode: 'auto',
        includeDiagnostics: true,
    });
    printResult('POST /api/mcp tools/call rag_search', ragProbe);
    const ragStructured = ragProbe?.json?.result?.structuredContent;
    if (ragProbe.ok && ragStructured?.data) {
        const backend = ragStructured.data.backend;
        const degraded = ragStructured.data.degraded;
        const indexMode = ragStructured.data.index_mode;
        const freshness = ragStructured.data.index_freshness_ms;
        console.log(
            `[MCP DIAG] rag_search backend=${backend} degraded=${degraded} index_mode=${indexMode || 'unknown'} freshness_ms=${typeof freshness === 'number' ? freshness : 'n/a'}`,
        );
    }

    const firstChunkId = ragStructured?.data?.results?.[0]?.chunk_id || null;
    const ragExpandProbe = await callTool(
        base,
        4,
        'rag_expand',
        firstChunkId
            ? { chunk_id: firstChunkId, mode: 'lines', before_lines: 20, after_lines: 20 }
            : { chunk_id: '__diag_missing_chunk__', mode: 'lines', before_lines: 5, after_lines: 5 },
    );
    printResult('POST /api/mcp tools/call rag_expand', ragExpandProbe);

    let lspFunctionalOk = false;
    /** @type {any[]} */
    let lspFunctionalIssues = [];
    if (LSP_ENABLED && lspToolsPresent) {
        const lspDiagnostics = await callTool(base, 5, 'lsp_diagnostics', { filePath, maxResults: 20 });
        const lspDefinition = await callTool(base, 6, 'lsp_definition', { filePath, line, character, maxResults: 20 });

        const diagnosticsData = lspDiagnostics.json?.result?.structuredContent?.data;
        const definitionData = lspDefinition.json?.result?.structuredContent?.data;
        const diagnosticsOk =
            lspDiagnostics.ok && !lspDiagnostics.json?.error && Array.isArray(diagnosticsData?.diagnostics);
        const definitionOk = lspDefinition.ok && !lspDefinition.json?.error && Array.isArray(definitionData?.locations);
        lspFunctionalOk = diagnosticsOk && definitionOk;

        if (!diagnosticsOk) {
            lspFunctionalIssues.push('lsp_diagnostics failed functional contract');
        }
        if (!definitionOk) {
            lspFunctionalIssues.push('lsp_definition failed functional contract');
        }
    } else if (!LSP_ENABLED) {
        lspFunctionalOk = true;
    } else {
        lspFunctionalIssues = ['LSP tools missing from tools/list'];
    }

    const githubProxyEnabled = String(process.env.MCP_GITHUB_PROXY_ENABLED || '') === 'true';
    let githubToolsOk = true;
    if (githubProxyEnabled && toolNames.length > 0) {
        const prefix = String(process.env.MCP_GITHUB_TOOL_PREFIX || 'mcp_github__');
        const count = toolNames.filter((/** @type {any} */ name) => String(name).startsWith(prefix)).length;
        githubToolsOk = count > 0;
    }

    const report = {
        ok:
            health.ok &&
            ready.ok &&
            discovery.ok &&
            ping.ok &&
            toolsList.ok &&
            ragProbe.ok &&
            ragExpandProbe.ok &&
            missingCoreTools.length === 0 &&
            missingLspTools.length === 0 &&
            lspFunctionalOk &&
            githubToolsOk,
        base,
        mcp_ok: health.ok && ready.ok && discovery.ok && ping.ok && toolsList.ok,
        tools_count: toolNames.length,
        missing_core_tools: missingCoreTools,
        lsp_enabled: LSP_ENABLED,
        lsp_tools_present: lspToolsPresent,
        missing_lsp_tools: missingLspTools,
        lsp_functional_ok: lspFunctionalOk,
        lsp_functional_issues: lspFunctionalIssues,
        rag_probe_ok: ragProbe.ok,
        rag_expand_ok: ragExpandProbe.ok,
        github_tools_ok: githubToolsOk,
    };

    if (values.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        if (missingCoreTools.length > 0) {
            console.error(`[MCP DIAG] missing core tools: ${missingCoreTools.join(', ')}`);
        }
        if (missingLspTools.length > 0) {
            console.error(`[MCP DIAG] missing LSP tools: ${missingLspTools.join(', ')}`);
        }
        console.log(`[MCP DIAG] lsp_tools_present=${report.lsp_tools_present}`);
        console.log(`[MCP DIAG] lsp_functional_ok=${report.lsp_functional_ok}`);
        if (lspFunctionalIssues.length > 0) {
            console.log(`[MCP DIAG] lsp_functional_issues=${lspFunctionalIssues.join(' | ')}`);
        }
    }

    if (!report.ok) {
        process.exit(1);
    }
    console.log('[MCP DIAG] OK');
}

main().catch((error) => {
    console.error(`[MCP DIAG] Fatal: ${error?.message || String(error)}`);
    process.exit(1);
});
