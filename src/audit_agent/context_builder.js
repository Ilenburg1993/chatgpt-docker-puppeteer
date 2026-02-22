// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

function parseJsonSafe(text, fallback = null) {
    try {
        return text ? JSON.parse(String(text)) : fallback;
    } catch {
        return fallback;
    }
}

function getServerBaseUrl() {
    const host = process.env.DASHBOARD_API_HOST || process.env.SERVER_HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 3008);
    return `http://${host}:${port}`;
}

async function runNodeScript(scriptArgs, timeoutMs = 10000) {
    try {
        /** @type {Record<string, string|undefined>} */
        const childEnv = { ...process.env, FORCE_COLOR: '0' };
        delete childEnv.NO_COLOR;
        const { stdout, stderr } = await execFile('npm', scriptArgs, {
            timeout: timeoutMs,
            maxBuffer: 2 * 1024 * 1024,
            env: childEnv,
            cwd: process.cwd(),
        });
        return { ok: true, stdout, stderr };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error),
            stdout: error?.stdout || '',
            stderr: error?.stderr || '',
        };
    }
}

async function probeInferenceGateway() {
    const host = process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
    const port = Number(process.env.INFERENCE_GATEWAY_PORT || 3099);
    const baseUrl = `http://${host}:${port}`;
    try {
        const [healthRes, modelsRes] = await Promise.all([
            fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) }),
            fetch(`${baseUrl}/v1/models`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ clientTag: 'diagnostics_probe' }),
                signal: AbortSignal.timeout(2500),
            }),
        ]);
        const health = parseJsonSafe(await healthRes.text(), null);
        const models = parseJsonSafe(await modelsRes.text(), null);
        return {
            ok: healthRes.ok,
            status: healthRes.status,
            models_ok: modelsRes.ok,
            models_count: Array.isArray(models?.models) ? models.models.length : null,
            health,
        };
    } catch (error) {
        return { ok: false, status: null, error: error?.message || String(error) };
    }
}

