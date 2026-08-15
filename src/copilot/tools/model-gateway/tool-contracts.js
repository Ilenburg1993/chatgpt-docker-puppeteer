// @ts-check
/**
 * Stable tool annotations and operator-facing phase map for the Model Gateway control plane.
 *
 * @module copilot/tools/model-gateway/tool-contracts
 */

export const READ_ONLY_ANNOTATIONS = Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
});

export const MUTATING_ANNOTATIONS = Object.freeze({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
});

export const MODEL_GATEWAY_CONTROL_PLANE_TOOL_MATRIX = Object.freeze([
    {
        phase: 'readiness',
        tools: ['model_gateway_control_plane_guide', 'model_gateway_overview', 'model_gateway_workflow_plan'],
        purpose: 'Entender o sistema, readiness, runtime efetivo, BYOK e próximo roteiro operacional.',
    },
    {
        phase: 'catalog',
        tools: ['model_gateway_catalog_search', 'model_gateway_catalog_refresh'],
        purpose: 'Buscar candidatos e planejar/aplicar refresh incremental do catálogo canônico.',
    },
    {
        phase: 'route',
        tools: ['model_gateway_route_plan', 'model_gateway_model_evaluate', 'model_gateway_policy_propose'],
        purpose: 'Separar ranking de qualidade/capacidade de ranking já certificado por prova runtime fresca.',
    },
    {
        phase: 'runtime-proof',
        tools: ['model_gateway_probe_plan', 'model_gateway_probe_execute'],
        purpose: 'Provar a melhor candidata atual em sessão descartável; recalcular o workflow após todo resultado.',
    },
    {
        phase: 'same-session-runtime',
        tools: ['model_gateway_model_switch', 'model_gateway_route_switch', 'model_gateway_runtime_reconcile'],
        purpose: 'Trocar modelo ou provider no runtime vivo preservando sessionId, com apply confirmado.',
    },
    {
        phase: 'byok-profile',
        tools: ['model_gateway_profile_manage'],
        purpose: 'Gerir perfis BYOK com segredos por referência de env, nunca inline.',
    },
    {
        phase: 'operations',
        tools: ['model_gateway_operation_status', 'model_gateway_maintenance'],
        purpose: 'Auditar operações persistidas e planejar retenção dos ledgers operacionais.',
    },
]);
