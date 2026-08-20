// @ts-check
import { log } from '#core/logger';
import { listInferenceBackends } from '#infra/db/inference_backend_repo';
import { listInferenceClientPolicies } from '#infra/db/inference_client_policy_repo';
import { listInferenceModels } from '#infra/db/inference_model_repo';
import { listInferenceProfiles } from '#infra/db/inference_profile_repo';
import { COMMANDS, executeCommand } from '#server/domain/control_command_service';
import express from 'express';
import { authenticate } from '../../middleware/auth.js';
import { fail, ok } from '../utils/api_envelope.js';

/** @type {ReturnType<typeof express.Router>} */
const router = express.Router();

function _actorFromReq(/** @type {any} */ req) {
    return req.user || { id: req.ip || null, username: req.ip || null, role: 'admin', permissions: [] };
}

async function _runControl(
    /** @type {any} */ req,
    /** @type {any} */ res,
    /** @type {any} */ command,
    /** @type {Record<string, any>} */ payload = {},
) {
    try {
        const result = await executeCommand({
            command,
            payload: {
                ...payload,
                reason:
                    payload['reason'] ||
                    req.body?.reason ||
                    `${String(command).toLowerCase()} via /api/dashboard/inference`,
                idempotency_key:
                    payload['idempotency_key'] ||
                    req.body?.idempotency_key ||
                    `${req.id}:${command}:${payload['id'] || payload['backend_id'] || payload['model_id'] || payload['name'] || 'n/a'}`,
            },
            actor: _actorFromReq(req),
        });
        return result;
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        fail(res, req, Number(_e?.statusCode || 500), {
            code: _e?.code || 'INFERENCE_CONTROL_COMMAND_FAILED',
            error: _e?.message || 'Falha em comando de inferência',
            details: _e?.details || null,
        });
        return null;
    }
}

function _asRecord(/** @type {any} */ value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _capabilitySummary(/** @type {any} */ model) {
    const caps = _asRecord(model?.capabilities_json);
    return {
        supports_code_patch: Boolean(caps.supports_code_patch),
        supports_json_strict: Boolean(caps.supports_json_strict),
        supports_embeddings: Boolean(caps.supports_embeddings),
        supports_long_context: Boolean(caps.supports_long_context),
        supports_multimodal: Boolean(caps.supports_multimodal),
        max_context_tokens: Number.isFinite(Number(caps.max_context_tokens)) ? Number(caps.max_context_tokens) : null,
        max_output_tokens: Number.isFinite(Number(caps.max_output_tokens)) ? Number(caps.max_output_tokens) : null,
    };
}

function _enrichModelDb(/** @type {any} */ model) {
    return {
        ...model,
        capabilities_summary: _capabilitySummary(model),
        policy_flags: {
            enabled: Boolean(model?.enabled),
            has_default_params: Object.keys(_asRecord(model?.default_params_json)).length > 0,
            has_resource_profile: Object.keys(_asRecord(model?.resource_profile_json)).length > 0,
            has_safety_profile: Object.keys(_asRecord(model?.safety_profile_json)).length > 0,
        },
    };
}

/**
 * @param {{ backends?: any[]; models?: any[]; profiles?: any[]; clientPolicies?: any[] }} param0
 * @returns {any}
 */
function _buildInferenceSummary({ backends = [], models = [], profiles = [], clientPolicies = [] }) {
    const enabledBackends = backends.filter((b) => b?.enabled);
    const enabledModels = models.filter((m) => m?.enabled);
    const byBackend = /** @type {Record<string, any>} */ ({});
    for (const backend of backends) {
        byBackend[backend.id] = {
            backend_id: backend.id,
            name: backend.name,
            kind: backend.kind,
            enabled: Boolean(backend.enabled),
            model_total: 0,
            model_enabled: 0,
        };
    }
    for (const model of models) {
        const key = String(model.backend_id || '');
        if (!byBackend[key]) {
            byBackend[key] = {
                backend_id: key,
                name: null,
                kind: null,
                enabled: null,
                model_total: 0,
                model_enabled: 0,
            };
        }
        byBackend[key].model_total += 1;
        if (model.enabled) byBackend[key].model_enabled += 1;
    }
    return {
        counts: {
            backends_total: backends.length,
            backends_enabled: enabledBackends.length,
            models_total: models.length,
            models_enabled: enabledModels.length,
            profiles_total: profiles.length,
            profiles_enabled: profiles.filter((p) => p?.enabled).length,
            client_policies_total: clientPolicies.length,
            client_policies_enabled: clientPolicies.filter((p) => p?.enabled).length,
        },
        by_backend: Object.values(byBackend),
        capability_totals: {
            code_patch_models: models.filter((m) => _capabilitySummary(m).supports_code_patch).length,
            embedding_models: models.filter((m) => _capabilitySummary(m).supports_embeddings).length,
            json_strict_models: models.filter((m) => _capabilitySummary(m).supports_json_strict).length,
            long_context_models: models.filter((m) => _capabilitySummary(m).supports_long_context).length,
        },
    };
}

function getBaseUrls() {
    const gatewayHost = process.env['INFERENCE_GATEWAY_HOST'] || '127.0.0.1';
    const gatewayPort = Number(process.env['INFERENCE_GATEWAY_PORT'] || 3099);
    const auditAgentHost = process.env['AUDIT_AGENT_HOST'] || '127.0.0.1';
    const auditAgentPort = Number(process.env['AUDIT_AGENT_PORT'] || 3098);
    return {
        inferenceGateway: `http://${gatewayHost}:${gatewayPort}`,
        auditAgent: `http://${auditAgentHost}:${auditAgentPort}`,
    };
}

async function safeFetchJson(/** @type {any} */ url, timeoutMs = 2000) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { ok: res.ok, status: res.status, json, text };
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        return { ok: false, status: null, json: null, text: null, error: _e?.message || String(_e) };
    }
}