async function callMcpTool(name, args, { timeoutMs = 5000, id = 1 } = {}) {
    const baseUrl = getServerBaseUrl();
    try {
        const res = await fetch(`${baseUrl}/api/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id,
                method: 'tools/call',
                params: { name, arguments: args || {} },
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        const json = parseJsonSafe(text, null);
        return {
            ok: res.ok && !json?.error,
            status: res.status,
            json,
            text,
        };
    } catch (error) {
        return {
            ok: false,
            status: null,
            error: error?.message || String(error),
            json: null,
            text: '',
        };
    }
}

async function collectMcpSemanticContext(job) {
    const scope = job?.scope_json && typeof job.scope_json === 'object' ? job.scope_json : {};
    const filePath = String(scope.filePath || scope.file_path || 'src/main.js');
    const line = Math.max(1, Number(scope.line || 1));
    const character = Math.max(1, Number(scope.character || 1));
    const query = String(scope.query || scope.rag_query || 'AUDIT_AGENT');
    const mcpBudget = Math.max(1, Math.min(Number(scope.mcp_budget || process.env.AUDIT_AGENT_CONTEXT_MCP_BUDGET || 5) || 5, 8));
    let budgetUsed = 0;

    const canSpend = () => budgetUsed < mcpBudget;
    const spend = () => {
        budgetUsed += 1;
    };

    spend();
    spend();
    const [lspDiagnostics, ragSearch] = await Promise.all([
        callMcpTool('lsp_diagnostics', { filePath, maxResults: 20 }, { timeoutMs: 5000, id: 201 }),
        callMcpTool('rag_search', { query, topK: 2, mode: 'auto', includeDiagnostics: true }, { timeoutMs: 8000, id: 202 }),
    ]);

    const lspData = lspDiagnostics.json?.result?.structuredContent?.data || null;
    const ragData = ragSearch.json?.result?.structuredContent?.data || null;

    // Optional targeted definition probe when diagnostics path is usable.
    let lspDefinition = null;
    if (lspDiagnostics.ok) {
        if (canSpend()) {
            spend();
        lspDefinition = await callMcpTool(
            'lsp_definition',
            { filePath, line, character, maxResults: 10 },
            { timeoutMs: 5000, id: 203 }
        );
        }
    }
    const defData = lspDefinition?.json?.result?.structuredContent?.data || null;

    /** @type {any} */
    let ragExpand = null;
    const firstChunkId = ragData?.results?.[0]?.chunk_id || null;
    if (ragSearch.ok && firstChunkId && canSpend()) {
        spend();
        ragExpand = await callMcpTool(
            'rag_expand',
            { chunk_id: firstChunkId, mode: 'lines', before_lines: 20, after_lines: 20 },
            { timeoutMs: 5000, id: 204 }
        );
    }
    const ragExpandData = ragExpand?.json?.result?.structuredContent?.data || null;

    /** @type {any} */
    let lspReferences = null;
    if (lspDefinition?.ok && canSpend()) {
        spend();
        lspReferences = await callMcpTool(
            'lsp_references',
            { filePath, line, character, maxResults: 20 },
            { timeoutMs: 5000, id: 205 }
        );
    }
    const refsData = lspReferences?.json?.result?.structuredContent?.data || null;

    /** @type {any} */
    let lspDocumentSymbols = null;
    if (canSpend()) {
        spend();
        lspDocumentSymbols = await callMcpTool(
            'lsp_document_symbols',
            { filePath, maxResults: 100 },
            { timeoutMs: 5000, id: 206 }
        );
    }
    const symbolsData = lspDocumentSymbols?.json?.result?.structuredContent?.data || null;

    return {
        tools: {
            lsp_diagnostics: {
                ok: lspDiagnostics.ok,
                status: lspDiagnostics.status,
                diagnostics_count: Array.isArray(lspData?.diagnostics) ? lspData.diagnostics.length : null,
            },
            lsp_definition: lspDefinition
                ? {
                      ok: lspDefinition.ok,
                      status: lspDefinition.status,
                      locations_count: Array.isArray(defData?.locations) ? defData.locations.length : null,
                  }
                : { ok: false, status: null, skipped: true },
            rag_search: {
                ok: ragSearch.ok,
                status: ragSearch.status,
                backend: ragData?.backend || null,
                degraded: ragData?.degraded ?? null,
                results_count: Array.isArray(ragData?.results) ? ragData.results.length : null,
            },
            rag_expand: ragExpand
                ? {
                      ok: ragExpand.ok,
                      status: ragExpand.status,
                      chunk_id: firstChunkId,
                      content_present: Boolean(ragExpandData?.content || ragExpandData?.lines),
                  }
                : { ok: false, status: null, skipped: true },
            lsp_references: lspReferences
                ? {
                      ok: lspReferences.ok,
                      status: lspReferences.status,
                      locations_count: Array.isArray(refsData?.locations) ? refsData.locations.length : null,
                  }
                : { ok: false, status: null, skipped: true },
            lsp_document_symbols: lspDocumentSymbols
                ? {
                      ok: lspDocumentSymbols.ok,
                      status: lspDocumentSymbols.status,
                      symbols_count: Array.isArray(symbolsData?.symbols) ? symbolsData.symbols.length : null,
                  }
                : { ok: false, status: null, skipped: true },
            budget: {
                limit: mcpBudget,
                used: budgetUsed,
                remaining: Math.max(0, mcpBudget - budgetUsed),
            },
        },
        raw: {
            lsp_diagnostics: lspDiagnostics.json || null,
            lsp_definition: lspDefinition?.json || null,
            rag_search: ragSearch.json || null,
            rag_expand: ragExpand?.json || null,
            lsp_references: lspReferences?.json || null,
            lsp_document_symbols: lspDocumentSymbols?.json || null,
        },
    };
}

function deriveContextFindings(context) {
    /** @type {any[]} */
    const findings = [];
    const runtime = context.runtime || {};
    const mcp = runtime.mcp || {};
    const rag = runtime.rag || {};
    const lsp = runtime.lsp || {};
    const inf = context.inference_gateway || {};
    const mcpTools = context.mcp_tools || {};

    if (!mcp.ok) {
        findings.push({
            severity: 'warning',
            category: 'runtime',
            title: 'MCP indisponível no contexto do Audit Agent',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:not-ok',
            evidence: { probe: 'mcp:diagnose', details: mcp },
        });
    }
    if (rag.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'runtime',
            title: 'RAG degradado/indisponível',
            source: 'audit-agent',
            dedup_key: 'ctx:rag:not-ok',
            evidence: { probe: 'rag:health', details: rag },
        });
    }
    if (lsp.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'semantic',
            title: 'LSP/TSServer degradado (fallback lexical)',
            source: 'audit-agent',
            dedup_key: 'ctx:lsp:not-ok',
            evidence: { probe: 'lsp:health', details: lsp },
        });
    }
    if (inf.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'inference',
            title: 'Inference Gateway indisponível',
            source: 'audit-agent',
            dedup_key: 'ctx:inference-gateway:not-ok',
            evidence: { details: inf },
        });
    }

    if (mcpTools.lsp_diagnostics && mcpTools.lsp_diagnostics.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'semantic',
            title: 'MCP lsp_diagnostics falhou no context builder',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:lsp_diagnostics:fail',
            evidence: { tool: 'lsp_diagnostics', details: mcpTools.lsp_diagnostics },
        });
    }
    if (mcpTools.rag_search && mcpTools.rag_search.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'context',
            title: 'MCP rag_search falhou no context builder',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:rag_search:fail',
            evidence: { tool: 'rag_search', details: mcpTools.rag_search },
        });
    }
    if (mcpTools.rag_expand && mcpTools.rag_expand.ok === false && !mcpTools.rag_expand.skipped) {
        findings.push({
            severity: 'info',
            category: 'context',
            title: 'MCP rag_expand não disponível para enriquecimento (seguindo sem expand)',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:rag_expand:fail',
            evidence: { tool: 'rag_expand', details: mcpTools.rag_expand },
        });
    }
    if (mcpTools.lsp_references && mcpTools.lsp_references.ok === false && !mcpTools.lsp_references.skipped) {
        findings.push({
            severity: 'info',
            category: 'semantic',
            title: 'MCP lsp_references falhou (seguindo com contexto reduzido)',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:lsp_references:fail',
            evidence: { tool: 'lsp_references', details: mcpTools.lsp_references },
        });
    }

    if (findings.length === 0) {
        findings.push({
            severity: 'info',
            category: 'runtime',
            title: 'Contexto base coletado com sucesso (MCP/RAG/LSP/Inference)',
            source: 'audit-agent',
            dedup_key: 'ctx:all-ok',
            evidence: {
                semantic_quality: context.semantic_quality,
                rag_quality: context.rag_quality,
                runtime_quality: context.runtime_quality,
                inference_models_count: inf.models_count ?? null,
            },
        });
    }

    return findings;
}

export function createAuditAgentContextBuilder() {
    return {
        async collectQuickContext(job = null) {
            const [mcpProbe, ragProbe, lspProbe, infProbe] = await Promise.all([
                runNodeScript(['run', '-s', 'mcp:diagnose', '--', '--json'], 20000),
                runNodeScript(['run', '-s', 'rag:health', '--', '--json'], 15000),
                runNodeScript(['run', '-s', 'lsp:health', '--', '--json'], 15000),
                probeInferenceGateway(),
            ]);

            const mcpJson = parseJsonSafe(mcpProbe.stdout, null);
            const ragJson = parseJsonSafe(ragProbe.stdout, null);
            const lspJson = parseJsonSafe(lspProbe.stdout, null);

            const shouldInvokeMcpTools =
                mcpProbe.ok &&
                String(process.env.AUDIT_AGENT_CONTEXT_USE_MCP_TOOLS || 'true').toLowerCase() !== 'false';
            const mcpSemantic = shouldInvokeMcpTools ? await collectMcpSemanticContext(job) : null;

            const context = {
                runtime: {
                    mcp: mcpProbe.ok ? { ok: true, ...(mcpJson || {}) } : { ok: false, error: mcpProbe.error, stderr: mcpProbe.stderr || '' },
                    rag: ragProbe.ok ? { ok: true, ...(ragJson || {}) } : { ok: false, error: ragProbe.error, stderr: ragProbe.stderr || '' },
                    lsp: lspProbe.ok ? { ok: true, ...(lspJson || {}) } : { ok: false, error: lspProbe.error, stderr: lspProbe.stderr || '' },
                },
                inference_gateway: infProbe,
                mcp_tools: mcpSemantic?.tools || null,
                mcp_tool_payloads: mcpSemantic?.raw || null,
                semantic_quality: lspProbe.ok ? 'high' : 'low',
                rag_quality: ragProbe.ok ? 'high' : 'low',
                runtime_quality: mcpProbe.ok && ragProbe.ok && lspProbe.ok ? 'high' : 'degraded',
                mcp_tools_invoked: Boolean(mcpSemantic),
                mode: mcpSemantic ? 'read_only_mcp_v1' : 'read_only_probe_v0',
            };

            return {
                context,
                findings: deriveContextFindings(context),
                patches: [],
            };
        },
    };
}
