// @ts-check
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/**
 * @typedef {{
 *     ok: boolean;
 *     status: number | null;
 *     json: Record<string, unknown> | null;
 *     text: string;
 *     error?: string;
 * }} McpToolCallResult
 */

/**
 * @typedef {object} McpToolCallOptions
 * @property {number} [timeoutMs]
 * @property {number} [id]
 */

/**
 * @typedef {(
 *     name: string,
 *     args: Record<string, unknown>,
 *     options?: McpToolCallOptions,
 * ) => Promise<McpToolCallResult>} CallMcpToolOverride
 */

/**
 * @typedef {{
 *           ok: true;
 *           stdout: string;
 *           stderr: string;
 *       }
 *     | {
 *           ok: false;
 *           error: string;
 *           stdout: string;
 *           stderr: string;
 *       }} ScriptRunResult
 */

/**
 * @typedef {{
 *     ok: false;
 *     error: string;
 *     stdout: string;
 *     stderr: string;
 * }} FailedScriptRunResult
 */

/**
 * @typedef {{ scope_json?: Record<string, unknown> | null } | null} AuditAgentContextJob
 */

/**
 * @typedef {{
 *     runtime?: Record<string, unknown>;
 *     inference_gateway?: Record<string, unknown>;
 *     mcp_tools?: Record<string, unknown> | null;
 *     semantic_quality?: string;
 *     rag_quality?: string;
 *     runtime_quality?: string;
 * }} AuditContext
 */

/**
 * @typedef {object} AuditAgentContextBuilderOptions
 * @property {CallMcpToolOverride} [callMcpTool]
 */

/**
 * @typedef {{ context: Record<string, unknown>; findings: Record<string, unknown>[]; patches: unknown[] }} AuditAgentQuickContextResult
 */

/**
 * @typedef {{ tools: Record<string, unknown>; raw: Record<string, unknown> }} AuditAgentSemanticContextResult
 */

/**
 * @typedef {object} AuditAgentContextBuilderFacade
 * @property {(job?: AuditAgentContextJob | null) => Promise<AuditAgentQuickContextResult>} collectQuickContext
 * @property {(job?: AuditAgentContextJob | null) => Promise<AuditAgentSemanticContextResult>} collectMcpSemanticContext
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : null;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
    const errorData = asRecord(error);
    const message = errorData?.message;
    return typeof message === 'string' ? message : String(error);
}

/**
 * @param {unknown} error
 * @param {'stdout' | 'stderr'} field
 * @returns {string}
 */
function getExecErrorOutput(error, field) {
    const errorData = asRecord(error);
    const value = errorData?.[field];
    return typeof value === 'string' ? value : '';
}

/**
 * @param {Record<string, unknown> | null} json
 * @returns {Record<string, unknown> | null}
 */
function getStructuredContentData(json) {
    const result = asRecord(json?.result);
    const structuredContent = asRecord(result?.structuredContent);
    return asRecord(structuredContent?.data);
}

/**
 * @param {unknown} text
 * @param {unknown} [fallback=null] Default is `null`
 * @returns {unknown}
 */
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

/**
 * @param {string[]} scriptArgs
 * @param {number} [timeoutMs=10000] Default is `10000`
 * @returns {Promise<ScriptRunResult>}
 */
