// @ts-check

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function _asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, any>} */ (/** @type {unknown} */ (value))
        : {};
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
function _safeString(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value);
}

/**
 * @param {unknown} job
 * @param {unknown} contextPack
 * @returns {string}
 */
function _buildTriagePrompt(job, contextPack) {
    const j = _asRecord(job);
    const cp = _asRecord(contextPack);
    const scope = _asRecord(j.scope_json);
    const context = _asRecord(cp.context);
    const mcpTools = _asRecord(context.mcp_tools);
    const runtime = _asRecord(context.runtime);
    const rag = _asRecord(runtime.rag);
    const lsp = _asRecord(runtime.lsp);
    const findings = Array.isArray(cp.findings) ? cp.findings : [];

    const lines = [
        'Você é um triage de engenharia para um repositório JS/Node.',
        'Objetivo: resumir riscos e sugerir próximos passos read-only (sem patch).',
        `job_kind=${_safeString(j.kind, 'unknown')}`,
        `target_file=${_safeString(scope.filePath || scope.file_path, 'n/a')}`,
        `query=${_safeString(scope.query || scope.rag_query, 'n/a')}`,
        `lsp_ok=${_safeString(lsp.ok, 'unknown')}`,
        `rag_ok=${_safeString(rag.ok, 'unknown')}`,
        `rag_degraded=${_safeString(rag.degraded, 'unknown')}`,
        `mcp_tools_budget=${JSON.stringify(mcpTools.budget || null)}`,
        `lsp_diagnostics=${JSON.stringify(mcpTools.lsp_diagnostics || null)}`,
        `lsp_definition=${JSON.stringify(mcpTools.lsp_definition || null)}`,
        `lsp_references=${JSON.stringify(mcpTools.lsp_references || null)}`,
        `lsp_document_symbols=${JSON.stringify(mcpTools.lsp_document_symbols || null)}`,
        `rag_search=${JSON.stringify(mcpTools.rag_search || null)}`,
        `rag_expand=${JSON.stringify(mcpTools.rag_expand || null)}`,
        `existing_findings=${JSON.stringify(findings.slice(0, 8).map(/** @param {Record<string, any>} f */ f => ({ title: f?.title, severity: f?.severity, category: f?.category })))}`.slice(
            0,
            4000
        ),
        'Responda em JSON com {summary:string, risk_level:"low|medium|high", next_actions:string[]}',
    ];
    return lines.join('\n');
}

function _getInferenceGatewayBaseUrl() {
    const host = process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
    const port = Number(process.env.INFERENCE_GATEWAY_PORT || 3099);
    return `http://${host}:${port}`;
}

function _isEnabled() {
    return String(process.env.AUDIT_AGENT_TRIAGE_LLM_ENABLED || 'false').toLowerCase() === 'true';
}

/**
 * @param {unknown} text
 * @returns {unknown}
 */
function _parseJsonMaybe(text) {
    try {
        return JSON.parse(String(text || ''));
    } catch {
        return null;
    }
}

/**
 * @param {string} url
 * @param {unknown} body
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number, text: string, json: unknown}>}
 */
async function _postJson(url, body, timeoutMs) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const json = _parseJsonMaybe(text);
    return { ok: res.ok, status: res.status, text, json };
}

/**
 * Cria o cliente de triagem LLM do Audit Agent.
 * O cliente consulta o Inference Gateway e retorna resumo/risco em modo read-only.
 * @returns {{
 *   isEnabled: () => boolean,
 *   runTriage: (job: unknown, contextPack: unknown) => Promise<any>
 * }}
 */
export function createAuditAgentTriageLlmClient() {
    return {
        isEnabled: _isEnabled,
        async runTriage(job, contextPack) {
            if (!_isEnabled()) {
                return { ok: false, skipped: true, reason: 'triage_llm_disabled' };
            }

            const prompt = _buildTriagePrompt(job, contextPack);
            const baseUrl = _getInferenceGatewayBaseUrl();
            const profileName = String(process.env.AUDIT_AGENT_TRIAGE_PROFILE_NAME || '').trim() || undefined;
            const model = String(process.env.AUDIT_AGENT_LLM_MODEL_TRIAGE || '').trim() || undefined;
            const timeoutMs = Math.max(1000, Number(process.env.AUDIT_AGENT_LLM_TIMEOUT_MS || 120000));
            const basePayload = {
                clientTag: 'audit_agent_triage',
                profileName,
                model,
                runtime: 'local',
            };

            const preflight = await _postJson(
                `${baseUrl}/v1/validate/generate`,
                basePayload,
                Math.min(timeoutMs, 10_000)
            );
            if (!preflight.ok || !_asRecord(preflight.json).ok) {
                return {
                    ok: false,
                    skipped: true,
                    error: 'inference_gateway_preflight_failed',
                    status: preflight.status,
                    details: preflight.json || preflight.text || null,
                };
            }
            const out = await _postJson(
                `${baseUrl}/v1/generate`,
                {
                    ...basePayload,
                    prompt,
                    maxTokens: Number(process.env.AUDIT_AGENT_TRIAGE_MAX_TOKENS || 300) || 300,
                },
                timeoutMs
            );
            const json = _asRecord(out.json);
            if (!out.ok || !json.ok) {
                return {
                    ok: false,
                    skipped: false,
                    error: 'inference_gateway_generate_failed',
                    status: out.status,
                    details: json || out.text || null,
                    preflight: preflight.json || null,
                };
            }

            const responseText = _safeString(_asRecord(json.result).response, '').trim();
            const parsed = _parseJsonMaybe(responseText);
            return {
                ok: true,
                skipped: false,
                provider: 'inference-gateway',
                client_tag: 'audit_agent_triage',
                profile_name: profileName || null,
                model: model || null,
                prompt_chars: prompt.length,
                raw_response: responseText,
                parsed: parsed || null,
                policy: json.policy || null,
                preflight: preflight.json || null,
                ts: json.ts || Date.now(),
            };
        },
    };
}
