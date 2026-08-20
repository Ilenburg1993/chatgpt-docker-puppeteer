// @ts-check
/**
 * Disposable BYOK vision probe.
 *
 * Uses the same SDK session path as live turns, with a tiny inline PNG fixture. The probe is intentionally
 * behavioral: the prompt does not reveal the color, so a passing result means the provider accepted and interpreted
 * the image attachment rather than only completing a text canary.
 *
 * @module copilot/model-gateway/probes/vision-probe
 */

import { blobAttachment } from '#copilot/sdk/session';
import { runConfiguredByokChatProbe } from './chat-probe.js';

export const BYOK_VISION_PROBE_MIME_TYPE = 'image/png';
export const BYOK_VISION_PROBE_DISPLAY_NAME = 'byok-vision-probe-red-pixel.png';

// 1x1 red PNG. Kept inline so the probe is hermetic and never needs to read arbitrary operator files.
const BYOK_VISION_PROBE_RED_PIXEL_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

const DEFAULT_VISION_PROBE_PROMPT =
    'Observe a imagem anexada. Responda somente no formato VISION_PROBE_OK:<cor dominante em ingles ou portugues>.';

/**
 * @param {string} text
 * @returns {string | null}
 */
function extractDominantColor(text) {
    const normalized = text.trim().toLowerCase();
    const match = normalized.match(/vision_probe_ok\s*:\s*([a-zçãéíóúâêôáàü-]+)/iu);
    if (match?.[1]) return match[1].normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
    if (/\b(?:red|vermelh[oa])\b/iu.test(normalized)) return 'red';
    return null;
}

/**
 * @param {string | null} color
 * @returns {boolean}
 */
function isExpectedRed(color) {
    return typeof color === 'string' && /^(?:red|vermelho|vermelha)$/iu.test(color);
}

/**
 * @param {Parameters<typeof runConfiguredByokChatProbe>[0]} [options]
 */
export async function runConfiguredByokVisionProbe(options = {}) {
    const attachment = blobAttachment(BYOK_VISION_PROBE_RED_PIXEL_BASE64, BYOK_VISION_PROBE_MIME_TYPE, {
        displayName: BYOK_VISION_PROBE_DISPLAY_NAME,
    });
    const chatResult = await runConfiguredByokChatProbe({
        ...options,
        prompt: options.prompt ?? DEFAULT_VISION_PROBE_PROMPT,
        attachments: [attachment],
    });
    if (chatResult.status !== 'ok') {
        return {
            ...chatResult,
            visionProved: false,
            dominantColor: null,
            attachmentMimeType: BYOK_VISION_PROBE_MIME_TYPE,
            attachmentBytes: Buffer.byteLength(BYOK_VISION_PROBE_RED_PIXEL_BASE64, 'base64'),
        };
    }

    const dominantColor = extractDominantColor(chatResult.finalContent);
    if (!isExpectedRed(dominantColor)) {
        return {
            ...chatResult,
            ok: false,
            status: 'vision-mismatch',
            visionProved: false,
            dominantColor,
            attachmentMimeType: BYOK_VISION_PROBE_MIME_TYPE,
            attachmentBytes: Buffer.byteLength(BYOK_VISION_PROBE_RED_PIXEL_BASE64, 'base64'),
            errors: [
                ...chatResult.errors,
                dominantColor
                    ? `Vision probe recebeu cor dominante inesperada: ${dominantColor}.`
                    : 'Vision probe respondeu, mas não identificou a cor dominante da imagem.',
            ],
        };
    }

    return {
        ...chatResult,
        ok: true,
        status: 'ok',
        visionProved: true,
        dominantColor,
        attachmentMimeType: BYOK_VISION_PROBE_MIME_TYPE,
        attachmentBytes: Buffer.byteLength(BYOK_VISION_PROBE_RED_PIXEL_BASE64, 'base64'),
    };
}
