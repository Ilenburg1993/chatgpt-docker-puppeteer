// @ts-check
/**
 * Helpers de workspace virtual das sessões SDK.
 */

/**
 * Mantém endpoints HTTP alinhados à semântica do SDK: caminho relativo ao workspace virtual.
 *
 * @param {unknown} value
 * @returns {{ ok: true; path: string } | { ok: false; error: string }}
 */
export function validateWorkspacePath(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return { ok: false, error: 'Campo "path" deve ser string relativa não-vazia.' };
    }
    const path = value.trim();
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        return { ok: false, error: 'Campo "path" deve ser relativo ao workspace SDK e não pode conter "..".' };
    }
    return { ok: true, path };
}
