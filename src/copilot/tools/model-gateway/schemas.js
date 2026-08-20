// @ts-check

/**
 * @param {string} description
 * @returns {Record<string, unknown>}
 */
const nullableString = (description) => ({
    type: ['string', 'null'],
    minLength: 1,
    description,
});

export const MODEL_GATEWAY_TOOL_OUTPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
        'schemaVersion',
        'operation',
        'ok',
        'status',
        'dryRun',
        'data',
        'warnings',
        'errors',
        'nextActions',
        'observedAt',
    ],
    properties: {
        schemaVersion: { type: 'string', const: 'model-gateway.tool-result.v1' },
        operation: { type: 'string', minLength: 1 },
        ok: { type: 'boolean' },
        status: { type: 'string', minLength: 1 },
        dryRun: { type: 'boolean' },
        data: { type: 'object' },
        warnings: { type: 'array', items: { type: 'string' } },
        errors: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['code', 'message', 'retryable'],
                properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    retryable: { type: 'boolean' },
                },
            },
        },
        nextActions: { type: 'array', items: { type: 'string' } },
        observedAt: { type: 'string', format: 'date-time' },
    },
});

export const MODEL_GATEWAY_OVERVIEW_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['maxSnapshotAgeHours', 'operationLimit'],
    properties: {
        runtimeId: nullableString(
            'Runtime alvo para capabilities e modelo efetivo; omita ou use null para o runtime default.',
        ),
        maxSnapshotAgeHours: {
            type: 'integer',
            minimum: 1,
            maximum: 720,
            description: 'Idade máxima aceitável do snapshot ativo em horas.',
        },
        operationLimit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Limite reservado para resumos de operações recentes.',
        },
    },
});

export const MODEL_GATEWAY_CATALOG_SEARCH_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['query', 'providerId', 'onlyEligible', 'requireTools', 'requireStreaming', 'requireReasoning', 'limit'],
    properties: {
        query: nullableString('Texto de busca; use null para não filtrar por texto.'),
        providerId: nullableString('Provider id exato; use null para todos.'),
        onlyEligible: { type: 'boolean' },
        requireTools: { type: 'boolean' },
        requireStreaming: { type: 'boolean' },
        requireReasoning: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
});

export const MODEL_GATEWAY_ROUTE_PLAN_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['taskProfile', 'maxCandidates', 'evaluateEligibility'],
    properties: {
        taskProfile: {
            type: 'string',
            enum: [
                'cheap_chat',
                'code',
                'repo_agent',
                'tool_agent',
                'json_extraction',
                'vision',
                'deep_reasoning',
                'local_private',
                'local_private_strict',
            ],
        },
        maxCandidates: { type: 'integer', minimum: 1, maximum: 25 },
        evaluateEligibility: {
            type: 'boolean',
            description: 'Reavalia elegibilidade localmente sem executar provider calls.',
        },
        selectionGoal: {
            type: 'string',
            enum: ['quality_first', 'balanced', 'reliability_first', 'latency_first', 'cost_first'],
            description:
                'Define pesos de ranking. quality_first não penaliza preço e reduz fortemente a penalidade de latência.',
        },
        proofPolicy: {
            type: 'string',
            enum: ['metadata_only', 'task_default', 'fresh_runtime_required'],
            description:
                'Separa descoberta de candidatos de certificação runtime. task_default usa o contrato do taskProfile.',
        },
        maxRuntimeProofAgeHours: {
            type: 'integer',
            minimum: 1,
            maximum: 168,
            description: 'Idade máxima de prova positiva para ser considerada funcional agora.',
        },
    },
});

export const MODEL_GATEWAY_OPERATION_STATUS_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['operationId', 'limit'],
    properties: {
        operationId: nullableString('Correlation, decision, handoff ou confirmation id; null lista recentes.'),
        limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
});

export const MODEL_GATEWAY_MODEL_SWITCH_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'modelId', 'runtimeId', 'idempotencyKey', 'confirm'],
    properties: {
        mode: {
            type: 'string',
            enum: ['plan', 'apply'],
            description: 'plan nunca altera runtime; apply exige confirm=true.',
        },
        modelId: { type: 'string', minLength: 1, maxLength: 300 },
        runtimeId: nullableString('Runtime alvo; null seleciona o runtime padrão.'),
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 200,
            pattern: '^[A-Za-z0-9._:-]+$',
        },
        confirm: {
            type: 'boolean',
            description: 'Deve ser true para mode=apply depois de revisar um plano.',
        },
    },
});

