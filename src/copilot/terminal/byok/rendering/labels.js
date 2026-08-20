// @ts-check
/**
 * Helpers puros de apresentação textual do cockpit BYOK.
 *
 * Mantê-los fora de `terminal/commands/byok.js` reduz o command router monolítico e dá uma superfície pequena, testável
 * e reutilizável para taxonomias/labels sem acoplamento a estado, SDK ou model-gateway.
 *
 * @module copilot/terminal/byok/rendering/labels
 */

/** @param {boolean} value @returns {string} */
export function yesNo(value) {
    return value ? 'sim' : 'não';
}

/**
 * @param {boolean} enabled
 * @param {boolean} ready
 * @returns {string}
 */
export function renderByokStatusLine(enabled, ready) {
    if (!enabled) return 'desativado';
    if (ready) return 'ativo e pronto';
    return 'ativo, configuração incompleta';
}

/**
 * @param {{ apiKeyConfigured?: boolean; bearerTokenConfigured?: boolean; headersConfigured?: boolean }} auth
 * @returns {string}
 */
export function renderByokAuthLine(auth) {
    return [
        auth.apiKeyConfigured ? 'chave API configurada' : 'chave API ausente',
        auth.bearerTokenConfigured ? 'token bearer configurado' : 'token bearer ausente',
        auth.headersConfigured ? 'headers extras configurados' : 'headers extras ausentes',
    ].join(' · ');
}

/**
 * @param {{
 *     reasoningEffort?: boolean | null;
 *     sdkReasoningEffort?: boolean | null;
 *     vision?: boolean | null;
 *     contextWindowTokens?: number | null;
 * }} capabilities
 * @returns {string}
 */
export function renderByokCapabilityLine(capabilities) {
    const context =
        capabilities.contextWindowTokens == null ? 'contexto n/d' : `contexto ${capabilities.contextWindowTokens}`;
    return [
        `raciocínio ${yesNo(Boolean(capabilities.reasoningEffort))}`,
        `SDK ${yesNo(Boolean(capabilities.sdkReasoningEffort))}`,
        `visão ${yesNo(Boolean(capabilities.vision))}`,
        context,
    ].join(' · ');
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
export function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/** @param {string | null} value @returns {string} */
export function valueOrDash(value) {
    return value && value.length > 0 ? value : '-';
}

/** @param {(string | null | undefined | false)[]} parts @returns {string} */
export function joinTerminalSummary(parts) {
    return parts.filter((part) => typeof part === 'string' && part.length > 0).join(' · ');
}

/** @param {string} value @returns {string} */
export function normalizeByokLabelKey(value) {
    return value.toLowerCase().replace(/[\s-]+/gu, '_');
}

/** @param {string | null | undefined} value @returns {string} */
export function renderByokSourceLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        'active-runtime': 'seleção viva',
        'provider-cache:model': 'cache do provedor',
        'model-gateway:model': 'catálogo normalizado',
        'provider-default': 'default do provedor',
        remote: 'catálogo remoto',
        'remote-cache': 'cache remoto',
        provider: 'catálogo do provedor',
        'provider-cache': 'cache do provedor',
        static: 'semente estática',
        'static-fallback': 'fallback estático',
        'terminal-catalog': 'catálogo do terminal',
        'model-gateway': 'model-gateway',
        env_compat: 'env compatível',
        runtime: 'execução observada',
        selected: 'selecionada',
        selected_route: 'rota selecionada',
        candidate_alternative: 'alternativa candidata',
        candidate: 'candidata',
        alternative: 'alternativa',
        new_provider: 'novo provedor',
        unavailable: 'indisponível',
    });
    return labels[normalized] ?? labels[normalizeByokLabelKey(normalized)] ?? normalized.replace(/[_-]+/gu, ' ');
}

/** @param {string | null | undefined} value @returns {string} */
export function renderByokSourceIdLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        'openrouter-key-account': 'conta OpenRouter',
        'cloudflare-workers-ai-account': 'conta Cloudflare Workers AI',
        'kilo-gateway-account': 'conta Kilo gateway',
        'runtime-health-rate-limit': 'saúde runtime: limite de taxa',
    });
    return labels[normalized] ?? normalized.replace(/[_-]+/gu, ' ');
}

/** @param {string | null | undefined} value @returns {string} */
export function renderByokWireLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        completions: 'chat completions',
        responses: 'responses',
        openai_chat_completions: 'chat completions',
        openai_responses: 'responses',
    });
    return labels[normalized] ?? normalized.replace(/[_-]+/gu, ' ');
}

