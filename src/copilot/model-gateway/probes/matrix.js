// @ts-check
/**
 * Provider/wire-API probe matrix.
 *
 * The matrix is a pre-runtime planning artifact. It maps provider endpoint metadata to probe families that should be
 * considered later, and explicitly separates already implemented probe kinds from pending runtime probes.
 *
 * @module copilot/model-gateway/probes/matrix
 */

import { listProviderGatewayTraits } from '../providers/index.js';

export const MODEL_GATEWAY_IMPLEMENTED_PROBE_KINDS = Object.freeze(['chat', 'streaming', 'json', 'agent', 'vision']);

export const MODEL_GATEWAY_PLANNED_PROBE_KINDS = Object.freeze([
    'chat',
    'streaming',
    'json',
    'agent',
    'vision',
    'reasoning',
    'forced_tool_choice',
    'parallel_tool_calls',
    'embeddings',
    'audio_transcription',
    'tts',
    'rerank',
    'image_generation',
    'gateway_fallback',
    'provider_native',
]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(optionalString).filter((item) => item !== null))];
}

/**
 * @param {string} runtimeKind
 * @returns {string}
 */
function normalizeWireApi(runtimeKind) {
    if (/^(?:chat_completions|openai_chat_completions)$/u.test(runtimeKind)) return 'openai_chat_completions';
    if (/^(?:responses|openai_responses)$/u.test(runtimeKind)) return 'openai_responses';
    if (/^(?:messages|anthropic_messages)$/u.test(runtimeKind)) return 'anthropic_messages';
    if (/^(?:generate_content|google_model)$/u.test(runtimeKind)) return 'google_generate_content';
    if (/^fim_completions$/u.test(runtimeKind)) return 'openai_fim_completions';
    if (/^workers_ai_run$/u.test(runtimeKind)) return 'cloudflare_workers_ai_run';
    if (/^ai_gateway_universal$/u.test(runtimeKind)) return 'cloudflare_ai_gateway_universal';
    if (/^openai_embeddings$/u.test(runtimeKind)) return 'openai_embeddings';
    return runtimeKind.replace(/_/gu, '-');
}

/**
 * @param {string} runtimeKind
 * @returns {boolean}
 */
function isChatLike(runtimeKind) {
    return /(?:chat|responses|messages|generate_content|google_model|workers_ai_run|ai_gateway_universal|generate)$/u.test(
        runtimeKind,
    );
}

/**
 * @param {string} runtimeKind
 * @param {Record<string, unknown>} routing
 * @returns {string[]}
 */
function inferProbeKinds(runtimeKind, routing) {
    /** @type {string[]} */
    const kinds = [];
    if (isChatLike(runtimeKind)) kinds.push('chat', 'streaming', 'json');
    if (
        /(?:chat_completions|responses|messages|generate_content|google_model|ai_gateway_universal|openai_chat_completions|openai_responses|anthropic_messages)$/u.test(
            runtimeKind,
        )
    ) {
        kinds.push('agent', 'reasoning');
    }
    if (
        /(?:chat_completions|responses|openai_chat_completions|openai_responses|ai_gateway_universal)$/u.test(
            runtimeKind,
        )
    ) {
        kinds.push('forced_tool_choice', 'parallel_tool_calls');
    }
    if (/vision|image_input/u.test(runtimeKind)) kinds.push('vision');
    if (/embedding/u.test(runtimeKind)) kinds.push('embeddings');
    if (/(?:audio|transcription|asr|stt)/u.test(runtimeKind)) kinds.push('audio_transcription');
    if (/(?:tts|speech)/u.test(runtimeKind)) kinds.push('tts');
    if (/rerank/u.test(runtimeKind)) kinds.push('rerank');
    if (/(?:image_generation|text_to_image)/u.test(runtimeKind)) kinds.push('image_generation');
    if (runtimeKind === 'fim_completions') kinds.push('provider_native');
    if (
        /^(?:messages|anthropic_messages|generate_content|google_model|workers_ai_run|generate|chat)$/u.test(
            runtimeKind,
        )
    ) {
        kinds.push('provider_native');
    }
    if (routing['supportsFallback'] === true || runtimeKind === 'ai_gateway_universal') kinds.push('gateway_fallback');
    return [...new Set(kinds)].filter((kind) => MODEL_GATEWAY_PLANNED_PROBE_KINDS.includes(kind));
}