export const MODEL_GATEWAY_ROUTE_SWITCH_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'route', 'runtimeId', 'timeoutMs', 'idempotencyKey', 'confirm'],
    properties: {
        mode: {
            type: 'string',
            enum: ['plan', 'apply'],
            description: 'plan valida a intenção; apply tenta reattach do mesmo sessionId.',
        },
        route: {
            type: 'object',
            additionalProperties: false,
            required: [
                'providerId',
                'providerModel',
                'selectorSyntax',
                'baseUrl',
                'openAICompatibleBaseUrl',
                'wireApi',
                'providerProfile',
                'routeProfile',
                'selectedRouteKey',
            ],
            properties: {
                providerId: { type: 'string', minLength: 1, maxLength: 160 },
                providerModel: { type: 'string', minLength: 1, maxLength: 300 },
                providerType: nullableString('Tipo SDK-facing quando conhecido: openai, azure ou anthropic.'),
                selectorSyntax: nullableString('Selector exposto ao SDK; null usa providerModel.'),
                baseUrl: nullableString('Endpoint canônico quando presente no catálogo.'),
                openAICompatibleBaseUrl: nullableString('Endpoint OpenAI-compatible; null quando não aplicável.'),
                openAICompatible: { type: ['boolean', 'null'] },
                wireApi: nullableString('Wire API canônica, por exemplo openai_responses.'),
                providerProfile: nullableString('Perfil BYOK configurado; null quando a rota usa provider preset.'),
                routeProfile: nullableString('Perfil de tarefa/rota que justificou a seleção.'),
                selectedRouteKey: nullableString('Chave da decisão de rota para correlação.'),
                bindingStrategy: {
                    type: ['string', 'null'],
                    enum: ['auto', 'direct', 'ingress', 'blocked', null],
                    description: 'Estratégia canônica calculada pelo route plan; apply revalida este campo.',
                },
                sdkRouteKey: nullableString('Identidade estável SDK-facing para rotas ingress.'),
                sdkVisibleModel: nullableString('Modelo estável visto pelo SDK quando bindingStrategy=ingress.'),
                directRebindReliability: {
                    type: ['string', 'null'],
                    enum: ['proven', 'documented', 'unknown', 'unreliable', 'unsupported', null],
                },
                directRebindSupported: { type: ['boolean', 'null'] },
                directRebindReliable: { type: ['boolean', 'null'] },
                bindingDecision: {
                    type: ['object', 'null'],
                    description: 'Decisão redigida retornada pelo route plan; nunca contém credenciais.',
                },
            },
        },
        runtimeId: nullableString('Runtime alvo; null seleciona o runtime padrão.'),
        timeoutMs: { type: 'integer', minimum: 5000, maximum: 120000 },
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 200,
            pattern: '^[A-Za-z0-9._:-]+$',
        },
        confirm: {
            type: 'boolean',
            description: 'Deve ser true em apply após revisão do plano.',
        },
    },
});

export const MODEL_GATEWAY_MODEL_EVALUATE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['modelIds', 'taskProfile', 'maxResults'],
    properties: {
        modelIds: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 300 },
        },
        taskProfile: {
            type: 'string',
            enum: [
                'cheap_chat',
                'code',
                'repo_agent',
                'tool_agent',
                'json_extraction',
                'vision',
                'deep_reasoning',
                'local_private',
                'local_private_strict',
            ],
        },
        maxResults: { type: 'integer', minimum: 1, maximum: 50 },
    },
});

export const MODEL_GATEWAY_POLICY_PROPOSE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['objective', 'taskProfile', 'candidateModelIds', 'maxCandidates'],
    properties: {
        objective: {
            type: 'string',
            enum: [
                'lower_cost',
                'higher_reliability',
                'prefer_runtime_proved',
                'require_tools',
                'local_private',
                'balanced',
            ],
            description: 'Objetivo consultivo; a tool nunca aplica a política proposta.',
        },
        taskProfile: {
            type: 'string',
            enum: [
                'cheap_chat',
                'code',
                'repo_agent',
                'tool_agent',
                'json_extraction',
                'vision',
                'deep_reasoning',
                'local_private',
                'local_private_strict',
            ],
        },
        candidateModelIds: {
            type: 'array',
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 300 },
            description: 'Shortlist opcional para produzir evidência comparativa junto da proposta.',
        },
        maxCandidates: { type: 'integer', minimum: 1, maximum: 20 },
    },
});

