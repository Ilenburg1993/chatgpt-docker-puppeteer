// @ts-check
/**
 * Disposable BYOK JSON probe.
 *
 * Validates whether the configured provider/model can return parseable JSON through the same session transport used by
 * the live runtime. This deliberately separates plain chat success from structured-output usability.
 *
 * @module copilot/model-gateway/probes/json-probe
 */

import { runConfiguredByokChatProbe } from './chat-probe.js';

const DEFAULT_JSON_PROBE_PROMPT =
    'Responda somente com JSON valido, sem markdown: {"byok_probe":"ok","mode":"json"}.';

/**
 * @param {string} text
 * @returns {{ ok: true; value: unknown } | { ok: false; message: string }}
 */
function parseJsonObject(text) {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, message: 'resposta vazia' };
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
    const candidate = fenced ? (fenced[1] ?? '').trim() : trimmed;
    try {
        return { ok: true, value: JSON.parse(candidate) };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasExpectedProbePayload(value) {
    return (
        !!value &&
        typeof value === 'object' &&
        /** @type {{ byok_probe?: unknown; mode?: unknown }} */ (value).byok_probe === 'ok' &&
        /** @type {{ byok_probe?: unknown; mode?: unknown }} */ (value).mode === 'json'
    );
}

/**
 * @param {Parameters<typeof runConfiguredByokChatProbe>[0]} [options]
 * @returns {Promise<any>}
 */
export async function runConfiguredByokJsonProbe(options = {}) {
    const chatResult = await runConfiguredByokChatProbe({
        ...options,
        prompt: options.prompt ?? DEFAULT_JSON_PROBE_PROMPT,
    });
    if (chatResult.status !== 'ok') {
        return {
            ...chatResult,
            jsonProved: false,
            parsedJson: null,
        };
    }

    const parsed = parseJsonObject(chatResult.finalContent);
    if (!parsed.ok || !hasExpectedProbePayload(parsed.value)) {
        const reason = parsed.ok ? 'JSON valido, mas payload do probe nao confere.' : `JSON invalido: ${parsed.message}`;
        return {
            ...chatResult,
            ok: false,
            status: 'json-invalid',
            jsonProved: false,
            parsedJson: parsed.ok ? parsed.value : null,
            errors: [...chatResult.errors, reason],
        };
    }

    return {
        ...chatResult,
        ok: true,
        status: 'ok',
        jsonProved: true,
        parsedJson: parsed.value,
    };
}