/** @param {string | null | undefined} value @returns {string} */
export function renderByokTokenLabel(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '-';
    const labels = /** @type {Record<string, string>} */ ({
        chat: 'chat',
        agent: 'agente',
        runtime: 'agente',
        full: 'agente',
        streaming: 'streaming',
        stream: 'streaming',
        json: 'JSON',
        structured: 'JSON',
        vision: 'visão',
        image: 'visão',
        imagem: 'visão',
        vlm: 'visão',
        health: 'saúde',
        'runtime-health': 'saúde runtime',
        probes: 'sondas',
        provider_explicit: 'provedor explícito',
        exact_model: 'modelo exato',
        local_provider_requires_explicit_request: 'provedor local exige pedido explícito',
        route_decision_ready: 'decisão de rota pronta',
        post_runtime_proved_better_route: 'rota provada em runtime venceu',
        consider_prefer_runtime_proved_policy: 'considerar política que prefere prova runtime',
        require_runtime_proof: 'exigir prova runtime',
        metadata_first: 'metadados primeiro',
        prefer_runtime_proved: 'preferir rota provada',
        allow_probe_unknown: 'permitir sonda quando acesso é desconhecido',
        block_unknown: 'bloquear acesso desconhecido',
        strict_access_only: 'somente acesso confirmado',
        terminal: 'terminal',
        runtime_health: 'saúde runtime',
        runtime_selector: 'seletor de execução',
        runtime_selector_alternativa: 'alternativa do seletor',
        catalog_snapshot: 'snapshot do catálogo',
        automation_decision: 'decisão automática',
        standby_routes: 'rotas standby',
        terminal_boundary: 'fronteira do terminal',
        agent_probe_missing: 'agent probe ausente',
        agent_probe_not_verified: 'agent probe não verificada',
        agent_probe_failed: 'agent probe falhou',
        chat_health_missing: 'saúde de chat ausente',
        chat_health_failed: 'saúde de chat falhou',
        health_unknown: 'saúde desconhecida',
        authenticated_account_api: 'API autenticada da conta',
        authenticated_catalog: 'catálogo autenticado',
        authenticated_models: 'modelos autenticados',
        authenticated_gateway_providers: 'provedores autenticados do gateway',
        probe_failed: 'sonda falhou',
        account: 'conta/key',
        catalog: 'catálogo',
        default: 'padrão',
        none: 'nenhum',
        rate_limited: 'limitado por taxa',
        quota: 'quota',
        credits: 'créditos',
        'rate-limit': 'limite de taxa',
        fresh: 'recente',
        expired: 'expirado',
        temporary: 'temporário',
        not_blocking: 'sem bloqueio',
        explicit_reset_at: 'reset explícito',
        selected: 'selecionada',
        selected_route: 'rota selecionada',
        candidate_alternative: 'alternativa candidata',
        new_provider: 'novo provedor',
        same_provider: 'mesmo provedor',
        no_selected_route: 'nenhuma rota selecionada',
        key_account_and_public_models: 'conta da key e modelos públicos',
        key_credit_balance: 'saldo de crédito da key',
        headers_or_runtime_failure: 'headers ou falha runtime',
        runtime_failure_only: 'apenas falha runtime',
        importer_failure_or_runtime_failure: 'falha no importer ou runtime',
        docs_and_runtime_failure: 'docs e falha runtime',
        account_models_and_gateway: 'modelos da conta e gateway',
        credit_balance: 'saldo de crédito',
        account_spending_limit: 'limite de gasto da conta',
        gateway_rate_limit: 'limite de taxa do gateway',
        local_daemon_models: 'modelos do daemon local',
        local_resource_bound: 'recurso local',
        sdk_entitlement_separate: 'limite SDK separado',
        not_applicable: 'não aplicável',
        unknown: 'desconhecido',
        eligible: 'elegível',
        excluded: 'excluído',
        candidate_can_be_ranked: 'candidato pode ser ranqueado',
        account_model_visible: 'modelo visível na conta',
        no_extra_action: 'sem ação extra',
        'preferred:large_context': 'preferido por contexto amplo',
        preferred_large_context: 'preferido por contexto amplo',
        'confidence:catalog': 'confiança do catálogo',
        confidence_catalog: 'confiança do catálogo',
        'missing_capability:tools': 'capacidade ausente: tools',
        missing_capability_tools: 'capacidade ausente: tools',
        context_too_small: 'contexto pequeno demais',
        sanitized: 'sanitizado',
        redacted: 'redigido',
        wait_for_rate_limit_reset_or_choose_another_route: 'aguardar reset do limite ou escolher outra rota',
        refresh_overlay_or_retry_pre_runtime_selection: 'atualizar overlay ou tentar seleção pré-runtime novamente',
        'provider.timeout': 'timeout do provedor',
        ok: 'ok',
        failed: 'falhou',
        pass: 'ok',
        blocked: 'bloqueado',
        blocked_no_selected_route: 'bloqueado: nenhuma rota selecionada',
        'admission-blocked': 'bloqueado na admissão',
        ready: 'pronto',
        missing: 'ausente',
        partial: 'parcial',
        deferred: 'adiado',
        applied: 'aplicado',
        gateway_auto: 'gateway auto',
        provider_model: 'modelo do provedor',
        public_gateway_api: 'API pública do gateway',
        public_docs: 'docs públicos',
        authenticated_api: 'API autenticada',
        runtime_rate_limited: 'runtime limitado por taxa',
        dry_run: 'simulação',
        manual_intervention: 'intervenção manual',
        effect_not_authorized: 'aguardando autorização',
        effects_not_enabled: 'efeitos desativados',
        new_session_not_allowed: 'nova sessão não autorizada',
        new_session_policy: 'política de nova sessão',
        new_session_policy_required: 'política exige nova sessão explícita',
        new_session_requires_explicit_policy: 'nova sessão exige política explícita',
        boot_scheduled: 'novo boot agendado',
        deferred_until_turn_boundary: 'diferido até limite do turno',
        model_mismatch: 'modelo divergente',
        apply_live_model: 'aplicar modelo vivo',
        prepare_new_session: 'preparar nova sessão',
        prepare_new_sdk_session: 'preparar novo boot SDK',
        set_live_model: 'trocar modelo vivo',
        replan_after_turn_failure: 'replanejar pós-falha',
        wait_for_provider_reset: 'aguardar reset do provedor',
        policy_denied: 'política não autorizou',
        policy_disabled: 'política desativada',
        no_effect_policy_enabled: 'sem efeito terminal habilitado',
        automation_decision_blocked: 'decisão automática bloqueada',
        no_active_catalog_snapshot: 'snapshot ativo ausente',
        model_unavailable: 'modelo indisponível',
        route_blocked: 'rota bloqueada',
        runtime_selector_route_missing: 'seletor não encontrou rota',
        selected_route_missing: 'rota selecionada ausente',
        rate_limit_resettable: 'limite de taxa com reset',
        rate_limit: 'limite de taxa',
        aggregator: 'agregador',
        aggregator_auto: 'agregador automático',
        aggregator_models: 'modelos do agregador',
        capabilities_changed: 'capacidades alteradas',
        pricing_changed: 'preço alterado',
        disposition_changed: 'disposição alterada',
        access_changed: 'acesso alterado',
        policy_changed: 'política alterada',
        runtime_health_changed: 'saúde runtime alterada',
        request_local_provider_explicitly: 'pedir provider local explicitamente',
        provider_health_cooldown: 'cooldown de saúde do provedor',
        route_wait_for_reset: 'rota aguardando reset',
        'blocked:provider_health_cooldown:rate-limit': 'bloqueada por cooldown de limite de taxa',
        blocked_provider_health_cooldown_rate_limit: 'bloqueada por cooldown de limite de taxa',
        keep_current: 'manter atual',
        wait_for_reset: 'aguardar reset',
    });
    const key = normalizeByokLabelKey(normalized);
    if (labels[normalized]) return labels[normalized];
    if (labels[key]) return labels[key];
    if (normalized.includes(':')) {
        return normalized
            .split(':')
            .map((part) => renderByokTokenLabel(part))
            .join(' · ');
    }
    return normalized.replace(/[_-]+/gu, ' ');
}

/** @param {string[]} values @returns {string} */
export function renderByokTokenList(values) {
    return values.map(renderByokTokenLabel).join(', ');
}

/** @param {unknown} seconds @returns {string} */
export function formatTerminalDurationSeconds(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '-';
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** @param {boolean | undefined} value @returns {string} */
export function yesNoPlain(value) {
    return value === true ? 'sim' : value === false ? 'não' : '-';
}