export const MODEL_GATEWAY_PROBE_PLAN_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
        'modelIds',
        'providerId',
        'allowedProbeKinds',
        'maxProbeCount',
        'maxEstimatedCostUsd',
        'unknownCostPolicy',
        'recommendationLimit',
        'probeFailureCooldownSeconds',
    ],
    properties: {
        modelIds: {
            type: 'array',
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 300 },
            description: 'Shortlist explícita; array vazio usa o diff do último refresh de catálogo.',
        },
        providerId: nullableString('Provider exato; null permite todos os providers.'),
        routeProfile: nullableString(
            'Perfil funcional alvo da prova (por exemplo repo_agent); quando informado, backoff e health usam essa identidade canônica.',
        ),
        allowedProbeKinds: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
            items: { type: 'string', enum: ['chat', 'streaming', 'json', 'agent', 'vision'] },
        },
        maxProbeCount: { type: 'integer', minimum: 1, maximum: 50 },
        maxEstimatedCostUsd: { type: 'number', minimum: 0, maximum: 100 },
        unknownCostPolicy: {
            type: 'string',
            enum: ['skip', 'allow'],
            description: 'Use skip para operação conservadora quando pricing estiver ausente.',
        },
        recommendationLimit: { type: 'integer', minimum: 1, maximum: 100 },
        probeFailureCooldownSeconds: { type: 'integer', minimum: 60, maximum: 86400 },
    },
});

export const MODEL_GATEWAY_WORKFLOW_PLAN_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
        'objective',
        'taskProfile',
        'runtimeId',
        'providerId',
        'candidateModelIds',
        'preferredProbeKinds',
        'maxSnapshotAgeHours',
        'maxCandidates',
        'maxProbeCount',
        'maxEstimatedCostUsd',
        'idempotencyKeyPrefix',
        'includeCatalogRefreshPlan',
        'includeRouteSwitchPlan',
        'requireRuntimeProof',
    ],
    properties: {
        objective: {
            type: 'string',
            enum: [
                'readiness',
                'catalog_refresh',
                'route_selection',
                'probe_shortlist',
                'same_session_model_switch',
                'same_session_route_switch',
                'profile_management',
                'runtime_reconcile',
            ],
            description: 'Workflow operacional que a LLM-B quer planejar sem executar mutações.',
        },
        taskProfile: {
            type: 'string',
            enum: [
                'cheap_chat',
                'code',
                'repo_agent',
                'tool_agent',
                'json_extraction',
                'vision',
                'deep_reasoning',
                'local_private',
                'local_private_strict',
            ],
        },
        runtimeId: nullableString('Runtime alvo; null usa o runtime default.'),
        providerId: nullableString('Provider preferido para probes/shortlist; null usa a rota selecionada.'),
        candidateModelIds: {
            type: 'array',
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 300 },
            description: 'Shortlist opcional. Array vazio usa a rota selecionada pelo gateway.',
        },
        preferredProbeKinds: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
            items: { type: 'string', enum: ['chat', 'streaming', 'json', 'agent', 'vision'] },
            description: 'Probes que o plano deve recomendar antes de promover modelo/rota.',
        },
        maxSnapshotAgeHours: { type: 'integer', minimum: 1, maximum: 720 },
        maxCandidates: { type: 'integer', minimum: 1, maximum: 25 },
        maxProbeCount: { type: 'integer', minimum: 1, maximum: 20 },
        maxEstimatedCostUsd: { type: 'number', minimum: 0, maximum: 10 },
        idempotencyKeyPrefix: {
            type: 'string',
            minLength: 8,
            maxLength: 120,
            pattern: '^[A-Za-z0-9._:-]+$',
            description: 'Prefixo estável para gerar idempotencyKey dos passos apply futuros.',
        },
        includeCatalogRefreshPlan: { type: 'boolean' },
        includeRouteSwitchPlan: {
            type: 'boolean',
            description: 'Quando true, inclui passo de model_gateway_route_switch preservando a mesma sessão.',
        },
        requireRuntimeProof: {
            type: 'boolean',
            description: 'Quando true, o plano exige probe positiva antes de qualquer apply de switch/reconcile.',
        },
        selectionGoal: {
            type: 'string',
            enum: ['quality_first', 'balanced', 'reliability_first', 'latency_first', 'cost_first'],
            description: 'Objetivo de ranking. quality_first é apropriado quando custo/uso não limitam a escolha.',
        },
        probeStrategy: {
            type: 'string',
            enum: ['aggressive', 'balanced', 'minimal'],
            description: 'Quantas candidatas o plano prepara para sondagem adaptativa antes de pedir nova decisão.',
        },
        maxRuntimeProofAgeHours: {
            type: 'integer',
            minimum: 1,
            maximum: 168,
            description: 'Janela máxima para prova positiva continuar valendo como funcionalidade atual.',
        },
        includeDetailedEvidence: {
            type: 'boolean',
            description:
                'Opt-in diagnóstico. Default false mantém a resposta compacta; true inclui snapshots/route plans completos.',
        },
    },
});

