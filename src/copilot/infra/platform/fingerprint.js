// @ts-check
/**
 * Helpers compartilhados para comparação de fingerprint de arquivo.
 *
 * @module copilot/infra/platform/fingerprint
 */

/**
 * Compara fingerprint (mtime/size) com tolerância pequena para drift de timestamp em FSs específicos.
 *
 * @param {{ mtimeMs: number; sizeBytes: number }} cached
 * @param {{ mtimeMs: number; sizeBytes: number }} actual
 * @param {{ mtimeToleranceMs?: number }} [options]
 * @returns {boolean}
 */
export function fingerprintMatches(cached, actual, options = {}) {
    const tolerance = Number.isFinite(options.mtimeToleranceMs) ? Math.max(0, Number(options.mtimeToleranceMs)) : 2;
    const cachedMtime = Number(cached.mtimeMs);
    const actualMtime = Number(actual.mtimeMs);
    const cachedSize = Number(cached.sizeBytes);
    const actualSize = Number(actual.sizeBytes);

    if (!Number.isFinite(cachedMtime) || !Number.isFinite(actualMtime)) return false;
    if (!Number.isFinite(cachedSize) || !Number.isFinite(actualSize)) return false;

    const mtimeOk = cachedMtime === actualMtime || Math.abs(cachedMtime - actualMtime) <= tolerance;
    const sizeOk = cachedSize === actualSize;
    return mtimeOk && sizeOk;
}

/**
 * Compara tamanho, timestamps e identidade do inode.
 *
 * @param {{ mtimeMs: number; ctimeMs: number; sizeBytes: number; dev: number; ino: number }} cached
 * @param {{ mtimeMs: number; ctimeMs: number; sizeBytes: number; dev: number; ino: number }} actual
 * @param {{ mtimeToleranceMs?: number }} [options]
 * @returns {boolean}
 */
export function richFingerprintMatches(cached, actual, options = {}) {
    return (
        fingerprintMatches(cached, actual, options) &&
        Number.isFinite(Number(cached.ctimeMs)) &&
        Number.isFinite(Number(actual.ctimeMs)) &&
        Number(cached.ctimeMs) === Number(actual.ctimeMs) &&
        Number.isFinite(Number(cached.dev)) &&
        Number.isFinite(Number(actual.dev)) &&
        Number(cached.dev) === Number(actual.dev) &&
        Number.isFinite(Number(cached.ino)) &&
        Number.isFinite(Number(actual.ino)) &&
        Number(cached.ino) === Number(actual.ino)
    );
}
