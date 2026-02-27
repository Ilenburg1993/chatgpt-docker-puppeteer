// @ts-check

function _asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _safeString(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value);
}

function _parseJsonMaybe(text) {
    try {
        return JSON.parse(String(text || ''));
    } catch {
        return null;
    }
}

function _boolEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const v = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    return fallback;
}

function _getInferenceGatewayBaseUrl() {
    const host = process.env.INFERENCE_GATEWAY_HOST || '127.0.0.1';
    const port = Number(process.env.INFERENCE_GATEWAY_PORT || 3099);
    return `http://${host}:${port}`;
}

function _isEnabled() {
    return String(process.env.AUDIT_AGENT_PATCH_AUTHOR_LLM_ENABLED || 'false').toLowerCase() === 'true';
}

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

function _buildPatchPrompt(job, contextPack, llmTriage) {
    const scope = _asRecord(job?.scope_json);
    const context = _asRecord(contextPack?.context);
    const mcpTools = _asRecord(context?.mcp_tools);
    const triageParsed = _asRecord(llmTriage?.parsed);
    const findings = Array.isArray(contextPack?.findings) ? contextPack.findings : [];
    return [
        'Você é um planejador de patch em modo proposal-only.',
        'Nao aplique patch. Nao invente diff se nao houver confiança.',
        'Responda JSON estrito com {summary, risk_level, candidate_files, proposed_changes, patch_unified_diff?}.',
        'risk_level deve ser low|medium|high.',
        'candidate_files deve ser array de strings.',
        'proposed_changes deve ser array de strings curtas.',
        `job_kind=${_safeString(job?.kind, 'unknown')}`,
        `target_file=${_safeString(scope.filePath || scope.file_path, 'n/a')}`,
        `query=${_safeString(scope.query || scope.rag_query, 'n/a')}`,
        `triage_summary=${_safeString(triageParsed.summary, 'n/a')}`,
        `triage_risk=${_safeString(triageParsed.risk_level, 'n/a')}`,
        `mcp_budget=${JSON.stringify(mcpTools.budget || null)}`,
        `lsp_diagnostics=${JSON.stringify(mcpTools.lsp_diagnostics || null)}`,
        `lsp_definition=${JSON.stringify(mcpTools.lsp_definition || null)}`,
        `lsp_references=${JSON.stringify(mcpTools.lsp_references || null)}`,
        `rag_search=${JSON.stringify(mcpTools.rag_search || null)}`,
        `rag_expand=${JSON.stringify(mcpTools.rag_expand || null)}`,
        `findings=${JSON.stringify(
            findings.slice(0, 10).map(f => ({ title: f?.title, severity: f?.severity, category: f?.category }))
        ).slice(0, 5000)}`,
    ].join('\n');
}

function _coercePatchAuthorParsed(rawParsed) {
    const parsed = _asRecord(rawParsed);
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const riskLevel = ['low', 'medium', 'high'].includes(String(parsed.risk_level || '').toLowerCase())
        ? String(parsed.risk_level).toLowerCase()
        : null;
    const candidateFiles = Array.isArray(parsed.candidate_files)
        ? parsed.candidate_files
              .map(v => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 10)
        : null;
    const proposedChanges = Array.isArray(parsed.proposed_changes)
        ? parsed.proposed_changes
              .map(v => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 20)
        : null;

    return {
        parsed,
        strict: {
            ok:
                Boolean(summary) &&
                Boolean(riskLevel) &&
                Array.isArray(candidateFiles) &&
                Array.isArray(proposedChanges),
            errors: [
                ...(summary ? [] : ['summary_missing_or_invalid']),
                ...(riskLevel ? [] : ['risk_level_invalid']),
                ...(Array.isArray(candidateFiles) ? [] : ['candidate_files_invalid']),
                ...(Array.isArray(proposedChanges) ? [] : ['proposed_changes_invalid']),
            ],
        },
    };
}