async function runNodeScript(scriptArgs, timeoutMs = 10000) {
    try {
        /** @type {Record<string, string | undefined>} */
        const childEnv = { ...process.env, FORCE_COLOR: '0' };
        delete childEnv.NO_COLOR;
        const { stdout, stderr } = await execFile('npm', scriptArgs, {
            timeout: timeoutMs,
            maxBuffer: 2 * 1024 * 1024,
            env: childEnv,
            cwd: process.cwd(),
        });
        return { ok: true, stdout, stderr };
    } catch (/** @type {any} */ error) {
        return {
            ok: false,
            error: getErrorMessage(error),
            stdout: getExecErrorOutput(error, 'stdout'),
            stderr: getExecErrorOutput(error, 'stderr'),
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
        const models = asRecord(parseJsonSafe(await modelsRes.text(), null));
        const modelEntries = models && Array.isArray(models.models) ? models.models : null;
        return {
            ok: healthRes.ok,
            status: healthRes.status,
            models_ok: modelsRes.ok,
            models_count: modelEntries ? modelEntries.length : null,
            health,
        };
    } catch (/** @type {any} */ error) {
        return { ok: false, status: /** @type {number | null} */ (null), error: getErrorMessage(error) };
    }
}

// simple in-memory cache for MCP LSP calls; keys include tool name so
// we can reuse both definition and reference responses. The cache is kept
// at module scope so that repeated invocations of the context builder share
// data (useful when the agent processes multiple jobs on the same file).
// Note: No TTL is implemented, but max size limits prevent unbounded growth.
const MAX_CACHE_SIZE = 100;
/** @type {Map<string, McpToolCallResult>} */
const _mcpLspCache = new Map();

/**
 * @param {string} tool
 * @param {string} filePath
 * @param {number} line
 * @param {number} character
 * @returns {string}
 */
function _cacheKey(tool, filePath, line, character) {
    return `${tool}|${filePath}|${line}|${character}`;
}

function _ensureCacheSpace() {
    // Evict oldest entries if cache exceeds max size (FIFO)
    while (_mcpLspCache.size >= MAX_CACHE_SIZE) {
        const firstKey = _mcpLspCache.keys().next().value;
        if (typeof firstKey !== 'string') {
            break;
        }
        _mcpLspCache.delete(firstKey);
    }
}

/**
 * Limpa o cache interno de resultados MCP/LSP mantido pelo context builder.
 *
 * @returns {void}
 */
function _clearMcpLspCache() {
    _mcpLspCache.clear();
}

/**
 * Retorna o tamanho atual do cache interno MCP/LSP.
 *
 * @returns {number}
 */
function _getMcpLspCacheSize() {
    return _mcpLspCache.size;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {McpToolCallOptions} [options]
 * @returns {Promise<McpToolCallResult>}
 */
async function callMcpTool(name, args, options = {}) {
    const { timeoutMs = 5000, id = 1 } = options;
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
        const json = asRecord(parseJsonSafe(text, null));
        return {
            ok: res.ok && !json?.error,
            status: res.status,
            json,
            text,
        };
    } catch (/** @type {any} */ error) {
        return {
            ok: false,
            status: null,
            error: getErrorMessage(error),
            json: null,
            text: '',
        };
    }
}

/**
 * @param {AuditAgentContextJob} job
 * @param {CallMcpToolOverride | undefined} callToolOverride
 * @returns {Promise<{ tools: Record<string, unknown>; raw: Record<string, unknown> }>}
 */
async function collectMcpSemanticContext(job, callToolOverride) {
    // allows tests or external callers to provide a fake MCP tool implementation
    const call = callToolOverride || callMcpTool;

    const scope = asRecord(job?.scope_json) || {};
    const filePath = String(scope.filePath || scope.file_path || 'src/main.js');
    const line = Math.max(1, Number(scope.line || 1));
    const character = Math.max(1, Number(scope.character || 1));
    const query = String(scope.query || scope.rag_query || 'AUDIT_AGENT');
    const mcpBudget = Math.max(
        1,
        Math.min(Number(scope.mcp_budget || process.env.AUDIT_AGENT_CONTEXT_MCP_BUDGET || 5) || 5, 8),
    );
    let budgetUsed = 0;

    const canSpend = () => budgetUsed < mcpBudget;
    const spend = () => {
        budgetUsed += 1;
    };

    spend();
    spend();
    const [lspDiagnostics, ragSearch] = await Promise.all([
        call('lsp_diagnostics', { filePath, maxResults: 20 }, { timeoutMs: 5000, id: 201 }),
        call('rag_search', { query, topK: 2, mode: 'auto', includeDiagnostics: true }, { timeoutMs: 8000, id: 202 }),
    ]);

    const lspData = getStructuredContentData(lspDiagnostics.json);
    const ragData = getStructuredContentData(ragSearch.json);

    // Optional targeted definition probe when diagnostics path is usable.
    /** @type {McpToolCallResult | null} */
    let lspDefinition = null;
    if (lspDiagnostics.ok) {
        const defKey = _cacheKey('lsp_definition', filePath, line, character);
        if (_mcpLspCache.has(defKey)) {
            // cache hit, no budget spent
            lspDefinition = _mcpLspCache.get(defKey) || null;
        } else if (canSpend()) {
            spend();
            lspDefinition = await call(
                'lsp_definition',
                { filePath, line, character, maxResults: 10 },
                { timeoutMs: 5000, id: 203 },
            );
            if (lspDefinition.ok) {
                _ensureCacheSpace();
                _mcpLspCache.set(defKey, lspDefinition);
            }
        }
    }
    const defData = getStructuredContentData(lspDefinition?.json || null);

    /** @type {McpToolCallResult | null} */
    let ragExpand = null;
    const ragResults = ragData && Array.isArray(ragData.results) ? ragData.results : null;
    const firstChunk = asRecord(ragResults?.[0]);
    const firstChunkId = firstChunk?.chunk_id || null;
    if (ragSearch.ok && firstChunkId && canSpend()) {
        spend();
        ragExpand = await call(
            'rag_expand',
            { chunk_id: firstChunkId, mode: 'lines', before_lines: 20, after_lines: 20 },
            { timeoutMs: 5000, id: 204 },
        );
    }
    const ragExpandData = getStructuredContentData(ragExpand?.json || null);

    /** @type {McpToolCallResult | null} */
    let lspReferences = null;
    if (lspDefinition?.ok) {
        const refKey = _cacheKey('lsp_references', filePath, line, character);
        if (_mcpLspCache.has(refKey)) {
            lspReferences = _mcpLspCache.get(refKey) || null;
        } else if (canSpend()) {
            spend();
            lspReferences = await call(
                'lsp_references',
                { filePath, line, character, maxResults: 20 },
                { timeoutMs: 5000, id: 205 },
            );
            if (lspReferences.ok) {
                _ensureCacheSpace();
                _mcpLspCache.set(refKey, lspReferences);
            }
        }
    }
    const refsData = getStructuredContentData(lspReferences?.json || null);

    /** @type {McpToolCallResult | null} */
    let lspDocumentSymbols = null;
    if (canSpend()) {
        spend();
        lspDocumentSymbols = await call(
            'lsp_document_symbols',
            { filePath, maxResults: 100 },
            { timeoutMs: 5000, id: 206 },
        );
    }
    const symbolsData = getStructuredContentData(lspDocumentSymbols?.json || null);

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

/**
 * @param {AuditContext} context
 * @returns {Record<string, unknown>[]}
 */
function deriveContextFindings(context) {
    /** @type {Record<string, unknown>[]} */
    const findings = [];
    const runtime = asRecord(context.runtime) || {};
    const mcp = asRecord(runtime.mcp) || {};
    const rag = asRecord(runtime.rag) || {};
    const lsp = asRecord(runtime.lsp) || {};
    const inf = asRecord(context.inference_gateway) || {};
    const mcpTools = asRecord(context.mcp_tools) || {};
    const lspDiagnosticsTool = asRecord(mcpTools.lsp_diagnostics);
    const ragSearchTool = asRecord(mcpTools.rag_search);
    const ragExpandTool = asRecord(mcpTools.rag_expand);
    const lspReferencesTool = asRecord(mcpTools.lsp_references);

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

    if (lspDiagnosticsTool && lspDiagnosticsTool.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'semantic',
            title: 'MCP lsp_diagnostics falhou no context builder',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:lsp_diagnostics:fail',
            evidence: { tool: 'lsp_diagnostics', details: lspDiagnosticsTool },
        });
    }
    if (ragSearchTool && ragSearchTool.ok === false) {
        findings.push({
            severity: 'warning',
            category: 'context',
            title: 'MCP rag_search falhou no context builder',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:rag_search:fail',
            evidence: { tool: 'rag_search', details: ragSearchTool },
        });
    }
    if (ragExpandTool && ragExpandTool.ok === false && !ragExpandTool.skipped) {
        findings.push({
            severity: 'info',
            category: 'context',
            title: 'MCP rag_expand não disponível para enriquecimento (seguindo sem expand)',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:rag_expand:fail',
            evidence: { tool: 'rag_expand', details: ragExpandTool },
        });
    }
    if (lspReferencesTool && lspReferencesTool.ok === false && !lspReferencesTool.skipped) {
        findings.push({
            severity: 'info',
            category: 'semantic',
            title: 'MCP lsp_references falhou (seguindo com contexto reduzido)',
            source: 'audit-agent',
            dedup_key: 'ctx:mcp:lsp_references:fail',
            evidence: { tool: 'lsp_references', details: lspReferencesTool },
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

/**
 * @param {ScriptRunResult} probe
 * @param {unknown} parsedJson
 * @returns {Record<string, unknown>}
 */
function buildProbeState(probe, parsedJson) {
    if (probe.ok) {
        return { ok: true, ...(asRecord(parsedJson) || {}) };
    }

    const failedProbe = /** @type {FailedScriptRunResult} */ (probe);
    return {
        ok: false,
        error: failedProbe.error,
        stderr: failedProbe.stderr || '',
    };
}

/**
 * @param {AuditAgentContextBuilderOptions} [options={}] Default is `{}`
 * @returns {AuditAgentContextBuilderFacade}
 */
export function createAuditAgentContextBuilder(options = {}) {
    const { callMcpTool: callOverride } = options;
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
            const mcpSemantic = shouldInvokeMcpTools ? await collectMcpSemanticContext(job, callOverride) : null;

            const context = {
                runtime: {
                    mcp: buildProbeState(mcpProbe, mcpJson),
                    rag: buildProbeState(ragProbe, ragJson),
                    lsp: buildProbeState(lspProbe, lspJson),
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
        // expose semantic context collector so callers (and tests) can invoke
        // it directly. bind callOverride so the stub injected into the builder
        // applies uniformly.
        async collectMcpSemanticContext(job = null) {
            return collectMcpSemanticContext(job, callOverride);
        },
    };
}
// Exported helpers for testing and external introspection
export { _clearMcpLspCache, _getMcpLspCacheSize, callMcpTool };