async function safePostJson(/** @type {any} */ url, /** @type {any} */ body, timeoutMs = 2000) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            json = null;
        }
        return { ok: res.ok, status: res.status, json, text };
    } catch (/** @type {any} */ error) {
        const _e = /** @type {any} */ (error);
        return { ok: false, status: null, json: null, text: null, error: _e?.message || String(_e) };
    }
}

router.get('/inference/runtime', authenticate, async (req, res) => {
    try {
        const appLocals = req.app?.locals || {};
        const runtimeSummary =
            typeof appLocals['getRuntimeResourcesStatus'] === 'function' ? appLocals['getRuntimeResourcesStatus']() : null;
        const urls = getBaseUrls();

        const [gatewayHealth, auditAgentHealth] = await Promise.all([
            safeFetchJson(`${urls.inferenceGateway}/health`, 1500),
            safeFetchJson(`${urls.auditAgent}/health`, 1500),
        ]);

        const resources = Array.isArray(runtimeSummary?.resources)
            ? runtimeSummary.resources.filter((/** @type {any} */ item) =>
                  ['ollama_host', 'inference_gateway', 'audit_agent'].includes(String(item.id)),
              )
            : [];

        ok(
            res,
            req,
            {
                resources,
                probes: {
                    inference_gateway: gatewayHealth,
                    audit_agent: auditAgentHealth,
                },
                endpoints: urls,
            },
            {
                readiness_status: runtimeSummary?.status || 'unknown',
            },
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] inference runtime failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'INFERENCE_RUNTIME_FAILED',
            error: 'Erro ao recuperar runtime de inferência',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/metrics', authenticate, async (req, res) => {
    try {
        const urls = getBaseUrls();
        const [gatewayMetrics, auditAgentMetrics] = await Promise.all([
            safeFetchJson(`${urls.inferenceGateway}/metrics`, 2000),
            safeFetchJson(`${urls.auditAgent}/metrics`, 2000),
        ]);

        ok(res, req, {
            inference_gateway: gatewayMetrics,
            audit_agent: auditAgentMetrics,
            endpoints: urls,
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        log('ERROR', `[DASHBOARD_API] inference metrics failed: ${_e?.message || String(_e)}`, req.id);
        fail(res, req, 500, {
            code: 'INFERENCE_METRICS_FAILED',
            error: 'Erro ao recuperar métricas de inferência',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/models', authenticate, async (req, res) => {
    try {
        const urls = getBaseUrls();
        const response = await fetch(`${urls.inferenceGateway}/v1/models`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clientTag: 'diagnostics_probe' }),
            signal: AbortSignal.timeout(3000),
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) {
            return fail(res, req, response.status, {
                code: 'INFERENCE_MODELS_PROXY_FAILED',
                error: 'Falha ao listar modelos via inference gateway',
                details: json || null,
            });
        }
        return ok(res, req, json?.models ?? [], { source: 'inference-gateway' });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 503, {
            code: 'INFERENCE_GATEWAY_UNAVAILABLE',
            error: 'Inference Gateway indisponível',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/models-db', authenticate, async (req, res) => {
    try {
        const backendId = req.query?.['backend_id'] ? String(req.query['backend_id']) : null;
        const models = listInferenceModels({ backendId, enabledOnly: false, limit: 1000 });
        const enriched = models.map(_enrichModelDb);
        return ok(res, req, enriched, { count: enriched.length, source: 'sqlite', enriched: true });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'INFERENCE_MODELS_DB_LIST_FAILED',
            error: 'Erro ao listar modelos persistidos',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/summary', authenticate, async (req, res) => {
    try {
        const backends = listInferenceBackends({ enabledOnly: false, limit: 1000 });
        const models = listInferenceModels({ enabledOnly: false, limit: 2000 });
        const profiles = listInferenceProfiles({ enabledOnly: false, limit: 1000 });
        const clientPolicies = listInferenceClientPolicies({ enabledOnly: false, limit: 1000 });
        return ok(res, req, _buildInferenceSummary({ backends, models, profiles, clientPolicies }), {
            source: 'sqlite',
        });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'INFERENCE_SUMMARY_FAILED',
            error: 'Erro ao montar summary de inferência',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/backends', authenticate, async (req, res) => {
    try {
        const backends = listInferenceBackends({ enabledOnly: false, limit: 500 });
        return ok(res, req, backends, { count: backends.length, source: 'sqlite' });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'INFERENCE_BACKENDS_LIST_FAILED',
            error: 'Erro ao listar backends de inferência',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/profiles', authenticate, async (req, res) => {
    try {
        const profiles = listInferenceProfiles({ enabledOnly: false, limit: 500 });
        return ok(res, req, profiles, { count: profiles.length, source: 'sqlite' });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'INFERENCE_PROFILES_LIST_FAILED',
            error: 'Erro ao listar profiles de inferência',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/client-policies', authenticate, async (req, res) => {
    try {
        const policies = listInferenceClientPolicies({ enabledOnly: false, limit: 500 });
        return ok(res, req, policies, { count: policies.length, source: 'sqlite' });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 500, {
            code: 'INFERENCE_CLIENT_POLICIES_LIST_FAILED',
            error: 'Erro ao listar client policies de inferência',
            details: _e?.message || String(_e),
        });
    }
});

router.get('/inference/policies/summary', authenticate, async (req, res) => {
    try {
        const urls = getBaseUrls();
        const response = await safeFetchJson(`${urls.inferenceGateway}/v1/policies`, 2000);
        if (!response.ok) {
            return fail(res, req, response.status || 503, {
                code: 'INFERENCE_POLICIES_SUMMARY_FAILED',
                error: 'Falha ao obter summary de policies do inference gateway',
                details: response.json || response.text || response.error || null,
            });
        }
        return ok(res, req, response.json?.summary || null, { source: 'inference-gateway' });
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 503, {
            code: 'INFERENCE_GATEWAY_UNAVAILABLE',
            error: 'Inference Gateway indisponível',
            details: _e?.message || String(_e),
        });
    }
});

router.post('/inference/triage/preflight', authenticate, async (req, res) => {
    try {
        const urls = getBaseUrls();
        const body = req.body || {};
        const profileName =
            body.profile_name || body.profileName || process.env['AUDIT_AGENT_TRIAGE_PROFILE_NAME'] || undefined;
        const model = body.model || process.env['AUDIT_AGENT_LLM_MODEL_TRIAGE'] || undefined;
        const backend = body.backend || undefined;
        const timeoutMs = Math.max(500, Number(body.timeout_ms || body.timeoutMs || 2000));
        const out = await safePostJson(
            `${urls.inferenceGateway}/v1/validate/generate`,
            {
                clientTag: 'audit_agent_triage',
                profileName: profileName ? String(profileName) : undefined,
                model: model ? String(model) : undefined,
                backend: backend ? String(backend) : undefined,
            },
            timeoutMs,
        );
        const modelsProbe =
            String(body.probe_models || 'false').toLowerCase() === 'true'
                ? await safePostJson(
                      `${urls.inferenceGateway}/v1/models`,
                      { clientTag: 'diagnostics_probe' },
                      Math.min(timeoutMs + 1000, 5000),
                  )
                : null;
        if (!out.ok) {
            return fail(res, req, out.status || 503, {
                code: 'INFERENCE_TRIAGE_PREFLIGHT_FAILED',
                error: 'Falha no preflight de triage de inferência',
                details: out.json || out.text || out.error || null,
                upstream: { inference_gateway: urls.inferenceGateway },
            });
        }
        return ok(
            res,
            req,
            {
                preflight: out.json || null,
                models_probe: modelsProbe,
                effective_defaults: {
                    profile_name: profileName ? String(profileName) : null,
                    model: model ? String(model) : null,
                    backend: backend ? String(backend) : null,
                    client_tag: 'audit_agent_triage',
                },
            },
            { source: 'inference-gateway', endpoint: '/v1/validate/generate' },
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 503, {
            code: 'INFERENCE_TRIAGE_PREFLIGHT_UNAVAILABLE',
            error: 'Preflight de triage indisponível',
            details: _e?.message || String(_e),
        });
    }
});

router.post('/inference/patch/preflight', authenticate, async (req, res) => {
    try {
        const urls = getBaseUrls();
        const body = req.body || {};
        const profileName =
            body.profile_name || body.profileName || process.env['AUDIT_AGENT_PATCH_AUTHOR_PROFILE_NAME'] || undefined;
        const model = body.model || process.env['AUDIT_AGENT_LLM_MODEL_PATCH'] || undefined;
        const backend = body.backend || undefined;
        const timeoutMs = Math.max(500, Number(body.timeout_ms || body.timeoutMs || 2000));
        const out = await safePostJson(
            `${urls.inferenceGateway}/v1/validate/generate`,
            {
                clientTag: 'audit_agent_patch',
                profileName: profileName ? String(profileName) : undefined,
                model: model ? String(model) : undefined,
                backend: backend ? String(backend) : undefined,
            },
            timeoutMs,
        );
        if (!out.ok) {
            return fail(res, req, out.status || 503, {
                code: 'INFERENCE_PATCH_PREFLIGHT_FAILED',
                error: 'Falha no preflight de patch author de inferência',
                details: out.json || out.text || out.error || null,
                upstream: { inference_gateway: urls.inferenceGateway },
            });
        }
        return ok(
            res,
            req,
            {
                preflight: out.json || null,
                effective_defaults: {
                    profile_name: profileName ? String(profileName) : null,
                    model: model ? String(model) : null,
                    backend: backend ? String(backend) : null,
                    client_tag: 'audit_agent_patch',
                },
            },
            { source: 'inference-gateway', endpoint: '/v1/validate/generate' },
        );
    } catch (/** @type {any} */ err) {
        const _e = /** @type {any} */ (err);
        return fail(res, req, 503, {
            code: 'INFERENCE_PATCH_PREFLIGHT_UNAVAILABLE',
            error: 'Preflight de patch author indisponível',
            details: _e?.message || String(_e),
        });
    }
});

router.post('/inference/profiles/validate', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_PROFILE_VALIDATE, req.body || {});
    if (!result) return;
    return ok(res, req, result.result || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_PROFILE_VALIDATE,
        operation_id: result.operation?.id || null,
    });
});

router.post('/inference/backends', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_BACKEND_UPSERT, req.body || {});
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_BACKEND_UPSERT,
        operation_id: result.operation?.id || null,
    });
});

router.post('/inference/backends/:id/toggle', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_BACKEND_TOGGLE, {
        ...(req.body || {}),
        backend_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_BACKEND_TOGGLE,
        operation_id: result.operation?.id || null,
    });
});

router.post('/inference/models', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_MODEL_UPSERT, req.body || {});
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_MODEL_UPSERT,
        operation_id: result.operation?.id || null,
    });
});

router.post('/inference/models/:id/toggle', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_MODEL_TOGGLE, {
        ...(req.body || {}),
        model_id: req.params['id'],
    });
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_MODEL_TOGGLE,
        operation_id: result.operation?.id || null,
    });
});

router.post('/inference/profiles', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_PROFILE_UPSERT, req.body || {});
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_PROFILE_UPSERT,
        operation_id: result.operation?.id || null,
        reload_gateway: result.result?.metadata?.reload_gateway || null,
    });
});

router.post('/inference/client-policies', authenticate, async (req, res) => {
    const result = await _runControl(req, res, COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT, req.body || {});
    if (!result) return;
    return ok(res, req, result.result?.after || null, {
        source: 'control-plane',
        command: COMMANDS.INFERENCE_CLIENT_POLICY_UPSERT,
        operation_id: result.operation?.id || null,
        reload_gateway: result.result?.metadata?.reload_gateway || null,
    });
});

export default router;