/**
 * @param {object} [options]
 * @param {readonly Record<string, unknown>[]} [options.traits]
 * @param {string} [options.providerId]
 * @returns {{
 *     providerId: string;
 *     topology: string;
 *     runtimeKind: string;
 *     wireApi: string;
 *     probeKinds: string[];
 *     implementedProbeKinds: string[];
 *     pendingProbeKinds: string[];
 *     gatewaySpecific: boolean;
 *     providerNative: boolean;
 *     notes: string[];
 * }[]}
 */
export function listProviderWireProbeMatrix(options = {}) {
    const providerFilter = optionalString(options.providerId)?.toLowerCase() ?? null;
    const traits = Array.isArray(options.traits) ? options.traits : listProviderGatewayTraits();
    return traits
        .filter((item) => !providerFilter || optionalString(item['providerId']) === providerFilter)
        .flatMap((item) => {
            const providerId = optionalString(item['providerId']) ?? 'unknown-provider';
            const topology = optionalString(item['topology']) ?? 'unknown';
            const runtimeKinds = stringList(item['runtimeKinds']);
            const routing = asRecord(item['routing']);
            return runtimeKinds.map((runtimeKind) => {
                const probeKinds = inferProbeKinds(runtimeKind, routing);
                const implementedProbeKinds = probeKinds.filter((kind) =>
                    MODEL_GATEWAY_IMPLEMENTED_PROBE_KINDS.includes(kind),
                );
                const pendingProbeKinds = probeKinds.filter(
                    (kind) => !MODEL_GATEWAY_IMPLEMENTED_PROBE_KINDS.includes(kind),
                );
                const gatewaySpecific =
                    topology === 'gateway' || runtimeKind.includes('gateway') || routing['supportsFallback'] === true;
                const providerNative = probeKinds.includes('provider_native');
                return {
                    providerId,
                    topology,
                    runtimeKind,
                    wireApi: normalizeWireApi(runtimeKind),
                    probeKinds,
                    implementedProbeKinds,
                    pendingProbeKinds,
                    gatewaySpecific,
                    providerNative,
                    notes: [
                        gatewaySpecific ? 'gateway_or_fallback_surface' : null,
                        providerNative ? 'provider_native_wire_api' : null,
                        pendingProbeKinds.length > 0 ? 'runtime_probe_gap' : null,
                    ].filter((note) => note !== null),
                };
            });
        });
}

/**
 * @param {readonly Record<string, unknown>[]} rows
 * @returns {{
 *     providerCount: number;
 *     rowCount: number;
 *     implementedProbeKindCounts: Record<string, number>;
 *     pendingProbeKindCounts: Record<string, number>;
 *     providersWithPendingProbeKinds: string[];
 * }}
 */
export function summarizeProviderWireProbeMatrix(rows) {
    const providers = new Set(rows.map((row) => optionalString(row['providerId']) ?? 'unknown-provider'));
    /** @type {Record<string, number>} */
    const implementedProbeKindCounts = {};
    /** @type {Record<string, number>} */
    const pendingProbeKindCounts = {};
    const providersWithPending = new Set();
    for (const row of rows) {
        for (const kind of stringList(row['implementedProbeKinds'])) {
            implementedProbeKindCounts[kind] = (implementedProbeKindCounts[kind] ?? 0) + 1;
        }
        for (const kind of stringList(row['pendingProbeKinds'])) {
            pendingProbeKindCounts[kind] = (pendingProbeKindCounts[kind] ?? 0) + 1;
            providersWithPending.add(optionalString(row['providerId']) ?? 'unknown-provider');
        }
    }
    return {
        providerCount: providers.size,
        rowCount: rows.length,
        implementedProbeKindCounts,
        pendingProbeKindCounts,
        providersWithPendingProbeKinds: [...providersWithPending].sort(),
    };
}
