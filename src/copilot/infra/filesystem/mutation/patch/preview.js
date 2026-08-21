// @ts-check
/** Bounded textual diff preview policy shared by locked patch variants. */
import { utf8ByteLength } from '#copilot/infra/internal/platform';

const DEFAULT_PATCH_DIFF_MAX_LINES = 160;
const DEFAULT_PATCH_DIFF_MAX_BYTES = 48 * 1024;

/**
 * @param {string} text
 * @param {{ maxLines?: number; maxBytes?: number }} [options]
 * @returns {{ text: string; truncated: boolean; lines: number; bytes: number }}
 */
export function windowTextPreview(text, options = {}) {
    const maxLines = Math.max(1, Math.trunc(options.maxLines ?? DEFAULT_PATCH_DIFF_MAX_LINES));
    const maxBytes = Math.max(256, Math.trunc(options.maxBytes ?? DEFAULT_PATCH_DIFF_MAX_BYTES));
    const lines = text.split('\n');
    let truncated = lines.length > maxLines;
    let preview = lines.slice(0, maxLines).join('\n');
    let bytes = utf8ByteLength(preview, 'diff preview');
    if (bytes > maxBytes) {
        let end = preview.length;
        while (end > 0 && utf8ByteLength(preview.slice(0, end), 'diff preview') > maxBytes) {
            end = Math.max(0, end - 512);
        }
        preview = preview.slice(0, end);
        bytes = utf8ByteLength(preview, 'diff preview');
        truncated = true;
    }
    return { text: preview, truncated, lines: Math.min(lines.length, maxLines), bytes };
}
