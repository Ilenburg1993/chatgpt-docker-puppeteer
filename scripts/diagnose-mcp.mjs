// @ts-check
import 'dotenv/config';

const BASE = process.env.MCP_DIAG_URL || 'http://localhost:3008';

async function fetchJson(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (_e) {
        // keep null
    }
    return { ok: res.ok, status: res.status, text, json };
}

function printResult(label, r) {
    const status = `${r.status}${r.ok ? ' OK' : ' FAIL'}`;
    console.log(`${label}: ${status}`);
    if (!r.ok) {
        const preview = (r.text || '').slice(0, 500);
        if (preview) console.log(preview);
    }
}

async function main() {
    console.log(`[MCP DIAG] Base: ${BASE}`);

    const health = await fetchJson(`${BASE}/health`);
    printResult('GET /health', health);

    const ready = await fetchJson(`${BASE}/ready`);
    printResult('GET /ready', ready);
    /** @type {any} */
    const readyJson = ready.ok ? ready.json : null;
    if (ready.ok && ready.json && typeof ready.json === 'object') {
        const mcp = ready.json.mcp || (ready.json.runtime && ready.json.runtime.mcp !== undefined ? { runtime_mcp: ready.json.runtime.mcp } : null);
        if (mcp) console.log(`[MCP DIAG] ready.mcp: ${JSON.stringify(mcp)}`);
        if (ready.json.rag) console.log(`[MCP DIAG] ready.rag: ${JSON.stringify(ready.json.rag)}`);

        const upstreams = mcp && Array.isArray(mcp.upstreams) ? mcp.upstreams : null;
        if (upstreams && upstreams.length > 0) {
            console.log('[MCP DIAG] ready.mcp.upstreams:');
            for (const u of upstreams) {
                const flags = [
                    u?.enabled === false ? 'disabled' : 'enabled',
                    u?.ready ? 'ready' : 'not-ready',
                    u?.required ? 'required' : 'optional'
                ].filter(Boolean).join(',');
                const err = u?.lastError ? ` err="${String(u.lastError).slice(0, 160)}"` : '';
                console.log(`  - ${u.alias} (${u.transport}) prefix=${u.toolPrefix} target=${u.target} [${flags}] tools=${u.registeredCount}${err}`);
            }
        }
    }

    const discovery = await fetchJson(`${BASE}/api/mcp`);
    printResult('GET /api/mcp', discovery);

    const ping = await fetchJson(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
    });
    printResult('POST /api/mcp ping', ping);

    const toolsList = await fetchJson(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    });
    printResult('POST /api/mcp tools/list', toolsList);

    let fail = false;
    const toolNames =
        toolsList.ok && toolsList.json?.result?.tools && Array.isArray(toolsList.json.result.tools)
            ? toolsList.json.result.tools.map(t => t?.name).filter(Boolean)
            : [];

    if (toolNames.length > 0) {
        console.log(`[MCP DIAG] tools/list count: ${toolNames.length}`);
    }

    const requiredCoreTools = ['rag_search', 'rag_health', 'rag_expand', 'ollama_generate', 'ollama_embed', 'ollama_models'];
    for (const toolName of requiredCoreTools) {
        if (!toolNames.includes(toolName)) {
            console.error(`[MCP DIAG] FAIL: missing required tool "${toolName}"`);
            fail = true;
        }
    }

    if (String(process.env.LSP_ENABLED || 'true') !== 'false') {
        const requiredLspTools = [
            'lsp_definition',
            'lsp_references',
            'lsp_hover',
            'lsp_document_symbols',
            'lsp_workspace_symbols',
            'lsp_diagnostics',
            'lsp_code_actions',
            'lsp_apply_code_action'
        ];
        for (const toolName of requiredLspTools) {
            if (!toolNames.includes(toolName)) {
                console.error(`[MCP DIAG] FAIL: missing LSP tool "${toolName}"`);
                fail = true;
            }
        }
    }

    // If /ready includes upstreams, show how many tools were imported per prefix.
    try {
        const upstreams = readyJson?.mcp?.upstreams;
        if (Array.isArray(upstreams) && upstreams.length > 0 && toolNames.length > 0) {
            console.log('[MCP DIAG] Imported tools by upstream:');
            for (const u of upstreams) {
                const prefix = String(u?.toolPrefix || '');
                if (!prefix) continue;
                const count = toolNames.filter(n => String(n).startsWith(prefix)).length;
                console.log(`  - ${u.alias}: ${count} tool(s) (prefix=${prefix})`);
            }
        }
    } catch {
        // ignore
    }

    // Expectation: if GitHub proxy is enabled locally, tools should exist with the configured prefix.
    const githubProxyEnabled = String(process.env.MCP_GITHUB_PROXY_ENABLED || '') === 'true';
    if (githubProxyEnabled && toolNames.length > 0) {
        const prefix = String(process.env.MCP_GITHUB_TOOL_PREFIX || 'mcp_github__');
        const count = toolNames.filter(n => String(n).startsWith(prefix)).length;
        if (count === 0) {
            console.error(`[MCP DIAG] FAIL: MCP_GITHUB_PROXY_ENABLED=true but no tools found with prefix "${prefix}"`);
            fail = true;
        }
    }

    // Validate rag_search structured output (backend/degraded shape)
    const ragProbe = await fetchJson(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'rag_search',
                arguments: {
                    query: 'CHROME_PROXY_PORT',
                    topK: 1,
                    mode: 'auto',
                    includeDiagnostics: true
                }
            }
        })
    });
    printResult('POST /api/mcp tools/call rag_search', ragProbe);
    const ragStructured = ragProbe?.json?.result?.structuredContent;
    if (ragProbe.ok && ragStructured?.flags) {
        console.log(`[MCP DIAG] rag_search flags: ${JSON.stringify(ragStructured.flags)}`);
    }
    if (ragProbe.ok && ragStructured?.data) {
        const backend = ragStructured.data.backend;
        const degraded = ragStructured.data.degraded;
        const indexMode = ragStructured.data.index_mode;
        const freshness = ragStructured.data.index_freshness_ms;
        const indexUpdatedAt = ragStructured.data.index_updated_at_iso;
        console.log(
            `[MCP DIAG] rag_search backend=${backend} degraded=${degraded} ` +
            `index_mode=${indexMode || 'unknown'} freshness_ms=${typeof freshness === 'number' ? freshness : 'n/a'}`
        );
        if (indexUpdatedAt) {
            console.log(`[MCP DIAG] rag_search index_updated_at=${indexUpdatedAt}`);
        }
    }

    const firstChunkId = ragStructured?.data?.results?.[0]?.chunk_id || null;
    const ragExpandProbe = await fetchJson(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'rag_expand',
                arguments: firstChunkId
                    ? {
                        chunk_id: firstChunkId,
                        mode: 'lines',
                        before_lines: 20,
                        after_lines: 20
                    }
                    : {
                        chunk_id: '__diag_missing_chunk__',
                        mode: 'lines',
                        before_lines: 5,
                        after_lines: 5
                    }
            }
        })
    });
    printResult('POST /api/mcp tools/call rag_expand', ragExpandProbe);

    const ragExpandStructured = ragExpandProbe?.json?.result?.structuredContent;
    const ragExpandData = ragExpandStructured?.data || {};
    if (ragExpandProbe.ok) {
        console.log(
            `[MCP DIAG] rag_expand ok=${Boolean(ragExpandData.ok)} ` +
            `reason_code=${ragExpandData.reason_code || 'none'} mode=${ragExpandData.mode || 'n/a'}`
        );
    }

    if (!health.ok || !ready.ok || !discovery.ok || !ping.ok || !toolsList.ok || !ragProbe.ok || !ragExpandProbe.ok || fail) process.exit(1);
    console.log('[MCP DIAG] OK');
}

main().catch((err) => {
    console.error(`[MCP DIAG] Fatal: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
});