function _normalizePatchProposal(job, contextPack, llmOut) {
    const parsed = _asRecord(llmOut?.parsed);
    const scope = _asRecord(job?.scope_json);
    const targetFile = _safeString(scope.filePath || scope.file_path, 'src/main.js');
    const candidateFiles = Array.isArray(parsed.candidate_files)
        ? parsed.candidate_files
              .map(v => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 10)
        : [targetFile];
    const riskMap = { low: 0.2, medium: 0.45, high: 0.75 };
    const riskLevel = _safeString(parsed.risk_level, 'medium').toLowerCase();
    const riskScore = riskMap[riskLevel] ?? 0.45;
    const patchUnifiedDiff = typeof parsed.patch_unified_diff === 'string' ? parsed.patch_unified_diff : '';
    const proposedChanges = Array.isArray(parsed.proposed_changes)
        ? parsed.proposed_changes
              .map(v => String(v || '').trim())
              .filter(Boolean)
              .slice(0, 20)
        : [];

    const validation = {
        shape_valid: typeof llmOut?.parsed === 'object' && llmOut?.parsed !== null && !Array.isArray(llmOut?.parsed),
        has_summary: typeof parsed.summary === 'string' && parsed.summary.trim().length > 0,
        risk_level_supported: ['low', 'medium', 'high'].includes(riskLevel),
        has_candidate_files: candidateFiles.length > 0,
        has_proposed_changes: proposedChanges.length > 0,
        used_fallback_candidate_file: !Array.isArray(parsed.candidate_files),
    };

    return {
        status: 'draft',
        patch_unified_diff: patchUnifiedDiff,
        patch_summary: {
            skeleton: false,
            mode: 'propose_only',
            source: 'audit-agent-patch-llm',
            llm_provider: llmOut?.provider || 'inference-gateway',
            llm_model: llmOut?.model || null,
            profile_name: llmOut?.profile_name || null,
            summary: parsed.summary ? String(parsed.summary) : null,
            risk_level: riskLevel,
            candidate_files: candidateFiles.length > 0 ? candidateFiles : [targetFile],
            proposed_changes: proposedChanges,
            triage_anchor: _asRecord(llmOut?.triage_anchor) || null,
            context_budget: _asRecord(contextPack?.context)?.mcp_tools?.budget || null,
            validation,
        },
        risk_score: riskScore,
        dry_run_result_json: {
            ok: false,
            pending: true,
            required: true,
            reason: 'dry_run_not_executed_yet',
            validated_at_ms: null,
            ttl_ms: null,
        },
        approval_required: true,
    };
}

export function createAuditAgentPatchAuthorLlmClient() {
    return {
        isEnabled: _isEnabled,
        async runPatchAuthor(job, contextPack, llmTriage) {
            if (!_isEnabled()) {
                return { ok: false, skipped: true, reason: 'patch_author_llm_disabled' };
            }
            const baseUrl = _getInferenceGatewayBaseUrl();
            const profileName = String(process.env.AUDIT_AGENT_PATCH_AUTHOR_PROFILE_NAME || '').trim() || undefined;
            const model = String(process.env.AUDIT_AGENT_LLM_MODEL_PATCH || '').trim() || undefined;
            const timeoutMs = Math.max(1000, Number(process.env.AUDIT_AGENT_LLM_TIMEOUT_MS || 120000));
            const basePayload = {
                clientTag: 'audit_agent_patch',
                profileName,
                model,
                runtime: 'local',
            };
            const preflight = await _postJson(
                `${baseUrl}/v1/validate/generate`,
                basePayload,
                Math.min(timeoutMs, 10_000)
            );
            if (!preflight.ok || !preflight.json?.ok) {
                return {
                    ok: false,
                    skipped: true,
                    error: 'inference_gateway_preflight_failed',
                    status: preflight.status,
                    details: preflight.json || preflight.text || null,
                };
            }

            const prompt = _buildPatchPrompt(job, contextPack, llmTriage);
            const out = await _postJson(
                `${baseUrl}/v1/generate`,
                {
                    ...basePayload,
                    prompt,
                    maxTokens: Number(process.env.AUDIT_AGENT_PATCH_AUTHOR_MAX_TOKENS || 700) || 700,
                },
                timeoutMs
            );
            if (!out.ok || !out.json?.ok) {
                return {
                    ok: false,
                    skipped: false,
                    error: 'inference_gateway_generate_failed',
                    status: out.status,
                    details: out.json || out.text || null,
                    preflight: preflight.json || null,
                };
            }

            const responseText = _safeString(out.json?.result?.response, '').trim();
            const parsedRaw = _parseJsonMaybe(responseText);
            const parsedInfo = _coercePatchAuthorParsed(parsedRaw);
            if (_boolEnv('AUDIT_AGENT_PATCH_AUTHOR_REQUIRE_JSON', false) && !parsedInfo.strict.ok) {
                return {
                    ok: false,
                    skipped: false,
                    error: 'patch_author_invalid_json_shape',
                    status: 200,
                    details: {
                        strict: parsedInfo.strict,
                        raw_response: responseText.slice(0, 4000),
                    },
                    preflight: preflight.json || null,
                };
            }
            const normalizedProposal = _normalizePatchProposal(job, contextPack, {
                ok: true,
                provider: 'inference-gateway',
                profile_name: profileName || null,
                model: model || null,
                parsed: parsedInfo.parsed,
                triage_anchor: _asRecord(llmTriage?.parsed),
            });
            normalizedProposal.patch_summary.validation = {
                ..._asRecord(normalizedProposal.patch_summary.validation),
                strict_shape_ok: parsedInfo.strict.ok,
                strict_shape_errors: parsedInfo.strict.errors,
                require_json_enabled: _boolEnv('AUDIT_AGENT_PATCH_AUTHOR_REQUIRE_JSON', false),
            };

            return {
                ok: true,
                skipped: false,
                provider: 'inference-gateway',
                client_tag: 'audit_agent_patch',
                profile_name: profileName || null,
                model: model || null,
                prompt_chars: prompt.length,
                raw_response: responseText,
                parsed: parsedInfo.parsed || null,
                validation: normalizedProposal.patch_summary?.validation || null,
                patch_proposal: normalizedProposal,
                preflight: preflight.json || null,
                policy: out.json?.policy || null,
                ts: out.json?.ts || Date.now(),
            };
        },
    };
}