export const MODEL_GATEWAY_CONTROL_PLANE_GUIDE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['objective', 'includeTerminalCommands', 'includeApplyExamples'],
    properties: {
        objective: {
            type: 'string',
            enum: [
                'overview',
                'catalog',
                'route',
                'probe',
                'same_session_switch',
                'profile',
                'runtime_reconcile',
                'live_validation',
                'all',
            ],
            description: 'Área operacional que a LLM-B quer entender antes de chamar tools de gestão.',
        },
        includeTerminalCommands: {
            type: 'boolean',
            description:
                'Inclui comandos de cockpit terminal úteis para observar o mesmo estado fora das tools locais.',
        },
        includeApplyExamples: {
            type: 'boolean',
            description: 'Inclui exemplos de payload apply; todos continuam exigindo chamada separada e confirm=true.',
        },
    },
});

export const MODEL_GATEWAY_PROBE_EXECUTE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
        'mode',
        'probeKind',
        'providerId',
        'modelId',
        'profileId',
        'maxEstimatedCostUsd',
        'timeoutMs',
        'idempotencyKey',
        'confirm',
    ],
    properties: {
        mode: { type: 'string', enum: ['plan', 'apply'] },
        probeKind: { type: 'string', enum: ['chat', 'streaming', 'json', 'agent', 'vision'] },
        providerId: { type: 'string', minLength: 1, maxLength: 160 },
        modelId: { type: 'string', minLength: 1, maxLength: 300 },
        routeProfile: nullableString(
            'Perfil funcional alvo da prova; use exatamente o routeProfile retornado pelo workflow para preservar health/backoff canônicos.',
        ),
        profileId: nullableString('Perfil BYOK configurado; null usa providerId como preset efêmero.'),
        maxEstimatedCostUsd: { type: 'number', minimum: 0, maximum: 10 },
        unknownCostPolicy: {
            type: 'string',
            enum: ['skip', 'allow'],
            description: 'quality_first pode usar allow; skip permanece o default conservador.',
        },
        timeoutMs: { type: 'integer', minimum: 5000, maximum: 120000 },
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 200,
            pattern: '^[A-Za-z0-9._:-]+$',
        },
        confirm: { type: 'boolean' },
    },
});

export const MODEL_GATEWAY_CATALOG_REFRESH_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: [
        'mode',
        'includePublic',
        'includeAuthenticated',
        'force',
        'sourceIds',
        'refreshAccountOverlays',
        'maxSourceResults',
        'idempotencyKey',
        'confirm',
    ],
    properties: {
        mode: { type: 'string', enum: ['plan', 'apply'] },
        includePublic: { type: 'boolean' },
        includeAuthenticated: { type: 'boolean' },
        force: { type: 'boolean' },
        sourceIds: {
            type: 'array',
            maxItems: 40,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 160 },
        },
        refreshAccountOverlays: { type: 'boolean' },
        maxSourceResults: { type: 'integer', minimum: 1, maximum: 50 },
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 200,
            pattern: '^[A-Za-z0-9._:-]+$',
        },
        confirm: { type: 'boolean' },
    },
});

export const MODEL_GATEWAY_RUNTIME_RECONCILE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'expectedModelId', 'runtimeId', 'idempotencyKey', 'confirm'],
    properties: {
        mode: { type: 'string', enum: ['plan', 'apply'] },
        expectedModelId: { type: 'string', minLength: 1, maxLength: 300 },
        runtimeId: nullableString('Runtime alvo; null seleciona o runtime padrão.'),
        routeOperationId: nullableString(
            'Operation id de um same-session route switch diferido; quando presente, reconcile inspeciona/promove rota em vez de apenas modelo.',
        ),
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 200,
            pattern: '^[A-Za-z0-9._:-]+$',
        },
        confirm: { type: 'boolean' },
    },
});

export const MODEL_GATEWAY_MAINTENANCE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'maxRowsPerLedger', 'confirm'],
    properties: {
        mode: { type: 'string', enum: ['plan', 'apply'] },
        maxRowsPerLedger: {
            type: 'integer',
            minimum: 100,
            maximum: 500000,
            description: 'Limite uniforme aplicado somente aos ledgers operacionais SQLite.',
        },
        confirm: { type: 'boolean' },
    },
});

export const MODEL_GATEWAY_PROFILE_MANAGE_INPUT_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'operation', 'profileName', 'confirm', 'idempotencyKey'],
    properties: {
        mode: { type: 'string', enum: ['plan', 'apply'] },
        operation: { type: 'string', enum: ['upsert', 'remove'] },
        profileName: {
            type: 'string',
            minLength: 1,
            maxLength: 160,
            pattern: '^[A-Za-z0-9._:-]+$',
            description: 'Nome canônico do perfil BYOK no JSON do gateway.',
        },
        profile: {
            type: ['object', 'null'],
            additionalProperties: true,
            description: 'Corpo bruto do perfil para upsert; null é aceito apenas quando operation=remove.',
        },
        confirm: { type: 'boolean' },
        idempotencyKey: {
            type: 'string',
            minLength: 8,
            maxLength: 200,
            pattern: '^[A-Za-z0-9._:-]+$',
        },
    },
});
